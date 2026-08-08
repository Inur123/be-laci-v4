import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { Role } from "@prisma/client";

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/dashboard/monitoring - Get dynamic Monitoring Wilayah stats
  fastify.get(
    "/dashboard/monitoring",
    {
      schema: { tags: ["Dashboard"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const totalAnggota = await fastify.prisma.anggota.count();
        const totalAdministrasi = await fastify.prisma.pengajuanBerkas.count();

        // PAC Aktif = Role PAC, isActive true, emailVerified true
        const pacAktif = await fastify.prisma.user.count({
          where: { role: Role.SEKRETARIS_PAC, isActive: true, emailVerified: true },
        });

        // Verif vs Pending
        const pacVerif = await fastify.prisma.user.count({
          where: { role: Role.SEKRETARIS_PAC, emailVerified: true },
        });
        const pacPending = await fastify.prisma.user.count({
          where: { role: Role.SEKRETARIS_PAC, emailVerified: false },
        });

        // Top 5 PAC by number of Anggota
        // We get users with role PAC, order by the count of anggota descending
        const topPacUsers = await fastify.prisma.user.findMany({
          where: { role: Role.SEKRETARIS_PAC },
          include: {
            _count: {
              select: { anggota: true, arsipSurats: true },
            },
          },
          orderBy: {
            anggota: {
              _count: 'desc'
            }
          },
          take: 5,
        });

        const topPacs = topPacUsers.map((user: any) => ({
          name: user.name,
          totalAnggota: user._count?.anggota || 0,
          totalArsipSurat: user._count?.arsipSurats || 0,
        }));

        return reply.send({
          success: true,
          data: {
            totalAnggota,
            totalAdministrasi,
            pacAktif,
            pacVerif,
            pacPending,
            topPacs,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          message: "Terjadi kesalahan saat memuat data dashboard",
          error: error.message,
        });
      }
    }
  );
};

export default dashboardRoutes;
