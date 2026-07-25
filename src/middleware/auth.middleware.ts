import type { FastifyRequest, FastifyReply } from "fastify";
import type { User, Session } from "@prisma/client";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // BetterAuth Official API - handles both Session Cookie & Bearer Token automatically
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          value.forEach((v) => headers.append(key, v));
        } else {
          headers.set(key, value);
        }
      }
    }

    const session = await request.server.auth.api.getSession({
      headers,
    });

    if (session?.user) {
      const user = await request.server.prisma.user.findUnique({
        where: { id: session.user.id },
      });

      if (!user) {
        return reply.status(401).send({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User tidak ditemukan" },
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          success: false,
          error: { code: "USER_INACTIVE", message: "Akun Anda belum aktif/dinonaktifkan" },
        });
      }

      request.user = user;
      request.session = session.session as unknown as Session;
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
