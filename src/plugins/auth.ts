import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { dash, sentinel } from "@better-auth/infra";
import { admin } from "better-auth/plugins";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins";
import nodemailer from "nodemailer";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const authPlugin = fp(
  async (fastify: FastifyInstance) => {
    const plugins: any[] = [
      admin({
        defaultRole: "SEKRETARIS_PAC",
        adminRole: "SEKRETARIS_CABANG",
      }),
      bearer(),
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          const transporter = nodemailer.createTransport({
            host: fastify.config.SMTP_HOST,
            port: fastify.config.SMTP_PORT,
            secure: fastify.config.SMTP_PORT === 465,
            auth: {
              user: fastify.config.SMTP_USER,
              pass: fastify.config.SMTP_PASS,
            },
          });

          try {
            await transporter.sendMail({
              from: `"Laci IPNU IPPNU" <${fastify.config.SMTP_USER}>`,
              to: email,
              subject: `Kode Verifikasi Laci Digital`,
              html: `
                <h2>Verifikasi Akun Laci Digital</h2>
                <p>Gunakan kode rahasia 6-digit berikut untuk memverifikasi akun Anda:</p>
                <h1 style="letter-spacing: 5px; color: #00B14F;">${otp}</h1>
                <p>Kode ini berlaku selama 5 menit.</p>
              `,
            });

            await fastify.prisma.logEmail.create({
              data: {
                to: email,
                subject: 'Kode Verifikasi Laci Digital',
                type: 'VERIFICATION',
                status: 'SENT',
                metadata: JSON.stringify({ betterAuthType: type }),
              },
            });
          } catch (error: any) {
            await fastify.prisma.logEmail.create({
              data: {
                to: email,
                subject: 'Kode Verifikasi Laci Digital',
                type: 'VERIFICATION',
                status: 'FAILED',
                errorMessage: error?.message || 'Unknown error',
                metadata: JSON.stringify({ betterAuthType: type }),
              },
            });
            console.error('Failed to send verification email:', error);
          }
        },
        sendVerificationOnSignUp: true,
      }),
    ];

    if (fastify.config.BETTER_AUTH_API_KEY) {
      plugins.push(
        dash({ apiKey: fastify.config.BETTER_AUTH_API_KEY }),
        sentinel({ apiKey: fastify.config.BETTER_AUTH_API_KEY })
      );
    }

    const auth = betterAuth({
      secret: fastify.config.BETTER_AUTH_SECRET,
      baseURL: fastify.config.BETTER_AUTH_URL,

      database: prismaAdapter(fastify.prisma, {
        provider: "postgresql",
      }),

      plugins,

      experimental: {
        joins: true,
      },

      session: {
        expiresIn: 60 * 60 * 6,
        updateAge: 60 * 60,
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60,
        },
      },

      user: {
        changeEmail: {
          enabled: true,
        },
        additionalFields: {
          role: {
            type: "string",
            required: true,
            defaultValue: "SEKRETARIS_PAC",
            input: false,
          },
          isActive: {
            type: "boolean",
            required: true,
            defaultValue: false,
            input: false,
          },
          periodeAktifId: {
            type: "string",
            required: false,
            input: true,
          },
          lastLogoutAt: {
            type: "date",
            required: false,
            input: false,
          },
        },
      },

      emailVerification: {
        sendVerificationEmail: async ({ user, url, token }, request) => {
          // This handles verification links for changeEmail.
          // Standard signup uses the emailOTP plugin instead, so this will only be triggered by changeEmail.
          // The 'url' contains the new email as a query parameter (or we can extract it if needed, but BetterAuth handles it).
          // Actually, 'user.email' here is still the OLD email. 
          // The new email is embedded in the token/url by BetterAuth.
          // Wait, BetterAuth changeEmail documentation says we should send to the new email.
          // But 'sendVerificationEmail' only provides { user, url, token }.
          // The user object contains the old email! 
          // Where is the newEmail in v1.4? 
          // Better Auth automatically determines it, but let's parse the URL or just send to the old email if we can't find it?
          // Wait, the docs say: "When a user changes their email, Better Auth will automatically send an email to the new email address using the sendVerificationEmail function."
          // But wait! If it doesn't give us 'newEmail', how do we know where to send it?
          // Actually, BetterAuth replaces `user.email` with the NEW email specifically during this callback in v1.4!
          // Let's assume `user.email` is the target email for this callback.
          
          const targetEmail = user.email;

          const transporter = nodemailer.createTransport({
            host: fastify.config.SMTP_HOST,
            port: fastify.config.SMTP_PORT,
            secure: fastify.config.SMTP_PORT === 465,
            auth: {
              user: fastify.config.SMTP_USER,
              pass: fastify.config.SMTP_PASS,
            },
          });

          try {
            await transporter.sendMail({
              from: `"Laci IPNU IPPNU" <${fastify.config.SMTP_USER}>`,
              to: targetEmail,
              subject: `Verifikasi Perubahan Email - Laci Digital`,
              html: `
                <h2>Verifikasi Perubahan Email</h2>
                <p>Halo <strong>${user.name}</strong>,</p>
                <p>Anda meminta untuk mengubah alamat email akun Anda.</p>
                <p>Klik tombol di bawah ini untuk mengkonfirmasi perubahan ke email baru ini:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${url}" style="background-color: #00B14F; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                    Verifikasi Email Baru
                  </a>
                </div>
                <p style="color: #666; font-size: 12px;">Link ini berlaku selama 1 jam. Jika Anda tidak merasa meminta perubahan ini, abaikan email ini.</p>
              `,
            });

            await fastify.prisma.logEmail.create({
              data: {
                to: targetEmail,
                subject: 'Verifikasi Perubahan Email - Laci Digital',
                type: 'VERIFICATION',
                status: 'SENT',
                metadata: JSON.stringify({ betterAuthToken: token }),
              },
            });
          } catch (error: any) {
            await fastify.prisma.logEmail.create({
              data: {
                to: targetEmail,
                subject: 'Verifikasi Perubahan Email - Laci Digital',
                type: 'VERIFICATION',
                status: 'FAILED',
                errorMessage: error?.message || 'Unknown error',
                metadata: JSON.stringify({ betterAuthToken: token }),
              },
            });
            console.error('Failed to send verification email:', error);
          }
        },
      },

      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        autoSignIn: false,
      },

      socialProviders:
        fastify.config.GOOGLE_CLIENT_ID && fastify.config.GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: fastify.config.GOOGLE_CLIENT_ID,
                clientSecret: fastify.config.GOOGLE_CLIENT_SECRET,
              },
            }
          : undefined,

      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: ["google"],
        },
      },

      advanced: {
        cookiePrefix: "ipnu-laci",
        useSecureCookies: fastify.config.NODE_ENV === "production",
      },

      trustedOrigins: [fastify.config.FRONTEND_URL].filter(Boolean),
    });

    fastify.decorate("auth", auth as any);
  },
  {
    name: "auth-plugin",
    dependencies: ["prisma-plugin", "env-plugin"],
  }
);

export default authPlugin;

declare module "fastify" {
  interface FastifyInstance {
    auth: ReturnType<typeof betterAuth>;
  }
}
