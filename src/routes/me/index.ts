import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";

export default async function meRoutes(fastify: FastifyInstance) {
  // ============================================
  // GET /me — Ambil data user yang sedang login
  // ============================================
  fastify.get(
    "/me",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      return reply.send({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          periodeAktifId: user.periodeAktifId,
          image: user.image,
          createdAt: user.createdAt,
        },
      });
    }
  );

  // ============================================
  // GET /me/stats — Ambil statistik Data Saya
  // ============================================
  fastify.get(
    "/me/stats",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const id = user.id;
      
      const userWithPeriode = await fastify.prisma.user.findUnique({
        where: { id },
        include: { periodes: { where: { isActive: true } } },
      });
      
      const activePeriode = userWithPeriode?.periodes && userWithPeriode.periodes.length > 0 ? userWithPeriode.periodes[0] : null;
      const periodeAktifId = activePeriode ? activePeriode.id : user.periodeAktifId;

      // Activity Stats
      const totalArsipSurat = periodeAktifId ? await fastify.prisma.arsipSurat.count({ where: { userId: id, periodeId: periodeAktifId } }) : 0;
      const totalPengajuan = periodeAktifId ? await fastify.prisma.pengajuanBerkas.count({ where: { userId: id, periodeIdPac: periodeAktifId } }) : 0;
      const totalAnggota = periodeAktifId ? await fastify.prisma.anggota.count({ where: { userId: id, periodeId: periodeAktifId } }) : 0;
      const totalBerkasPimpinan = periodeAktifId ? await fastify.prisma.berkasPimpinan.count({ where: { userId: id, periodeId: periodeAktifId } }) : 0;
      const totalLogActivities = await fastify.prisma.logActivity.count({ where: { userId: id } });
      const totalPeriode = await fastify.prisma.periode.count({ where: { userId: id } });

      return reply.send({
        success: true,
        data: {
          statsAktivitas: {
            arsipSurat: totalArsipSurat,
            pengajuanPac: totalPengajuan,
            dataAnggota: totalAnggota,
            berkasPimpinan: totalBerkasPimpinan,
            riwayatLog: totalLogActivities,
            periode: totalPeriode,
          },
        },
      });
    }
  );

  // ============================================
  // PUT /me/profile — Update nama pimpinan
  // ============================================
  fastify.put(
    "/me/profile",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.body as { name: string };
      const user = request.user!;

      if (!name || name.trim().length < 3) {
        return reply.status(400).send({
          success: false,
          message: "Nama harus diisi minimal 3 karakter.",
        });
      }

      await fastify.prisma.user.update({
        where: { id: user.id },
        data: { name: name.trim() },
      });

      // Log Activity
      let periodeId = user.periodeAktifId;
      if (!periodeId) {
        const activePeriode = await fastify.prisma.periode.findFirst({
          where: { userId: user.id, isActive: true },
        });
        if (activePeriode) {
          periodeId = activePeriode.id;
        }
      }

      if (periodeId) {
        await fastify.prisma.logActivity.create({
          data: {
            userId: user.id,
            periodeId: periodeId,
            action: "UPDATE",
            module: "USER",
            description: "Pengurus mengubah informasi dasar profil",
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            device: request.headers["x-client-device"] as string || (request.headers["user-agent"]?.includes("Mobile") || request.headers["user-agent"]?.includes("Dart") ? "Mobile" : "Web"),
            location: request.headers["x-user-location"] as string | undefined,
          }
        });
      }

      return reply.send({
        success: true,
        message: "Nama berhasil diperbarui.",
      });
    }
  );

  // ============================================
  // PUT /me/password — Update password
  // Uses BetterAuth's changePassword API
  // ============================================
  fastify.put(
    "/me/password",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };

      if (!currentPassword) {
        return reply.status(400).send({
          success: false,
          message: "Password saat ini wajib diisi.",
        });
      }

      if (!newPassword || newPassword.length < 6) {
        return reply.status(400).send({
          success: false,
          message: "Password baru minimal 6 karakter.",
        });
      }

      const user = request.user!;

      try {
        // Forward request headers to BetterAuth for session validation
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value) {
            if (Array.isArray(value)) {
              value.forEach((v) => headers.append(key, v));
            } else {
              headers.set(key, value);
            }
          }
        }

        await fastify.auth.api.changePassword({
          body: {
            currentPassword,
            newPassword,
            revokeOtherSessions: false,
          },
          headers,
        });

        // Log Activity
        let periodeId = user.periodeAktifId;
        if (!periodeId) {
          const activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId: user.id, isActive: true },
          });
          if (activePeriode) {
            periodeId = activePeriode.id;
          }
        }

        if (periodeId) {
          await fastify.prisma.logActivity.create({
            data: {
              userId: user.id,
              periodeId: periodeId,
              action: "UPDATE",
              module: "AUTH",
              description: "Pengurus mengubah password akun",
              ipAddress: request.ip,
              userAgent: request.headers["user-agent"],
              device: request.headers["x-client-device"] as string || (request.headers["user-agent"]?.includes("Mobile") || request.headers["user-agent"]?.includes("Dart") ? "Mobile" : "Web"),
              location: request.headers["x-user-location"] as string | undefined,
            }
          });
        }

        return reply.send({
          success: true,
          message: "Password berhasil diperbarui.",
        });
      } catch (error: any) {
        const msg =
          error?.message || error?.body?.message || "Gagal mengubah password.";

        // BetterAuth typically throws when current password is wrong
        if (
          msg.toLowerCase().includes("invalid") ||
          msg.toLowerCase().includes("incorrect") ||
          msg.toLowerCase().includes("password")
        ) {
          return reply.status(400).send({
            success: false,
            message: "Password saat ini salah.",
          });
        }

        return reply.status(400).send({
          success: false,
          message: msg,
        });
      }
    }
  );

  // ============================================
  // PUT /me/email — Request ganti email
  // Uses BetterAuth's changeEmail API (sends verification link)
  // ============================================
  fastify.put(
    "/me/email",
    {
      schema: { tags: ["Profil Akun Saya"] },
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { newEmail } = request.body as { newEmail: string };
      const user = request.user!;

      if (!newEmail || !newEmail.includes("@")) {
        return reply.status(400).send({
          success: false,
          message: "Email baru tidak valid.",
        });
      }

      if (newEmail.toLowerCase() === user.email.toLowerCase()) {
        return reply.status(400).send({
          success: false,
          message: "Email baru tidak boleh sama dengan email saat ini.",
        });
      }

      // Check if email already taken
      const existingUser = await fastify.prisma.user.findUnique({
        where: { email: newEmail.toLowerCase() },
      });

      if (existingUser) {
        return reply.status(400).send({
          success: false,
          message: "Email ini sudah digunakan oleh akun lain.",
        });
      }

      try {
        // Forward request headers to BetterAuth for session validation
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value) {
            if (Array.isArray(value)) {
              value.forEach((v) => headers.append(key, v));
            } else {
              headers.set(key, value);
            }
          }
        }

        await fastify.auth.api.changeEmail({
          body: {
            newEmail: newEmail.toLowerCase(),
            callbackURL: "lacimobile://profile",
          },
          headers,
        });

        // Log Activity
        let periodeId = user.periodeAktifId;
        if (!periodeId) {
          const activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId: user.id, isActive: true },
          });
          if (activePeriode) {
            periodeId = activePeriode.id;
          }
        }

        if (periodeId) {
          await fastify.prisma.logActivity.create({
            data: {
              userId: user.id,
              periodeId: periodeId,
              action: "UPDATE",
              module: "USER",
              description: "Pengurus meminta pergantian alamat email",
              ipAddress: request.ip,
              userAgent: request.headers["user-agent"],
              device: request.headers["x-client-device"] as string || (request.headers["user-agent"]?.includes("Mobile") || request.headers["user-agent"]?.includes("Dart") ? "Mobile" : "Web"),
              location: request.headers["x-user-location"] as string | undefined,
            }
          });
        }

        return reply.send({
          success: true,
          message:
            "Link verifikasi telah dikirim ke email baru Anda. Silakan cek inbox atau folder spam.",
        });
      } catch (error: any) {
        console.error("Change email error:", error);
        return reply.status(400).send({
          success: false,
          message: error?.message || "Gagal mengirim verifikasi email.",
        });
      }
    }
  );
}

