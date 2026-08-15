import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { randomUUID } from "crypto";

interface GetBerkasPimpinanQuery {
  periodeId?: string;
}

interface CreateBerkasPimpinanBody {
  nama: string;
  tanggal: string;
  catatan?: string;
  file?: string;
}

const berkasPimpinanRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const userId = user.id;
        const query = request.query as GetBerkasPimpinanQuery;
        
        // Prioritaskan cookie viewingPeriodeId, jika tidak ada gunakan query, jika tidak ada fallback ke periode aktif
        const reqPeriodeId = request.cookies?.viewingPeriodeId || query.periodeId;
        let targetPeriodeId = reqPeriodeId;

        if (!targetPeriodeId) {
          const activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId, isActive: true },
          });
          if (activePeriode) {
            targetPeriodeId = activePeriode.id;
          } else {
            const latestPeriode = await fastify.prisma.periode.findFirst({
              where: { userId },
              orderBy: { createdAt: "desc" },
            });
            if (latestPeriode) {
              targetPeriodeId = latestPeriode.id;
            }
          }
        }

        const whereClause: any = { userId };
        
        let periodeName = "-";
        if (targetPeriodeId) {
          whereClause.periodeId = targetPeriodeId;
          const p = await fastify.prisma.periode.findUnique({ where: { id: targetPeriodeId }});
          if (p) periodeName = p.nama;
        }

        const data = await fastify.prisma.berkasPimpinan.findMany({
          where: whereClause,
          orderBy: { tanggal: "desc" },
          include: { periode: true },
        });

        return reply.send({ success: true, data, periodeName });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, message: "Terjadi kesalahan sistem", error: error.message });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/:id",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const data = await fastify.prisma.berkasPimpinan.findUnique({
          where: { id: request.params.id },
          include: { periode: true },
        });

        if (!data) return reply.status(404).send({ success: false, message: "Data tidak ditemukan" });
        if (data.userId !== user.id) return reply.status(403).send({ success: false, message: "Akses ditolak" });

        return reply.send({ success: true, data });
      } catch (error: any) {
        return reply.status(500).send({ success: false, message: "Terjadi kesalahan sistem", error: error.message });
      }
    }
  );

  fastify.post(
    "/",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const userId = user.id;

        const activePeriode = await fastify.prisma.periode.findFirst({
          where: { userId, isActive: true },
        });

        if (!activePeriode) {
          return reply.status(400).send({ success: false, message: "Anda tidak memiliki periode aktif. Silakan buat atau aktifkan periode terlebih dahulu." });
        }

        const body: any = {};
        let fileBuffer: Buffer | null = null;
        let originalFileName = "";

        if (request.isMultipart()) {
          const parts = request.parts();
          for await (const part of parts) {
            if (part.type === 'file') {
              fileBuffer = await part.toBuffer();
              originalFileName = part.filename;
            } else {
              body[part.fieldname] = part.value;
            }
          }
        } else {
          Object.assign(body, request.body);
        }

        let fileKey: string | null = null;
        if (fileBuffer && fileBuffer.length > 0) {
          const ext = originalFileName.split('.').pop();
          fileKey = `berkas-pimpinan/${activePeriode.id}/${randomUUID()}.${ext}.enc`;
          const encrypted = fastify.encryption.encryptFile(fileBuffer);
          await fastify.r2.uploadEncryptedFile(encrypted, fileKey);
        }

        const newData = await fastify.prisma.berkasPimpinan.create({
          data: {
            userId,
            periodeId: activePeriode.id,
            nama: body.nama,
            tanggal: new Date(body.tanggal),
            catatan: body.catatan || null,
            file: fileKey || body.file || null,
          }
        });

        return reply.status(201).send({ success: true, message: "Berhasil menambahkan berkas pimpinan", data: newData });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, message: "Gagal menyimpan berkas pimpinan", error: error.message });
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/:id",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const existing = await fastify.prisma.berkasPimpinan.findUnique({ where: { id: request.params.id } });

        if (!existing) return reply.status(404).send({ success: false, message: "Data tidak ditemukan" });
        if (existing.userId !== user.id) return reply.status(403).send({ success: false, message: "Akses ditolak" });

        const body: any = {};
        let fileBuffer: Buffer | null = null;
        let originalFileName = "";

        if (request.isMultipart()) {
          const parts = request.parts();
          for await (const part of parts) {
            if (part.type === 'file') {
              fileBuffer = await part.toBuffer();
              originalFileName = part.filename;
            } else {
              body[part.fieldname] = part.value;
            }
          }
        } else {
          Object.assign(body, request.body || {});
        }

        let fileKey: string | null = null;
        if (fileBuffer && fileBuffer.length > 0) {
          const ext = originalFileName.split('.').pop();
          fileKey = `berkas-pimpinan/${existing.periodeId}/${randomUUID()}.${ext}.enc`;
          const encrypted = fastify.encryption.encryptFile(fileBuffer);
          await fastify.r2.uploadEncryptedFile(encrypted, fileKey);
        }

        const updateData: any = {};
        if (body.nama !== undefined) updateData.nama = body.nama;
        if (body.tanggal !== undefined) updateData.tanggal = new Date(body.tanggal);
        if (body.catatan !== undefined) updateData.catatan = body.catatan || null;
        
        if (fileKey) {
          updateData.file = fileKey;
        } else if (body.file === "") {
          updateData.file = null;
        }

        const updated = await fastify.prisma.berkasPimpinan.update({
          where: { id: request.params.id },
          data: updateData,
        });

        return reply.send({ success: true, message: "Data berhasil diperbarui", data: updated });
      } catch (error: any) {
        return reply.status(500).send({ success: false, message: "Gagal memperbarui berkas pimpinan", error: error.message });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const existing = await fastify.prisma.berkasPimpinan.findUnique({ where: { id: request.params.id } });

        if (!existing) return reply.status(404).send({ success: false, message: "Data tidak ditemukan" });
        if (existing.userId !== user.id) return reply.status(403).send({ success: false, message: "Akses ditolak" });

        await fastify.prisma.berkasPimpinan.delete({ where: { id: request.params.id } });

        return reply.send({ success: true, message: "Data berhasil dihapus" });
      } catch (error: any) {
        return reply.status(500).send({ success: false, message: "Gagal menghapus berkas pimpinan", error: error.message });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/:id/file",
    {
      schema: { tags: ["Berkas Pimpinan"] },
      preHandler: [requireAuth],
    },
    async (request, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const data = await fastify.prisma.berkasPimpinan.findUnique({ where: { id: request.params.id } });

        if (!data) return reply.status(404).send({ success: false, message: "Data tidak ditemukan" });
        if (data.userId !== user.id) return reply.status(403).send({ success: false, message: "Akses ditolak" });
        if (!data.file) return reply.status(404).send({ success: false, message: "File tidak tersedia" });

        // Retrieve and decrypt from R2
        try {
          const encryptedBuffer = await fastify.r2.getEncryptedFile(data.file);
          const decryptedBuffer = fastify.encryption.decryptFile(encryptedBuffer);

          let originalExt = "pdf";
          const match = data.file.match(/\.([^.]+)\.enc$/);
          if (match && match[1]) originalExt = match[1].toLowerCase();

          // Set correct content type for common previewable files
          let contentType = "application/octet-stream";
          if (originalExt === "pdf") contentType = "application/pdf";
          else if (originalExt === "jpg" || originalExt === "jpeg") contentType = "image/jpeg";
          else if (originalExt === "png") contentType = "image/png";
          else if (originalExt === "webp") contentType = "image/webp";

          reply.header("Content-Disposition", `inline; filename="berkas_pimpinan_${data.nama.replace(/[\/\\]/g, '_')}.${originalExt}"`);
          reply.header("Content-Type", contentType);
          
          return reply.send(decryptedBuffer);
        } catch (r2Error: any) {
          fastify.log.error(r2Error);
          return reply.status(500).send({ success: false, message: "Gagal mengambil file dari penyimpanan" });
        }
      } catch (error: any) {
        return reply.status(500).send({ success: false, message: "Terjadi kesalahan sistem", error: error.message });
      }
    }
  );
};

export default berkasPimpinanRoutes;
