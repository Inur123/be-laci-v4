import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { Role } from "@prisma/client";
import bcryptjs from "bcryptjs";

function getDeviceInfo(request: FastifyRequest) {
  const customDevice = request.headers["x-client-device"] as string;
  const userAgent = request.headers["user-agent"] as string;
  const ipAddress = request.ip;
  const location = request.headers["x-user-location"] as string | undefined;
  
  const device = customDevice || (userAgent?.includes("Mobile") || userAgent?.includes("Dart") ? "Mobile" : "Web");
  
  return { ipAddress, userAgent, device, location };
}

export default async function userManagementRoutes(fastify: FastifyInstance) {
  // GET /api/users — List all users (Hanya Sekretaris Cabang)
  fastify.get(
    "/users",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await fastify.prisma.user.findMany({
        where: { role: Role.SEKRETARIS_PAC },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
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

  // GET /api/users/filter-options — List users for dropdown (active, verified, has active periode)
  fastify.get(
    "/users/filter-options",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await fastify.prisma.user.findMany({
        where: {
          isActive: true,
          emailVerified: true,
          periodes: {
            some: {
              isActive: true,
            },
          },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          role: true,
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
      schema: { tags: ["Manajemen Pengguna (User)"] },
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

      const sessionUser = request.user as any;
      if (sessionUser?.id) {
        fastify.prisma.periode.findFirst({ where: { userId: sessionUser.id, isActive: true } }).then(activePeriode => {
          if (activePeriode) {
            const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
            return fastify.prisma.logActivity.create({
              data: {
                userId: sessionUser.id,
                periodeId: activePeriode.id,
                action: "UPDATE",
                module: "ANGGOTA",
                description: `Mengubah status akun ${updatedUser.name} menjadi ${isActive ? "AKTIF" : "NONAKTIF"}`,
                ipAddress, userAgent, device, location
              }
            });
          }
        }).catch(console.error);
      }

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
      schema: { tags: ["Manajemen Pengguna (User)"] },
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

      const sessionUser = request.user as any;
      if (sessionUser?.id) {
        fastify.prisma.periode.findFirst({ where: { userId: sessionUser.id, isActive: true } }).then(activePeriode => {
          if (activePeriode) {
            const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
            return fastify.prisma.logActivity.create({
              data: {
                userId: sessionUser.id,
                periodeId: activePeriode.id,
                action: "UPDATE",
                module: "ANGGOTA",
                description: `Mengubah role ${updatedUser.name} menjadi ${role}`,
                ipAddress, userAgent, device, location
              }
            });
          }
        }).catch(console.error);
      }

      return reply.send({
        success: true,
        message: `Role ${updatedUser.name} berhasil diubah menjadi ${role}`,
        data: updatedUser,
      });
    }
  );

  // GET /api/users/stats — Dashboard stats for users
  fastify.get(
    "/users/stats",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const totalUser = await fastify.prisma.user.count({ where: { role: Role.SEKRETARIS_PAC } });
      const akunAktif = await fastify.prisma.user.count({ where: { role: Role.SEKRETARIS_PAC, isActive: true } });
      const akunNonaktif = await fastify.prisma.user.count({ where: { role: Role.SEKRETARIS_PAC, isActive: false } });

      return reply.send({
        success: true,
        data: {
          totalUser,
          akunAktif,
          akunNonaktif,
        },
      });
    }
  );

  // GET /api/users/:id/detail — Comprehensive user details
  fastify.get<{ Params: { id: string } }>(
    "/users/:id/detail",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request, reply) => {
      const { id } = request.params;

      const user = await fastify.prisma.user.findUnique({
        where: { id },
        include: {
          periodes: {
            where: { isActive: true },
          },
        },
      });

      if (!user) {
        return reply.status(404).send({ success: false, message: "User tidak ditemukan" });
      }

      const activePeriode = user.periodes && user.periodes.length > 0 ? user.periodes[0] : null;
      const periodeAktifId = activePeriode ? activePeriode.id : user.periodeAktifId;
      const periodeAktifName = activePeriode ? (activePeriode as any).nama : null;

      // Activity Stats
      const totalArsipSurat = periodeAktifId ? await fastify.prisma.arsipSurat.count({ where: { userId: id, periodeId: periodeAktifId } }) : 0;
      const totalPengajuan = periodeAktifId ? await fastify.prisma.pengajuanBerkas.count({ where: { userId: id, periodeIdPac: periodeAktifId } }) : 0;
      const totalAnggota = 0; // Data dipindah ke sistem baru
      const totalBerkasPimpinan = periodeAktifId ? await fastify.prisma.berkasPimpinan.count({ where: { userId: id, periodeId: periodeAktifId } }) : 0;
      const totalLogActivities = await fastify.prisma.logActivity.count({ where: { userId: id } });

      // Pendidikan Stats (Data dipindah ke sistem baru)
      const pendidikanList: any[] = [];

      // Perkaderan Stats (Data dipindah ke sistem baru)
      const perkaderanList: any[] = [];

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogoutAt: user.lastLogoutAt,
            periodeAktifId: user.periodeAktifId,
            periodeAktifName: periodeAktifName,
          },
          statsAktivitas: {
            arsipSurat: totalArsipSurat,
            pengajuanPac: totalPengajuan,
            dataAnggota: totalAnggota,
            berkasPimpinan: totalBerkasPimpinan,
            riwayatLog: totalLogActivities,
          },
          statsPendidikan: pendidikanList.map(p => ({
            jenjang: p.jenjang,
            count: p._count.jenjang
          })),
          statsPengkaderan: perkaderanList.map(p => ({
            namaPerkaderan: p.namaPerkaderan,
            count: p._count.namaPerkaderan
          })),
        },
      });
    }
  );

  // POST /api/users/:id/reset-password — Reset user password to default
  fastify.post<{ Params: { id: string } }>(
    "/users/:id/reset-password",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request, reply) => {
      const { id } = request.params;
      
      const user = await fastify.prisma.user.findUnique({ where: { id } });
      if (!user) {
        return reply.status(404).send({ success: false, message: "User tidak ditemukan" });
      }

      const hashedPassword = await bcryptjs.hash("password", 10);

      const account = await fastify.prisma.account.findFirst({
        where: { userId: id, providerId: "credential" },
      });

      if (account) {
        await fastify.prisma.account.update({
          where: { id: account.id },
          data: { password: hashedPassword },
        });
      } else {
        return reply.status(400).send({ 
          success: false, 
          message: "User tidak menggunakan autentikasi password (mungkin login via Google)." 
        });
      }

      const sessionUser = request.user as any;
      if (sessionUser?.id) {
        fastify.prisma.periode.findFirst({ where: { userId: sessionUser.id, isActive: true } }).then(activePeriode => {
          if (activePeriode) {
            const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
            return fastify.prisma.logActivity.create({
              data: {
                userId: sessionUser.id,
                periodeId: activePeriode.id,
                action: "UPDATE",
                module: "ANGGOTA",
                description: `Mereset password akun ${user.name}`,
                ipAddress, userAgent, device, location
              }
            });
          }
        }).catch(console.error);
      }

      return reply.send({
        success: true,
        message: "Password berhasil di-reset menjadi 'password'",
      });
    }
  );

  // DELETE /api/users/:id — Permanently delete user
  fastify.delete<{ Params: { id: string } }>(
    "/users/:id",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
    },
    async (request, reply) => {
      const { id } = request.params;

      const user = await fastify.prisma.user.findUnique({ where: { id } });
      if (!user) {
        return reply.status(404).send({ success: false, message: "User tidak ditemukan" });
      }

      await fastify.prisma.user.delete({ where: { id } });

      const sessionUser = request.user as any;
      if (sessionUser?.id) {
        fastify.prisma.periode.findFirst({ where: { userId: sessionUser.id, isActive: true } }).then(activePeriode => {
          if (activePeriode) {
            const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
            return fastify.prisma.logActivity.create({
              data: {
                userId: sessionUser.id,
                periodeId: activePeriode.id,
                action: "DELETE",
                module: "ANGGOTA",
                description: `Menghapus akun ${user.name} secara permanen`,
                ipAddress, userAgent, device, location
              }
            });
          }
        }).catch(console.error);
      }

      return reply.send({
        success: true,
        message: `Akun ${user.name} beserta seluruh datanya berhasil dihapus permanen.`,
      });
    }
  );
}
