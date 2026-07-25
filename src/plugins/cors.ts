import cors from "@fastify/cors";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const corsPlugin = fp(
  async (fastify: FastifyInstance) => {
    const allowedOrigins = [fastify.config.FRONTEND_URL].filter(Boolean);

    await fastify.register(cors, {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true);
          return;
        }
        cb(new Error("Not allowed by CORS"), false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Cookie",
        "X-Requested-With",
        "x-api-key",
      ],
      exposedHeaders: ["Set-Cookie"],
      maxAge: 86400,
    });
  },
  {
    name: "cors-plugin",
    dependencies: ["env-plugin"],
  }
);

export default corsPlugin;
