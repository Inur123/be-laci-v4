import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { SSO_PROVIDER_ID } from "../lib/sso";

const OIDC_TRANSACTION_TTL_MS = 10 * 60 * 1000;

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface OidcTransaction {
  nonce: string;
  codeVerifier: string;
  callbackURL: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token: string;
  scope?: string;
}

export interface VerifiedSsoIdentity {
  sub: string;
  name: string;
  email: string;
  emailVerified: boolean;
  picture?: string;
}

async function upsertVerifiedIdentity(
  tx: Prisma.TransactionClient,
  identity: VerifiedSsoIdentity
) {
  const email = identity.email.trim().toLowerCase();
  const account = await tx.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: SSO_PROVIDER_ID,
        accountId: identity.sub,
      },
    },
    include: { user: true },
  });

  if (account) {
    return tx.user.update({
      where: { id: account.userId },
      data: {
        name: identity.name,
        email,
        emailVerified: true,
        image: identity.picture || null,
        isActive: true,
      },
    });
  }

  const existingByEmail = await tx.user.findUnique({ where: { email } });
  if (existingByEmail) {
    // Jalur ini hanya dipakai pada development. ID token sudah diverifikasi
    // (issuer, audience, signature, nonce, serta email_verified) sebelum fungsi
    // dipanggil. Tautkan record lokal lama hanya bila belum pernah ditautkan ke
    // subject SSO lain; identitas permanen sesudahnya tetap provider + sub.
    const existingSsoAccount = await tx.account.findFirst({
      where: {
        userId: existingByEmail.id,
        providerId: SSO_PROVIDER_ID,
      },
    });
    if (existingSsoAccount) {
      throw new Error("identity_email_conflict");
    }

    const user = await tx.user.update({
      where: { id: existingByEmail.id },
      data: {
        name: identity.name,
        emailVerified: true,
        image: identity.picture || null,
        isActive: true,
      },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        providerId: SSO_PROVIDER_ID,
        accountId: identity.sub,
      },
    });
    return user;
  }

  const user = await tx.user.create({
    data: {
      id: identity.sub,
      name: identity.name,
      email,
      emailVerified: true,
      image: identity.picture || null,
      role: "SEKRETARIS_PAC",
      isActive: true,
    },
  });
  await tx.account.create({
    data: {
      userId: user.id,
      providerId: SSO_PROVIDER_ID,
      accountId: identity.sub,
    },
  });
  return user;
}

let discoveryCache:
  | { issuer: string; value: DiscoveryDocument; expiresAt: number }
  | undefined;
let jwksCache:
  | { uri: string; value: ReturnType<typeof createRemoteJWKSet> }
  | undefined;

function randomValue(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function normalizeIssuer(value: string): string {
  return new URL(value).toString().replace(/\/$/, "");
}

function safeFrontendCallback(frontendURL: string, requested?: string): string {
  const base = new URL(frontendURL);
  const callback = requested ? new URL(requested, base) : new URL("/dashboard", base);

  if (callback.origin !== base.origin) {
    throw new Error("callback_url_not_allowed");
  }
  return callback.toString();
}

async function getDiscovery(fastify: FastifyInstance) {
  const expectedIssuer = normalizeIssuer(fastify.config.SSO_ISSUER_URL);
  if (
    discoveryCache?.issuer === expectedIssuer &&
    discoveryCache.expiresAt > Date.now()
  ) {
    return discoveryCache.value;
  }

  const response = await fetch(
    `${expectedIssuer}/.well-known/openid-configuration`,
    { headers: { accept: "application/json" } }
  );
  if (!response.ok) throw new Error("oidc_discovery_unavailable");

  const discovery = (await response.json()) as DiscoveryDocument;
  if (
    normalizeIssuer(discovery.issuer) !== expectedIssuer ||
    !discovery.authorization_endpoint ||
    !discovery.token_endpoint ||
    !discovery.jwks_uri
  ) {
    throw new Error("invalid_oidc_discovery");
  }

  discoveryCache = {
    issuer: expectedIssuer,
    value: discovery,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  return discovery;
}

function remoteJwks(uri: string) {
  if (jwksCache?.uri === uri) return jwksCache.value;
  const value = createRemoteJWKSet(new URL(uri), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1000,
    timeoutDuration: 5_000,
  });
  jwksCache = { uri, value };
  return value;
}

export async function createAuthorizationRequest(
  fastify: FastifyInstance,
  callbackURL?: string
) {
  const discovery = await getDiscovery(fastify);
  const state = randomValue();
  const nonce = randomValue();
  const codeVerifier = randomValue();
  const expiresAt = new Date(Date.now() + OIDC_TRANSACTION_TTL_MS);
  const transaction: OidcTransaction = {
    nonce,
    codeVerifier,
    callbackURL: safeFrontendCallback(fastify.config.FRONTEND_URL, callbackURL),
  };

  await fastify.prisma.$transaction(async (tx) => {
    await tx.verification.deleteMany({
      where: {
        identifier: { startsWith: "oidc:state:" },
        expiresAt: { lte: new Date() },
      },
    });
    await tx.verification.create({
      data: {
        identifier: `oidc:state:${sha256(state)}`,
        value: JSON.stringify(transaction),
        expiresAt,
      },
    });
  });

  const authorizationURL = new URL(discovery.authorization_endpoint);
  authorizationURL.searchParams.set("response_type", "code");
  authorizationURL.searchParams.set("client_id", fastify.config.SSO_CLIENT_ID);
  authorizationURL.searchParams.set("redirect_uri", fastify.config.SSO_REDIRECT_URI);
  authorizationURL.searchParams.set("scope", "openid profile email");
  authorizationURL.searchParams.set("state", state);
  authorizationURL.searchParams.set("nonce", nonce);
  authorizationURL.searchParams.set("code_challenge", sha256(codeVerifier));
  authorizationURL.searchParams.set("code_challenge_method", "S256");
  // Selalu tampilkan pemilih akun SSO. Consent yang pernah diberikan tetap
  // disimpan oleh IdP sehingga pengguna tidak perlu menyetujui scope berulang.
  authorizationURL.searchParams.set("prompt", "select_account");

  return authorizationURL.toString();
}

async function consumeTransaction(
  fastify: FastifyInstance,
  state: string
): Promise<OidcTransaction> {
  return fastify.prisma.$transaction(async (tx) => {
    const identifier = `oidc:state:${sha256(state)}`;
    const rows = await tx.$queryRaw<Array<{ id: string; value: string; expiresAt: Date }>>`
      SELECT id, value, "expiresAt"
      FROM "Verification"
      WHERE identifier = ${identifier}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.expiresAt <= new Date()) {
      if (row) await tx.verification.delete({ where: { id: row.id } });
      throw new Error("invalid_or_expired_state");
    }
    await tx.verification.delete({ where: { id: row.id } });
    return JSON.parse(row.value) as OidcTransaction;
  });
}

export async function exchangeAndVerifyAuthorizationCode(
  fastify: FastifyInstance,
  request: FastifyRequest,
  code: string,
  state: string,
  callbackIssuer?: string
) {
  const discovery = await getDiscovery(fastify);
  const expectedIssuer = normalizeIssuer(discovery.issuer);
  if (callbackIssuer && normalizeIssuer(callbackIssuer) !== expectedIssuer) {
    throw new Error("issuer_mismatch");
  }

  const transaction = await consumeTransaction(fastify, state);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: fastify.config.SSO_REDIRECT_URI,
    client_id: fastify.config.SSO_CLIENT_ID,
    client_secret: fastify.config.SSO_CLIENT_SECRET,
    code_verifier: transaction.codeVerifier,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    request.log.warn({ status: response.status }, "OIDC token exchange ditolak");
    throw new Error("token_exchange_failed");
  }
  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.id_token) throw new Error("missing_id_token");

  const verified = await jwtVerify(tokens.id_token, remoteJwks(discovery.jwks_uri), {
    issuer: expectedIssuer,
    audience: fastify.config.SSO_CLIENT_ID,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  const claims = verified.payload as JWTPayload & {
    nonce?: unknown;
    name?: unknown;
    email?: unknown;
    email_verified?: unknown;
    picture?: unknown;
  };
  if (claims.nonce !== transaction.nonce) throw new Error("nonce_mismatch");
  if (
    typeof claims.sub !== "string" ||
    typeof claims.name !== "string" ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  ) {
    throw new Error("invalid_identity_claims");
  }

  const identity: VerifiedSsoIdentity = {
    sub: claims.sub,
    name: claims.name,
    email: claims.email,
    emailVerified: true,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };

  const linkedAccount = await fastify.prisma.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: SSO_PROVIDER_ID,
        accountId: identity.sub,
      },
    },
    include: { user: true },
  });

  let user;
  if (linkedAccount) {
    if (!linkedAccount.user.isActive || !linkedAccount.user.emailVerified) {
      throw new Error("user_inactive");
    }
    user = await fastify.prisma.user.update({
      where: { id: linkedAccount.userId },
      data: {
        name: identity.name,
        email: identity.email.trim().toLowerCase(),
        image: identity.picture || null,
      },
    });
  } else {
    // Production tetap fail-closed: user harus telah diterima melalui webhook
    // provisioning assignment. JIT hanya membantu development karena SSO di
    // Internet tidak dapat mengirim webhook ke localhost.
    if (fastify.config.NODE_ENV === "production") {
      throw new Error("user_not_provisioned");
    }
    user = await fastify.prisma.$transaction((tx) =>
      upsertVerifiedIdentity(tx, identity)
    );
  }

  if (!user.isActive || !user.emailVerified) {
    throw new Error("user_inactive");
  }

  return {
    userId: user.id,
    callbackURL: transaction.callbackURL,
  };
}
