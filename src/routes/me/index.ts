import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/me",
    {
      schema: { tags: ["Profil Akun Saya"] },
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
          identityManagedBy: "IPNU IPPNU Magetan ID",
        },
      });
    }
  );

  fastify.get(
    "/me/stats",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userWithPeriode = await fastify.prisma.user.findUnique({
        where: { id: user.id },
        include: { periodes: { where: { isActive: true }, take: 1 } },
      });
      const periodeAktifId =
        userWithPeriode?.periodes[0]?.id ?? user.periodeAktifId;

      const [arsipSurat, pengajuanPac, berkasPimpinan, riwayatLog, periode] =
        await Promise.all([
          periodeAktifId
            ? fastify.prisma.arsipSurat.count({
                where: { userId: user.id, periodeId: periodeAktifId },
              })
            : 0,
          periodeAktifId
            ? fastify.prisma.pengajuanBerkas.count({
                where: { userId: user.id, periodeIdPac: periodeAktifId },
              })
            : 0,
          periodeAktifId
            ? fastify.prisma.berkasPimpinan.count({
                where: { userId: user.id, periodeId: periodeAktifId },
              })
            : 0,
          fastify.prisma.logActivity.count({ where: { userId: user.id } }),
          fastify.prisma.periode.count({ where: { userId: user.id } }),
        ]);

      return reply.send({
        success: true,
        data: {
          statsAktivitas: {
            arsipSurat,
            pengajuanPac,
            dataAnggota: 0,
            berkasPimpinan,
            riwayatLog,
            periode,
          },
        },
      });
    }
  );
}
