import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { Role } from "@prisma/client";

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/dashboard - Dashboard stats dynamically tailored to the user's role
  fastify.get(
    "/dashboard",
    {
      schema: { tags: ["Dashboard"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const userRole = user.role;
        const userId = user.id;

        // Fetch active period name based on isActive flag in Periode table
        let periodeAktifName = "-";
        const activePeriode = await fastify.prisma.periode.findFirst({
          where: { 
            userId: userId,
            isActive: true 
          },
          select: { nama: true },
        });
        
        if (activePeriode) {
          periodeAktifName = activePeriode.nama;
        }

        // 1. Manajamen User / Data Anggota (Aktif & Verified)
        // Per user request: "manajeme user itu ambil total dari smeua user yang statsunya aktve dan email verif"
        const totalAnggotaAktif = await fastify.prisma.user.count({
          where: { 
            isActive: true, 
            emailVerified: true,
            role: Role.SEKRETARIS_PAC
          },
        });

        // 2. Periode (Owned by the current user)
        const totalPeriode = await fastify.prisma.periode.count({
          where: { userId }
        });

        // 3. Prepare data specific to the role
        if (userRole === Role.SEKRETARIS_CABANG) {
          // CABANG sees everything
          const totalSurat = await fastify.prisma.arsipSurat.count();
          const totalSP = await fastify.prisma.berkasSP.count();
          const totalPimpinan = await fastify.prisma.berkasPimpinan.count();
          const totalPengajuan = await fastify.prisma.pengajuanBerkas.count();
          const totalKegiatan = await fastify.prisma.agendaKegiatan.count();
          const totalPresensi = await fastify.prisma.presensi.count();

          // Top 5 PACs
          const topPacUsers = await fastify.prisma.user.findMany({
            where: { 
              role: Role.SEKRETARIS_PAC,
              isActive: true,
              emailVerified: true
            },
            include: {
              _count: {
                select: { arsipSurats: true, pengajuanBerkass: true },
              },
            },
            orderBy: { arsipSurats: { _count: 'desc' } },
            take: 5,
          });

          const topPacs = topPacUsers.map((pUser: any) => ({
            name: pUser.name,
            arsipSurat: pUser._count?.arsipSurats || 0,
            pengajuan: pUser._count?.pengajuanBerkass || 0,
            skor: (pUser._count?.arsipSurats || 0) * 2 + (pUser._count?.pengajuanBerkass || 0) * 5,
          }));

          // Active PAC users (email verified and active)
          const totalPacAktif = await fastify.prisma.user.count({
            where: {
              role: Role.SEKRETARIS_PAC,
              isActive: true,
              emailVerified: true,
            },
          });

          return reply.send({
            success: true,
            data: {
              role: userRole,
              periodeAktif: periodeAktifName,
              stats: {
                anggota: totalAnggotaAktif,
                surat: totalSurat,
                sp: totalSP,
                pimpinan: totalPimpinan,
                pengajuan: totalPengajuan,
                kegiatan: totalKegiatan,
                periode: totalPeriode,
                presensi: totalPresensi,
                manajemenUser: totalAnggotaAktif,
                pacAktif: totalPacAktif,
              },
              topPacs,
              // Dummy trend data for UI demonstration
              trends: [
                { name: 'Mar', value: 0 },
                { name: 'Apr', value: 210 },
                { name: 'Mei', value: 30 },
                { name: 'Jun', value: 5 },
                { name: 'Jul', value: 10 },
                { name: 'Agu', value: 0 },
              ],
            },
          });
        } else {
          // PAC sees only their own data
          const totalSurat = await fastify.prisma.arsipSurat.count({ where: { userId } });
          const totalPimpinan = await fastify.prisma.berkasPimpinan.count({ where: { userId } });
          const totalPengajuan = await fastify.prisma.pengajuanBerkas.count({ where: { userId } });
          const totalPresensi = await fastify.prisma.presensi.count({ where: { userId } });
          const userPeriode = await fastify.prisma.periode.count({ where: { userId } });

          return reply.send({
            success: true,
            data: {
              role: userRole,
              periodeAktif: periodeAktifName,
              stats: {
                anggota: 0, // PAC specific members if any
                surat: totalSurat,
                pimpinan: totalPimpinan,
                pengajuan: totalPengajuan,
                periode: userPeriode,
                presensi: totalPresensi,
              },
              // Dummy trend data for PAC
              trends: [
                { name: 'Mar', value: 0 },
                { name: 'Apr', value: 0 },
                { name: 'Mei', value: 0 },
                { name: 'Jun', value: 0 },
                { name: 'Jul', value: 0 },
                { name: 'Agu', value: 0 },
              ],
            },
          });
        }

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
