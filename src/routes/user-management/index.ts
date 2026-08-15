import { Role } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

const cabangOnly = [requireAuth, requireRole(Role.SEKRETARIS_CABANG)];

export default async function userManagementRoutes(fastify: FastifyInstance) {
  // Daftar ini hanya membaca pengguna yang assignment SSO-nya masih aktif.
  // Aktivasi, pencabutan, identitas, dan verifikasi dikelola oleh SSO.
  fastify.get(
    "/users",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: cabangOnly,
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const users = await fastify.prisma.user.findMany({
        where: { role: Role.SEKRETARIS_PAC, isActive: true },
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
      return reply.send({ success: true, data: users });
    }
  );

  fastify.get(
    "/users/filter-options",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: cabangOnly,
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const users = await fastify.prisma.user.findMany({
        where: {
          isActive: true,
          emailVerified: true,
          periodes: { some: { isActive: true } },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      });
      return reply.send({ success: true, data: users });
    }
  );

  fastify.get(
    "/users/stats",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: cabangOnly,
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const akunAktif = await fastify.prisma.user.count({
        where: { role: Role.SEKRETARIS_PAC, isActive: true },
      });
      return reply.send({
        success: true,
        data: { totalUser: akunAktif, akunAktif, akunNonaktif: 0 },
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/users/:id/detail",
    {
      schema: { tags: ["Manajemen Pengguna (User)"] },
      preHandler: cabangOnly,
    },
    async (request, reply) => {
      const user = await fastify.prisma.user.findFirst({
        where: { id: request.params.id, isActive: true },
        include: { periodes: { where: { isActive: true }, take: 1 } },
      });
      if (!user) {
        return reply
          .status(404)
          .send({ success: false, message: "Pengguna aktif tidak ditemukan" });
      }

      const periodeAktifId = user.periodes[0]?.id ?? user.periodeAktifId;
      const [arsipSurat, pengajuanPac, berkasPimpinan, riwayatLog] =
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
        ]);

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
            periodeAktifId,
            periodeAktifName: user.periodes[0]?.nama ?? null,
          },
          statsAktivitas: {
            arsipSurat,
            pengajuanPac,
            dataAnggota: 0,
            berkasPimpinan,
            riwayatLog,
          },
          statsPendidikan: [],
          statsPengkaderan: [],
        },
      });
    }
  );
}
