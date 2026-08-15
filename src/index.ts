import Fastify from "fastify";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// Standard Fastify Plugins
import envPlugin from "./plugins/env";
import corsPlugin from "./plugins/cors";
import prismaPlugin from "./plugins/prisma";
import swaggerPlugin from "./plugins/swagger";

// Services (Plugins)
import encryptionPlugin from "./services/encryption.service";
import r2Plugin from "./services/r2.service";

// Routes Plugins
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import userManagementRoutes from "./routes/user-management";
import emailLogRoutes from "./routes/email-log";
import periodeRoutes from "./routes/periode";
import activityRoutes from "./routes/activity";
import dashboardRoutes from "./routes/dashboard";
import wilayahRoutes from "./routes/wilayah";
import ssoProvisioningRoutes from "./routes/sso-provisioning";
import arsipSuratRoutes from "./routes/arsip-surat";
import berkasSPRoutes from "./routes/berkas-sp";
import berkasPimpinanRoutes from "./routes/berkas-pimpinan";

async function buildServer() {
  const fastify = Fastify({
    logger:
      process.env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname",
              },
            },
          }
        : true,
  });

  // Set Zod compiler for validation and serialization
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // 1. Register Environment Plugin First (@fastify/env)
  await fastify.register(envPlugin);

  // 2. Register Fastify Core Plugins & Infrastructure
  await fastify.register(sensible);
  await fastify.register(cookie);
  await fastify.register(corsPlugin);
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    }
  });

  // 3. Register Database, Services & Auth Plugins
  await fastify.register(prismaPlugin);
  await fastify.register(encryptionPlugin);
  await fastify.register(r2Plugin);
  await fastify.register(swaggerPlugin);

  // 4. Register Route Plugins
  await fastify.register(authRoutes);
  await fastify.register(ssoProvisioningRoutes);
  await fastify.register(meRoutes, { prefix: "/api" });
  await fastify.register(userManagementRoutes, { prefix: "/api" });
  await fastify.register(emailLogRoutes, { prefix: "/api" });
  await fastify.register(periodeRoutes, { prefix: "/api" });
  await fastify.register(activityRoutes);
  await fastify.register(dashboardRoutes, { prefix: "/api" });
  await fastify.register(wilayahRoutes, { prefix: "/api" });
  await fastify.register(arsipSuratRoutes, { prefix: "/api/arsip-surat" });
  await fastify.register(berkasSPRoutes, { prefix: "/api/berkas-sp" });
  await fastify.register(berkasPimpinanRoutes, { prefix: "/api/berkas-pimpinan" });

  // 5. Health Check Endpoint
  fastify.get("/health", { schema: { tags: ["Sistem"] } }, async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "be-laci-v4",
    };
  });

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();
    await server.listen({
      port: server.config.PORT,
      host: server.config.HOST,
    });
    console.log(
      `🚀 Fastify Server running on http://${server.config.HOST}:${server.config.PORT}`
    );
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
