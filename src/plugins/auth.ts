import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { dash, sentinel } from "@better-auth/infra";
import { admin } from "better-auth/plugins";
import { bearer } from "better-auth/plugins/bearer";
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
        additionalFields: {
          role: {
            type: "string",
            required: true,
            defaultValue: "SEKRETARIS_PAC",
            input: true,
          },
          isActive: {
            type: "boolean",
            required: true,
            defaultValue: true,
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

      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        autoSignIn: true,
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
