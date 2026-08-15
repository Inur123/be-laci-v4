import type { FastifyRequest, FastifyReply } from "fastify";
import type { User, Session } from "@prisma/client";
import { getLocalSession } from "../services/session.service";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const session = await getLocalSession(request.server, request);

    if (session?.user) {
      if (!session.user.isActive) {
        return reply.status(403).send({
          success: false,
          error: { code: "USER_INACTIVE", message: "Akses LACI telah dicabut" },
        });
      }

      request.user = session.user;
      request.session = session as Session;
      return;
    }

    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu" },
    });
  } catch (error) {
    request.log.error(error, "Auth middleware error");
    return reply.status(401).send({
      success: false,
      error: { code: "AUTH_ERROR", message: "Gagal memvalidasi sesi" },
    });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    session?: Session;
  }
}
