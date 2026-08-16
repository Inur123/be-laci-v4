import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKey } from "../../middleware/apikey.middleware";

export default async function publicRoutes(fastify: FastifyInstance) {
  // GET ALL PACs
  fastify.get(
    "/api/public/pacs",
    {
      preHandler: [requireApiKey],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const pacs = await fastify.prisma.user.findMany({
        where: { role: "SEKRETARIS_PAC", isActive: true },
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: "asc" },
      });

      return reply.send({
        success: true,
        data: pacs,
      });
    }
  );

  // GET WILAYAH (RANTING & PK) BY PAC ID
  fastify.get(
    "/api/public/wilayah",
    {
      preHandler: [requireApiKey],
    },
    async (request, reply) => {
      const { pacId } = request.query as { pacId?: string };

      if (!pacId) {
        return reply.status(400).send({
          success: false,
          message: "pacId query parameter is required",
        });
      }

      // Check if PAC exists and is valid
      const pacUser = await fastify.prisma.user.findUnique({
        where: { id: pacId, role: "SEKRETARIS_PAC" },
      });

      if (!pacUser) {
        return reply.status(404).send({
          success: false,
          message: "PAC not found",
        });
      }

      // Fetch active Ranting and PK for this PAC based on their active periode
      const activePeriodeId = pacUser.periodeAktifId;

      if (!activePeriodeId) {
        return reply.send({
          success: true,
          data: {
            ranting: [],
            pk: [],
          },
          message: "PAC does not have an active periode",
        });
      }

      const ranting = await fastify.prisma.rantingDataPeriode.findMany({
        where: {
          periodeId: activePeriodeId,
          status: "AKTIF",
        },
        include: {
          ranting: { select: { id: true, nama: true } },
        },
      });

      const pk = await fastify.prisma.pKDataPeriode.findMany({
        where: {
          periodeId: activePeriodeId,
          status: "AKTIF",
        },
        include: {
          pk: { select: { id: true, nama: true } },
        },
      });

      return reply.send({
        success: true,
        data: {
          ranting: ranting.map(r => ({ id: r.rantingId, nama: r.ranting.nama, status: r.status })),
          pk: pk.map(p => ({ id: p.pkId, nama: p.pk.nama, status: p.status })),
        },
      });
    }
  );

  // POST ANGGOTA
  fastify.post(
    "/api/public/anggota",
    {
      preHandler: [requireApiKey],
    },
    async (request, reply) => {
      const { userId, namaLengkap, tingkat, jabatan, wilayahId } = request.body as {
        userId: string;
        periodeId?: string;
        namaLengkap: string;
        tingkat: "CABANG" | "PAC" | "RANTING" | "PK";
        jabatan?: string;
        wilayahId?: string;
      };
      let { periodeId } = request.body as { periodeId?: string };

      if (!userId || !namaLengkap || !tingkat) {
        return reply.status(400).send({
          success: false,
          message: "userId, namaLengkap, and tingkat are required fields",
        });
      }

      const targetUser = await fastify.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!targetUser) {
        return reply.status(404).send({
          success: false,
          message: "Target user (Pengelola Laci) not found",
        });
      }

      if (!periodeId) {
        if (!targetUser.periodeAktifId) {
          return reply.status(400).send({
            success: false,
            message: "Target user has no active periode. Provide periodeId explicitly.",
          });
        }
        periodeId = targetUser.periodeAktifId;
      }

      const anggota = await fastify.prisma.anggota.create({
        data: {
          userId,
          periodeId,
          namaLengkap,
          tingkat,
          jabatan,
          wilayahId,
        },
      });

      return reply.status(201).send({
        success: true,
        message: "Data Anggota berhasil disimpan di Laci dengan status PENDING",
        data: anggota,
      });
    }
  );
}
