import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { z } from "zod";

const getAnggotaQuerySchema = z.object({
  periodeId: z.string().optional(),
  filterUserId: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["PENDING", "TERVERIFIKASI", "DITOLAK"]),
});

export default async function anggotaRoutes(fastify: FastifyInstance) {
  // Hanya bisa diakses jika sudah login SSO (User Laci)
  fastify.addHook("preHandler", requireAuth);

  fastify.get(
    "/",
    {
      schema: { 
        tags: ["Anggota"],
        querystring: getAnggotaQuerySchema
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { periodeId, filterUserId } = request.query as z.infer<typeof getAnggotaQuerySchema>;

      const reqPeriodeId = request.cookies?.viewingPeriodeId || periodeId;
      let targetPeriodeId = reqPeriodeId || user.periodeAktifId;

      if (!targetPeriodeId) {
        const activePeriode = await fastify.prisma.periode.findFirst({
          where: { userId: user.id, isActive: true },
        });
        if (activePeriode) {
          targetPeriodeId = activePeriode.id;
        } else {
          const latestPeriode = await fastify.prisma.periode.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
          });
          if (latestPeriode) {
            targetPeriodeId = latestPeriode.id;
          }
        }
      }

      const isCabang = user.role.includes("CABANG");
      const whereClause: any = { };
      
      if (isCabang) {
        if (filterUserId && filterUserId !== "Semua PAC") {
          whereClause.userId = filterUserId;
        }
      } else {
        whereClause.userId = user.id;
      }
      
      let periodeName = "-";
      if (targetPeriodeId) {
        whereClause.periodeId = targetPeriodeId;
        const p = await fastify.prisma.periode.findUnique({ where: { id: targetPeriodeId }});
        if (p) periodeName = p.nama;
      }

      const anggota = await fastify.prisma.anggota.findMany({
        where: whereClause,
        include: {
          periode: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return reply.send({
        success: true,
        data: anggota,
        periodeName,
      });
    }
  );

  fastify.put(
    "/:id/status",
    {
      schema: { 
        tags: ["Anggota"],
        params: z.object({ id: z.string() }),
        body: updateStatusSchema
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { status } = request.body as z.infer<typeof updateStatusSchema>;

      const anggota = await fastify.prisma.anggota.findUnique({
        where: { id },
      });

      if (!anggota) {
        return reply.status(404).send({
          success: false,
          message: "Data Anggota tidak ditemukan",
        });
      }

      // Pastikan data ini milik user yang sedang login
      if (anggota.userId !== user.id) {
        return reply.status(403).send({
          success: false,
          message: "Anda tidak memiliki akses untuk mengubah data ini",
        });
      }

      const updatedAnggota = await fastify.prisma.anggota.update({
        where: { id },
        data: { status },
      });

      return reply.send({
        success: true,
        message: "Status Anggota berhasil diperbarui",
        data: updatedAnggota,
      });
    }
  );
}
