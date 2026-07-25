import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const prismaPlugin = fp(
  async (fastify: FastifyInstance) => {
    const pool = new pg.Pool({
      connectionString: fastify.config.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({
      adapter,
      log: fastify.config.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });

    await prisma.$connect();
    fastify.decorate("prisma", prisma);

    fastify.addHook("onClose", async (server) => {
      await server.prisma.$disconnect();
      await pool.end();
    });
  },
  {
    name: "prisma-plugin",
  }
);

export default prismaPlugin;

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
