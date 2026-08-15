import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";
import { Role } from "@prisma/client";

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
  // RANTING CRUD
  // ==========================================
  
  // GET ALL RANTING
  fastify.get(
    "/wilayah/ranting",
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const targetPeriodeId = request.cookies?.viewingPeriodeId || user.periodeAktifId;
      
      if (user.role === Role.SEKRETARIS_CABANG) {
        // Cabang melihat semua Ranting dari semua PAC yang periodenya sedang aktif (di PAC)
        const rantings = await fastify.prisma.ranting.findMany({
          where: { dataPeriode: { some: { periode: { isActive: true } } } },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { name: true } },
            dataPeriode: {
              where: { periode: { isActive: true } },
              take: 1
            }
          }
        });
        return reply.send({ success: true, data: rantings });
      } else {
        // PAC hanya melihat miliknya di periode target
        const rantings = await fastify.prisma.ranting.findMany({
          where: { 
            userId: user.id,
            dataPeriode: { some: { periodeId: targetPeriodeId || "" } }
          },
          orderBy: { createdAt: "desc" },
          include: {
            dataPeriode: {
              where: { periodeId: targetPeriodeId || "" },
              take: 1
            }
          }
        });
        return reply.send({ success: true, data: rantings });
      }
    }
  );

  // POST (Hanya PAC)
  fastify.post(
    "/wilayah/ranting",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Create Ranting",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().min(1, "Nama Ranting wajib diisi"),
          status: z.enum(["AKTIF", "VAKUM"]).optional(),
          namaKetua: z.string().optional(),
          noHp: z.string().optional(),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) {
        return reply.status(403).send({ success: false, message: "Hanya PAC yang dapat menambah data" });
      }

      if (!user.periodeAktifId) {
        return reply.status(400).send({ success: false, message: "Periode aktif tidak ditemukan" });
      }

      const { nama, status = "AKTIF", namaKetua, noHp } = request.body as any;

      const existing = await fastify.prisma.ranting.findFirst({
        where: { nama, userId: user.id },
      });

      let rantingId = "";

      if (existing) {
        rantingId = existing.id;
        // Check if dataPeriode exists
        const existingDataPeriode = await fastify.prisma.rantingDataPeriode.findFirst({
          where: { rantingId, periodeId: user.periodeAktifId }
        });
        if (existingDataPeriode) {
           return reply.status(400).send({ success: false, message: "Data kepengurusan untuk periode ini sudah ada" });
        }
      } else {
        const newRanting = await fastify.prisma.ranting.create({
          data: { nama, userId: user.id },
        });
        rantingId = newRanting.id;
      }

      const rantingData = await fastify.prisma.rantingDataPeriode.create({
        data: {
          rantingId,
          periodeId: user.periodeAktifId,
          status,
          namaKetua,
          noHp
        }
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      fastify.prisma.logActivity.create({
        data: {
          userId: user.id,
          periodeId: user.periodeAktifId,
          action: "CREATE",
          module: "RANTING",
          description: `Menambahkan Ranting baru: ${nama}`,
          ipAddress, userAgent, device, location,
        },
      }).catch(console.error);

      return reply.status(201).send({ success: true, message: "Ranting berhasil ditambahkan", data: rantingData });
    }
  );

  // POST SYNC RANTING
  fastify.post(
    "/wilayah/ranting/sync",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Akses ditolak" });
      if (!user.periodeAktifId) return reply.status(400).send({ success: false, message: "Periode aktif tidak ditemukan" });

      const { fromPeriodeId } = request.body as { fromPeriodeId: string };
      if (!fromPeriodeId) return reply.status(400).send({ success: false, message: "Pilih periode sumber" });

      const sourceData = await fastify.prisma.rantingDataPeriode.findMany({
        where: { periodeId: fromPeriodeId, ranting: { userId: user.id } }
      });

      if (sourceData.length === 0) {
        return reply.status(400).send({ success: false, message: "Tidak ada data ranting di periode tersebut" });
      }

      const currentData = await fastify.prisma.rantingDataPeriode.findMany({
        where: { periodeId: user.periodeAktifId, ranting: { userId: user.id } }
      });
      const currentRantingIds = new Set(currentData.map(d => d.rantingId));

      const toInsert = sourceData.filter(s => !currentRantingIds.has(s.rantingId));

      if (toInsert.length === 0) {
        return reply.status(200).send({ success: true, message: "Semua data ranting sudah ada, tidak ada data baru disalin." });
      }

      await fastify.prisma.rantingDataPeriode.createMany({
        data: toInsert.map(s => ({
          rantingId: s.rantingId,
          periodeId: user.periodeAktifId!,
          status: s.status,
          namaKetua: s.namaKetua,
          noHp: s.noHp,
        }))
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      fastify.prisma.logActivity.create({
        data: {
          userId: user.id,
          periodeId: user.periodeAktifId,
          action: "UPDATE",
          module: "RANTING",
          description: `Mensinkronisasi ${toInsert.length} data Ranting dari periode lalu`,
          ipAddress, userAgent, device, location,
        },
      }).catch(console.error);

      return reply.send({ success: true, message: `Berhasil mensinkronisasi ${toInsert.length} data ranting` });
    }
  );

  // PATCH RANTING (Hanya PAC)
  fastify.patch<{ Params: { id: string }; Body: any }>(
    "/wilayah/ranting/:id",
    {
      preHandler: [requireAuth],
      schema: {
        summary: "Update Ranting",
        tags: ["Wilayah"],
        body: z.object({
          nama: z.string().optional(),
          status: z.enum(["AKTIF", "VAKUM"]).optional(),
          namaKetua: z.string().optional(),
          noHp: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) {
        return reply.status(403).send({ success: false, message: "Akses ditolak" });
      }

      const { id } = request.params;
      const { nama, status, namaKetua, noHp } = request.body as any;

      const ranting = await fastify.prisma.ranting.findFirst({ where: { id, userId: user.id } });
      if (!ranting) {
        return reply.status(404).send({ success: false, message: "Ranting tidak ditemukan" });
      }

      if (nama) {
        await fastify.prisma.ranting.update({
          where: { id },
          data: { nama },
        });
      }

      if (status !== undefined || namaKetua !== undefined || noHp !== undefined) {
         const dataPeriode = await fastify.prisma.rantingDataPeriode.findFirst({
           where: { rantingId: id, periodeId: user.periodeAktifId || "" }
         });
         
         if (dataPeriode) {
           await fastify.prisma.rantingDataPeriode.update({
             where: { id: dataPeriode.id },
             data: { status, namaKetua, noHp }
           });
         }
      }

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      fastify.prisma.logActivity.create({
        data: {
          userId: user.id,
          periodeId: user.periodeAktifId || "",
          action: "UPDATE",
          module: "RANTING",
          description: `Mengubah data Ranting: ${ranting.nama}`,
          ipAddress, userAgent, device, location,
        },
      }).catch(console.error);

      return reply.send({ success: true, message: "Ranting berhasil diperbarui" });
    }
  );

  // DELETE
  fastify.delete<{ Params: { id: string } }>(
    "/wilayah/ranting/:id",
    {
      preHandler: [requireAuth]
    },
    async (request, reply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Akses ditolak" });
      
      const { id } = request.params;
      const ranting = await fastify.prisma.ranting.findFirst({ where: { id, userId: user.id } });
      if (!ranting) return reply.status(404).send({ success: false, message: "Ranting tidak ditemukan" });

      await fastify.prisma.ranting.delete({ where: { id } });

      return reply.send({ success: true, message: "Ranting berhasil dihapus" });
    }
  );

  // ==========================================
  // PK CRUD
  // ==========================================

  // GET ALL PK
  fastify.get(
    "/wilayah/pk",
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const targetPeriodeId = request.cookies?.viewingPeriodeId || user.periodeAktifId;
      
      if (user.role === Role.SEKRETARIS_CABANG) {
        // Cabang melihat semua PK dari semua PAC yang periodenya sedang aktif (di PAC)
        const pks = await fastify.prisma.pK.findMany({
          where: { dataPeriode: { some: { periode: { isActive: true } } } },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { name: true } },
            dataPeriode: {
              where: { periode: { isActive: true } },
              take: 1
            }
          }
        });
        return reply.send({ success: true, data: pks });
      } else {
        const pks = await fastify.prisma.pK.findMany({
          where: { 
            userId: user.id,
            dataPeriode: { some: { periodeId: targetPeriodeId || "" } }
          },
          orderBy: { createdAt: "desc" },
          include: {
            dataPeriode: {
              where: { periodeId: targetPeriodeId || "" },
              take: 1
            }
          }
        });
        return reply.send({ success: true, data: pks });
      }
    }
  );

  // POST
  fastify.post(
    "/wilayah/pk",
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Hanya PAC yang dapat menambah data" });
      if (!user.periodeAktifId) return reply.status(400).send({ success: false, message: "Periode aktif tidak ditemukan" });

      const { nama, status = "AKTIF", namaKetua, noHp } = request.body as any;

      const existing = await fastify.prisma.pK.findFirst({ where: { nama, userId: user.id } });
      let pkId = "";

      if (existing) {
        pkId = existing.id;
        const existingDataPeriode = await fastify.prisma.pKDataPeriode.findFirst({
          where: { pkId, periodeId: user.periodeAktifId }
        });
        if (existingDataPeriode) return reply.status(400).send({ success: false, message: "Data kepengurusan untuk periode ini sudah ada" });
      } else {
        const newPk = await fastify.prisma.pK.create({ data: { nama, userId: user.id } });
        pkId = newPk.id;
      }

      const pkData = await fastify.prisma.pKDataPeriode.create({
        data: { pkId, periodeId: user.periodeAktifId, status, namaKetua, noHp }
      });

      return reply.status(201).send({ success: true, message: "PK berhasil ditambahkan", data: pkData });
    }
  );

  // POST SYNC PK
  fastify.post(
    "/wilayah/pk/sync",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Akses ditolak" });
      if (!user.periodeAktifId) return reply.status(400).send({ success: false, message: "Periode aktif tidak ditemukan" });

      const { fromPeriodeId } = request.body as { fromPeriodeId: string };
      if (!fromPeriodeId) return reply.status(400).send({ success: false, message: "Pilih periode sumber" });

      const sourceData = await fastify.prisma.pKDataPeriode.findMany({
        where: { periodeId: fromPeriodeId, pk: { userId: user.id } }
      });

      if (sourceData.length === 0) {
        return reply.status(400).send({ success: false, message: "Tidak ada data PK di periode tersebut" });
      }

      const currentData = await fastify.prisma.pKDataPeriode.findMany({
        where: { periodeId: user.periodeAktifId, pk: { userId: user.id } }
      });
      const currentPkIds = new Set(currentData.map(d => d.pkId));

      const toInsert = sourceData.filter(s => !currentPkIds.has(s.pkId));

      if (toInsert.length === 0) {
        return reply.status(200).send({ success: true, message: "Semua data PK sudah ada, tidak ada data baru disalin." });
      }

      await fastify.prisma.pKDataPeriode.createMany({
        data: toInsert.map(s => ({
          pkId: s.pkId,
          periodeId: user.periodeAktifId!,
          status: s.status,
          namaKetua: s.namaKetua,
          noHp: s.noHp,
        }))
      });

      const { ipAddress, userAgent, device, location } = getDeviceInfo(request);
      fastify.prisma.logActivity.create({
        data: {
          userId: user.id,
          periodeId: user.periodeAktifId,
          action: "UPDATE",
          module: "RANTING", // PK is part of wilayah, reusing RANTING module equivalent
          description: `Mensinkronisasi ${toInsert.length} data PK dari periode lalu`,
          ipAddress, userAgent, device, location,
        },
      }).catch(console.error);

      return reply.send({ success: true, message: `Berhasil mensinkronisasi ${toInsert.length} data PK` });
    }
  );

  // PATCH PK
  fastify.patch<{ Params: { id: string }; Body: any }>(
    "/wilayah/pk/:id",
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Akses ditolak" });
      
      const { id } = request.params;
      const { nama, status, namaKetua, noHp } = request.body as any;

      const pk = await fastify.prisma.pK.findFirst({ where: { id, userId: user.id } });
      if (!pk) return reply.status(404).send({ success: false, message: "PK tidak ditemukan" });

      if (nama) await fastify.prisma.pK.update({ where: { id }, data: { nama } });

      if (status !== undefined || namaKetua !== undefined || noHp !== undefined) {
         const dataPeriode = await fastify.prisma.pKDataPeriode.findFirst({
           where: { pkId: id, periodeId: user.periodeAktifId || "" }
         });
         
         if (dataPeriode) {
           await fastify.prisma.pKDataPeriode.update({
             where: { id: dataPeriode.id },
             data: { status, namaKetua, noHp }
           });
         }
      }

      return reply.send({ success: true, message: "PK berhasil diperbarui" });
    }
  );

  // DELETE
  fastify.delete<{ Params: { id: string } }>(
    "/wilayah/pk/:id",
    {
      preHandler: [requireAuth]
    },
    async (request, reply) => {
      const user = request.user!;
      if (user.role !== Role.SEKRETARIS_PAC) return reply.status(403).send({ success: false, message: "Akses ditolak" });
      
      const { id } = request.params;
      const pk = await fastify.prisma.pK.findFirst({ where: { id, userId: user.id } });
      if (!pk) return reply.status(404).send({ success: false, message: "PK tidak ditemukan" });

      await fastify.prisma.pK.delete({ where: { id } });

      return reply.send({ success: true, message: "PK berhasil dihapus" });
    }
  );

}
