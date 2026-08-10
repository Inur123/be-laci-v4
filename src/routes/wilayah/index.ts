import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";

function getDeviceInfo(request: FastifyRequest) {
  const customDevice = request.headers["x-client-device"] as string;
  const userAgent = request.headers["user-agent"] as string;
  const ipAddress = request.ip;
  const location = request.headers["x-user-location"] as string | undefined;
  
  const device = customDevice || (userAgent?.includes("Mobile") || userAgent?.includes("Dart") ? "Mobile" : "Web");
  
  return { ipAddress, userAgent, device, location };
}

export default async function wilayahRoutes(fastify: FastifyInstance) {
  // ==========================================
  // RANTING CRUD (Dikelola oleh PAC)
  // ==========================================
  fastify.get(
    "/wilayah/ranting",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Get All Ranting",
        tags: ["Wilayah"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id; // PAC yang login

      const rantings = await fastify.prisma.ranting.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ success: true, data: rantings });
    }
  );

  fastify.post(
    "/wilayah/ranting",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Create Ranting",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().min(1, "Nama Ranting wajib diisi"),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      const { nama } = request.body as { nama: string };

      const existing = await fastify.prisma.ranting.findFirst({
        where: { nama, userId },
      });

      if (existing) {
        return reply.status(400).send({ success: false, message: "Ranting dengan nama tersebut sudah ada" });
      }

      const ranting = await fastify.prisma.ranting.create({
        data: { nama, userId },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "CREATE",
          module: "RANTING",
          description: `Menambahkan Ranting baru: ${nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.status(201).send({ success: true, message: "Ranting berhasil ditambahkan", data: ranting });
    }
  );

  fastify.patch<{ Params: { id: string }; Body: { nama: string } }>(
    "/wilayah/ranting/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Update Ranting",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().min(1, "Nama Ranting wajib diisi"),
        }),
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;
      const { nama } = request.body;

      const ranting = await fastify.prisma.ranting.findFirst({ where: { id, userId } });
      if (!ranting) {
        return reply.status(404).send({ success: false, message: "Ranting tidak ditemukan" });
      }

      const updated = await fastify.prisma.ranting.update({
        where: { id },
        data: { nama },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "UPDATE",
          module: "RANTING",
          description: `Mengubah nama Ranting menjadi: ${nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.send({ success: true, message: "Ranting berhasil diperbarui", data: updated });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/wilayah/ranting/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Delete Ranting",
        tags: ["Wilayah"],
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;

      const ranting = await fastify.prisma.ranting.findFirst({ where: { id, userId } });
      if (!ranting) {
        return reply.status(404).send({ success: false, message: "Ranting tidak ditemukan" });
      }

      await fastify.prisma.ranting.delete({ where: { id } });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "DELETE",
          module: "RANTING",
          description: `Menghapus Ranting: ${ranting.nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.send({ success: true, message: "Ranting berhasil dihapus" });
    }
  );

  // ==========================================
  // PK CRUD (Dikelola oleh PAC)
  // ==========================================
  fastify.get(
    "/wilayah/pk",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Get All PK",
        tags: ["Wilayah"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id; // PAC yang login

      const pks = await fastify.prisma.pK.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ success: true, data: pks });
    }
  );

  fastify.post(
    "/wilayah/pk",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Create PK",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().min(1, "Nama PK wajib diisi"),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      const { nama } = request.body as { nama: string };

      const existing = await fastify.prisma.pK.findFirst({
        where: { nama, userId },
      });

      if (existing) {
        return reply.status(400).send({ success: false, message: "PK dengan nama tersebut sudah ada" });
      }

      const pk = await fastify.prisma.pK.create({
        data: { nama, userId },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "CREATE",
          module: "PK",
          description: `Menambahkan PK baru: ${nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.status(201).send({ success: true, message: "PK berhasil ditambahkan", data: pk });
    }
  );

  fastify.patch<{ Params: { id: string }; Body: { nama: string } }>(
    "/wilayah/pk/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Update PK",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().min(1, "Nama PK wajib diisi"),
        }),
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;
      const { nama } = request.body;

      const pk = await fastify.prisma.pK.findFirst({ where: { id, userId } });
      if (!pk) {
        return reply.status(404).send({ success: false, message: "PK tidak ditemukan" });
      }

      const updated = await fastify.prisma.pK.update({
        where: { id },
        data: { nama },
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "UPDATE",
          module: "PK",
          description: `Mengubah nama PK menjadi: ${nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.send({ success: true, message: "PK berhasil diperbarui", data: updated });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/wilayah/pk/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Delete PK",
        tags: ["Wilayah"],
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;

      const pk = await fastify.prisma.pK.findFirst({ where: { id, userId } });
      if (!pk) {
        return reply.status(404).send({ success: false, message: "PK tidak ditemukan" });
      }

      await fastify.prisma.pK.delete({ where: { id } });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      await fastify.prisma.logActivity.create({
        data: {
          userId,
          periodeId: request.user!.periodeAktifId || "",
          action: "DELETE",
          module: "PK",
          description: `Menghapus PK: ${pk.nama}`,
          ipAddress, userAgent, device, location,
        },
      });

      return reply.send({ success: true, message: "PK berhasil dihapus" });
    }
  );

  // ==========================================
  // PUBLIC / MASTER API (Untuk Sistem Baru)
  // ==========================================
  fastify.get(
    "/master-wilayah",
    {
      schema: {
        summary: "Get Master Wilayah",
        description: "Public API to get Cabang, PAC, Ranting, and PK list for dropdowns in the new registration system.",
        tags: ["Wilayah", "Public"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Ambil semua Cabang
      const cabangList = await fastify.prisma.user.findMany({
        where: { role: "SEKRETARIS_CABANG", isActive: true },
        select: { id: true, name: true, periodeAktifId: true },
      });

      // 2. Ambil semua PAC
      const pacList = await fastify.prisma.user.findMany({
        where: { role: "SEKRETARIS_PAC", isActive: true },
        select: { id: true, name: true, periodeAktifId: true },
      });

      // 3. Ambil semua Ranting
      const rantingList = await fastify.prisma.ranting.findMany({
        select: { id: true, nama: true, userId: true },
      });

      // 4. Ambil semua PK
      const pkList = await fastify.prisma.pK.findMany({
        select: { id: true, nama: true, userId: true },
      });

      return reply.send({
        success: true,
        data: {
          cabang: cabangList,
          pac: pacList,
          ranting: rantingList,
          pk: pkList,
        },
      });
    }
  );
}
