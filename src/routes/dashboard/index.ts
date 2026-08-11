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

        const query = request.query as { periodeId?: string };
        const reqPeriodeId = query.periodeId;

        // Fetch active period name based on reqPeriodeId or isActive flag
        let periodeAktifName = "-";
        let periodeId: string | null = null;
        let isPeriodeAktif = false;
        let activePeriode = null;

        if (reqPeriodeId) {
          activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId, id: reqPeriodeId },
            select: { id: true, nama: true, isActive: true },
          });
        }

        if (!activePeriode) {
          activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId, isActive: true },
            select: { id: true, nama: true, isActive: true },
          });
        }
        
        if (activePeriode) {
          periodeAktifName = activePeriode.nama;
          periodeId = activePeriode.id;
          isPeriodeAktif = activePeriode.isActive;
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
          // CABANG sees everything scoped to their current period
          const filterCabang = periodeId ? { periodeId } : {};
          const filterPengajuan = periodeId ? { periodeId } : {}; // uses periodeId for cabang
          
          const totalSurat = await fastify.prisma.arsipSurat.count({ where: filterCabang });
          const totalSP = await fastify.prisma.berkasSP.count({ where: filterCabang });
          const totalPimpinan = await fastify.prisma.berkasPimpinan.count({ where: filterCabang });
          const totalPengajuan = await fastify.prisma.pengajuanBerkas.count({ where: filterPengajuan });
          const totalKegiatan = await fastify.prisma.agendaKegiatan.count({ where: filterCabang });
          const totalPresensi = await fastify.prisma.presensi.count({ where: filterCabang });

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
              isPeriodeAktif: isPeriodeAktif,
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
          // PAC sees only their own data scoped to their period
          const filterPac = periodeId ? { userId, periodeId } : { userId };
          const filterPacPengajuan = periodeId ? { userId, periodeIdPac: periodeId } : { userId };

          const totalSurat = await fastify.prisma.arsipSurat.count({ where: filterPac });
          const totalPimpinan = await fastify.prisma.berkasPimpinan.count({ where: filterPac });
          const totalPengajuan = await fastify.prisma.pengajuanBerkas.count({ where: filterPacPengajuan });
          const totalPresensi = await fastify.prisma.presensi.count({ where: filterPac });
          const userPeriode = await fastify.prisma.periode.count({ where: { userId } });

          return reply.send({
            success: true,
            data: {
              role: userRole,
              periodeAktif: periodeAktifName,
              isPeriodeAktif: isPeriodeAktif,
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
