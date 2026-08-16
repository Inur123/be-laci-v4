import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SSO_PROVIDER_ID } from "../../lib/sso";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const IDEMPOTENCY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

const eventSchema = z
  .object({
    specversion: z.literal("1.0"),
    id: z.uuid(),
    type: z.enum(["user.assigned", "user.updated", "user.unassigned"]),
    source: z.url(),
    subject: z.string().min(1),
    time: z.iso.datetime({ offset: true }),
    datacontenttype: z.literal("application/json"),
    data: z.object({
      audience: z.string().min(1),
      user: z.object({
        sub: z.string().min(1),
        name: z.string().min(1),
        email: z.email(),
        email_verified: z.boolean(),
        picture: z.url().or(z.literal("")).optional(),
      }),
    }),
  })
  .strict();

type ProvisioningEvent = z.infer<typeof eventSchema>;

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function validTimestamp(rawTimestamp: string | undefined): boolean {
  if (!rawTimestamp || !/^\d{10}$/.test(rawTimestamp)) return false;
  const timestamp = Number(rawTimestamp);
  return (
    Number.isSafeInteger(timestamp) &&
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) <=
      MAX_CLOCK_SKEW_SECONDS
  );
}

function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader?.startsWith("v1=")) return false;

  const receivedHex = signatureHeader.slice(3);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const received = Buffer.from(receivedHex, "hex");
  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest();

  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function findUserBySubject(
  tx: Prisma.TransactionClient,
  subject: string
) {
  const account = await tx.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: SSO_PROVIDER_ID,
        accountId: subject,
      },
    },
    include: { user: true },
  });

  return account?.user ?? null;
}

async function provisionUser(
  tx: Prisma.TransactionClient,
  event: ProvisioningEvent
) {
  const profile = event.data.user;
  const email = profile.email.trim().toLowerCase();
  const existingBySubject = await findUserBySubject(tx, profile.sub);

  if (existingBySubject) {
    await tx.user.update({
      where: { id: existingBySubject.id },
      data: {
        name: profile.name,
        email,
        emailVerified: profile.email_verified,
        image: profile.picture || null,
        isActive: true,
      },
    });
    return;
  }

  // Menangani race antara JIT login OIDC dan event provisioning. Email hanya
  // dipakai untuk menautkan record lokal yang belum memiliki akun provider;
  // identitas permanennya tetap issuer + sub.
  const existingByEmail = await tx.user.findUnique({ where: { email } });
  const existingSsoAccount = existingByEmail
    ? await tx.account.findFirst({
        where: {
          userId: existingByEmail.id,
          providerId: SSO_PROVIDER_ID,
        },
      })
    : null;
  if (existingSsoAccount) {
    throw new Error("identity_email_conflict");
  }

  const user = existingByEmail
    ? await tx.user.update({
        where: { id: existingByEmail.id },
        data: {
          name: profile.name,
          emailVerified: profile.email_verified,
          image: profile.picture || null,
          isActive: true,
        },
      })
    : await tx.user.create({
        data: {
          id: profile.sub,
          name: profile.name,
          email,
          emailVerified: profile.email_verified,
          image: profile.picture || null,
          role: "SEKRETARIS_PAC",
          isActive: true,
        },
      });

  await tx.account.create({
    data: {
      userId: user.id,
      providerId: SSO_PROVIDER_ID,
      accountId: profile.sub,
    },
  });
}

async function unprovisionUser(
  tx: Prisma.TransactionClient,
  subject: string
) {
  const user = await findUserBySubject(tx, subject);
  if (!user) return;

  await tx.user.update({
    where: { id: user.id },
    data: { isActive: false, lastLogoutAt: new Date() },
  });
  await tx.session.deleteMany({ where: { userId: user.id } });
  await tx.account.updateMany({
    where: { userId: user.id, providerId: SSO_PROVIDER_ID },
    data: {
      accessToken: null,
      refreshToken: null,
      idToken: null,
      expiresAt: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    },
  });
}

export default async function ssoProvisioningRoutes(
  fastify: FastifyInstance
) {
  fastify.addContentTypeParser(
    "application/cloudevents+json",
    { parseAs: "buffer", bodyLimit: 64 * 1024 },
    (_request, body, done) => done(null, body)
  );

  fastify.post(
    "/internal/sso/provisioning",
    { schema: { tags: ["SSO Provisioning"] } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      const secret = fastify.config.SSO_PROVISIONING_SECRET?.trim();
      if (!secret || secret.length < 32) {
        request.log.error("SSO provisioning secret belum dikonfigurasi");
        return reply.status(503).send({ error: "provisioning_unavailable" });
      }

      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from("");
      const timestamp = request.headers["x-sso-timestamp"] as
        | string
        | undefined;
      const signature = request.headers["x-sso-signature"] as
        | string
        | undefined;
      const headerEventId = request.headers["x-sso-event-id"] as
        | string
        | undefined;

      if (
        !validTimestamp(timestamp) ||
        !timestamp ||
        !verifySignature(secret, timestamp, rawBody, signature)
      ) {
        return reply.status(401).send({ error: "invalid_signature" });
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return reply.status(400).send({ error: "invalid_json" });
      }

      const parsed = eventSchema.safeParse(decoded);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_event" });
      }

      const event = parsed.data;
      if (
        event.id !== headerEventId ||
        event.subject !== event.data.user.sub ||
        normalizeIssuer(event.source) !==
          normalizeIssuer(fastify.config.SSO_ISSUER_URL) ||
        event.data.audience !== fastify.config.SSO_CLIENT_ID
      ) {
        return reply.status(403).send({ error: "event_not_allowed" });
      }

      const eventIdentifier = `sso:event:${event.id}`;
      const watermarkIdentifier = `sso:watermark:${event.source}:${event.data.audience}:${event.subject}`;
      const eventTime = new Date(event.time);
      let outcome: "processed" | "duplicate" | "stale" = "processed";

      await fastify.prisma.$transaction(async (tx) => {
        // Serialisasi per user mencegah event assigned lama menimpa unassigned
        // yang lebih baru ketika beberapa worker menerima event bersamaan.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${watermarkIdentifier}))`;

        const duplicate = await tx.ssoState.findFirst({
          where: { identifier: eventIdentifier, value: "processed" },
        });
        if (duplicate) {
          outcome = "duplicate";
          return;
        }

        const watermark = await tx.ssoState.findFirst({
          where: { identifier: watermarkIdentifier },
          orderBy: { updatedAt: "desc" },
        });
        if (watermark && new Date(watermark.value) >= eventTime) {
          outcome = "stale";
        } else {
          if (event.type === "user.unassigned") {
            await unprovisionUser(tx, event.subject);
          } else {
            await provisionUser(tx, event);
          }

          if (watermark) {
            await tx.ssoState.update({
              where: { id: watermark.id },
              data: {
                value: eventTime.toISOString(),
                expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
              },
            });
          } else {
            await tx.ssoState.create({
              data: {
                identifier: watermarkIdentifier,
                value: eventTime.toISOString(),
                expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
              },
            });
          }
        }

        await tx.ssoState.create({
          data: {
            identifier: eventIdentifier,
            value: "processed",
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
          },
        });
      });

      return reply.status(200).send({ received: true, outcome });
    }
  );
}
