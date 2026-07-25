import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/me",
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      return reply.send({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          periodeAktifId: user.periodeAktifId,
          image: user.image,
          createdAt: user.createdAt,
        },
      });
    }
  );
}
