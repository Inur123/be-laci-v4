import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { Role } from "@prisma/client";

export default async function userManagementRoutes(fastify: FastifyInstance) {
  // GET /api/users — List all users (Hanya Sekretaris Cabang)
  fastify.get(
    "/users",
    {
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await fastify.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          periodeAktifId: true,
          image: true,
          createdAt: true,
        },
      });

      return reply.send({
        success: true,
        data: users,
      });
    }
  );

  // PATCH /api/users/:id/status — Toggle status aktif user (Approve/Reject akun PAC)
  fastify.patch<{ Params: { id: string }; Body: { isActive: boolean } }>(
    "/users/:id/status",
    {
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { isActive } = request.body;

      const updatedUser = await fastify.prisma.user.update({
        where: { id },
        data: { isActive },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      return reply.send({
        success: true,
        message: `Status akun ${updatedUser.name} berhasil diubah menjadi ${isActive ? "AKTIF" : "NONAKTIF"}`,
        data: updatedUser,
      });
    }
  );

  // PATCH /api/users/:id/role — Set Role user (SEKRETARIS_CABANG vs SEKRETARIS_PAC)
  fastify.patch<{ Params: { id: string }; Body: { role: Role } }>(
    "/users/:id/role",
    {
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;

      const updatedUser = await fastify.prisma.user.update({
        where: { id },
        data: { role },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });

      return reply.send({
        success: true,
        message: `Role ${updatedUser.name} berhasil diubah menjadi ${role}`,
        data: updatedUser,
      });
    }
  );
}
