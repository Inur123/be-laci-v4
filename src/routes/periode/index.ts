import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { z } from "zod";

function getDeviceInfo(request: FastifyRequest) {
  const customDevice = request.headers["x-client-device"] as string;
  const userAgent = request.headers["user-agent"] as string;
  const ipAddress = request.ip;
  const location = request.headers["x-user-location"] as string | undefined;
  
  const device = customDevice || (userAgent?.includes("Mobile") || userAgent?.includes("Dart") ? "Mobile" : "Web");
  
  return { ipAddress, userAgent, device, location };
}

export default async function periodeRoutes(fastify: FastifyInstance) {
  // GET /api/periodes — Ambil semua periode milik user yang sedang login
  fastify.get(
    "/periodes",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Get All Periodes",
        description: "Fetch all periodes belonging to the authenticated user.",
        tags: ["Periode"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;

      const periodes = await fastify.prisma.periode.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nama: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              arsipSurats: true,
              agendaKegiatan: true,
              presensi: true,
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: periodes,
      });
    }
  );

  // POST /api/periodes — Buat periode baru
  fastify.post(
    "/periodes",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Create Periode",
        description: "Create a new periode for the authenticated user.",
        tags: ["Periode"],
        body: z.object({
          nama: z.string().min(1, "Nama periode wajib diisi"),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      const { nama } = request.body as { nama: string };

      // Cek apakah nama sudah ada untuk user ini
      const existing = await fastify.prisma.periode.findUnique({
        where: { nama_userId: { nama, userId } },
      });

      if (existing) {
        return reply.status(400).send({
          success: false,
          message: "Periode dengan nama tersebut sudah ada",
        });
      }

      // Cek apakah ini periode pertama user
      const count = await fastify.prisma.periode.count({ where: { userId } });

      const periode = await fastify.prisma.periode.create({
        data: {
          nama,
          userId,
          isActive: count === 0, // Aktifkan otomatis jika ini periode pertama
        },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: periode.id,
          action: "CREATE",
          module: "PERIODE",
          description: `Membuat periode baru: ${periode.nama}`,
          ipAddress,
          userAgent,
          device,
          location,
        },
      });

      return reply.status(201).send({
        success: true,
        message: "Periode berhasil dibuat",
        data: periode,
      });
    }
  );

  // PATCH /api/periodes/:id — Edit nama periode
  fastify.patch<{ Params: { id: string }; Body: { nama: string } }>(
    "/periodes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Update Periode",
        description: "Update the name of an existing periode.",
        tags: ["Periode"],
        body: z.object({
          nama: z.string().min(1, "Nama periode wajib diisi"),
        }),
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;
      const { nama } = request.body;

      // Pastikan periode milik user ini
      const periode = await fastify.prisma.periode.findFirst({
        where: { id, userId },
      });

      if (!periode) {
        return reply.status(404).send({
          success: false,
          message: "Periode tidak ditemukan",
        });
      }

      // Cek duplikasi nama
      const existing = await fastify.prisma.periode.findFirst({
        where: { nama, userId, id: { not: id } },
      });

      if (existing) {
        return reply.status(400).send({
          success: false,
          message: "Periode dengan nama tersebut sudah ada",
        });
      }

      const updated = await fastify.prisma.periode.update({
        where: { id },
        data: { nama },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: updated.id,
          action: "UPDATE",
          module: "PERIODE",
          description: `Mengubah nama periode menjadi: ${updated.nama}`,
          ipAddress,
          userAgent,
          device,
          location,
        },
      });

      return reply.send({
        success: true,
        message: "Periode berhasil diperbarui",
        data: updated,
      });
    }
  );

  // PATCH /api/periodes/:id/activate — Set periode sebagai aktif
  fastify.patch<{ Params: { id: string } }>(
    "/periodes/:id/activate",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Activate Periode",
        description: "Set a periode as active. Only one periode can be active at a time.",
        tags: ["Periode"],
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;

      // Pastikan periode milik user ini
      const periode = await fastify.prisma.periode.findFirst({
        where: { id, userId },
      });

      if (!periode) {
        return reply.status(404).send({
          success: false,
          message: "Periode tidak ditemukan",
        });
      }

      // Nonaktifkan semua periode user, lalu aktifkan yang dipilih
      await fastify.prisma.$transaction([
        fastify.prisma.periode.updateMany({
          where: { userId },
          data: { isActive: false },
        }),
        fastify.prisma.periode.update({
          where: { id },
          data: { isActive: true },
        }),
      ]);

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: id,
          action: "UPDATE",
          module: "PERIODE",
          description: `Mengaktifkan periode: ${periode.nama}`,
          ipAddress,
          userAgent,
          device,
          location,
        },
      });

      return reply.send({
        success: true,
        message: `Periode "${periode.nama}" berhasil diaktifkan`,
        data: { ...periode, isActive: true },
      });
    }
  );

  // DELETE /api/periodes/:id — Hapus periode
  fastify.delete<{ Params: { id: string } }>(
    "/periodes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Delete Periode",
        description: "Delete a periode and all related data (cascade).",
        tags: ["Periode"],
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;

      // Pastikan periode milik user ini
      const periode = await fastify.prisma.periode.findFirst({
        where: { id, userId },
      });

      if (!periode) {
        return reply.status(404).send({
          success: false,
          message: "Periode tidak ditemukan",
        });
      }

      // Jangan izinkan hapus periode yang sedang aktif
      if (periode.isActive) {
        return reply.status(400).send({
          success: false,
          message: "Tidak dapat menghapus periode yang sedang aktif. Silakan aktifkan periode lain terlebih dahulu.",
        });
      }

      await fastify.prisma.periode.delete({ where: { id } });

      return reply.send({
        success: true,
        message: `Periode "${periode.nama}" berhasil dihapus`,
      });
    }
  );
}
