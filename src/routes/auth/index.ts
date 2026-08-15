import type { FastifyInstance } from "fastify";
import {
  createAuthorizationRequest,
  exchangeAndVerifyAuthorizationCode,
} from "../../services/oidc.service";
import {
  createLocalSession,
  getLocalSession,
  revokeLocalSession,
} from "../../services/session.service";

function frontendLoginError(fastify: FastifyInstance, code: string): string {
  const url = new URL("/login", fastify.config.FRONTEND_URL);
  url.searchParams.set("error", code);
  return url.toString();
}
export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/api/auth/sso/start", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const query = request.query as { callback_url?: string };

    try {
      const target = await createAuthorizationRequest(
        fastify,
        query.callback_url
      );
      return reply.redirect(target);
    } catch (error) {
      request.log.error(error, "Gagal membuat transaksi login OIDC");
      return reply.redirect(frontendLoginError(fastify, "sso_unavailable"));
    }
  });

  fastify.get(
    "/api/auth/oauth2/callback/ipnu-sso",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const query = request.query as {
        code?: string;
        state?: string;
        iss?: string;
        error?: string;
      };

      if (query.error || !query.code || !query.state) {
        return reply.redirect(frontendLoginError(fastify, "sso_denied"));
      }

      try {
        const result = await exchangeAndVerifyAuthorizationCode(
          fastify,
          request,
          query.code,
          query.state,
          query.iss
        );
        await createLocalSession(fastify, request, reply, result.userId);
        return reply.redirect(result.callbackURL);
      } catch (error) {
        request.log.warn({ err: error }, "Callback OIDC LACI ditolak");
        return reply.redirect(frontendLoginError(fastify, "sso_invalid"));
      }
    }
  );

  fastify.get("/api/auth/get-session", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const session = await getLocalSession(fastify, request);
    if (!session || !session.user.isActive) return reply.send(null);

    return reply.send({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image,
        role: session.user.role,
        isActive: session.user.isActive,
        periodeAktifId: session.user.periodeAktifId,
      },
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
      },
    });
  });

  fastify.post("/api/auth/sign-out", async (request, reply) => {
    reply.header("cache-control", "no-store");
    await revokeLocalSession(fastify, request, reply);
    return reply.send({ success: true });
  });
}
