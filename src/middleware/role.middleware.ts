import type { FastifyRequest, FastifyReply } from "fastify";
import type { Role } from "@prisma/client";

export function requireRole(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu" },
      });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Anda tidak memiliki hak akses ke fitur ini" },
      });
    }
  };
}
