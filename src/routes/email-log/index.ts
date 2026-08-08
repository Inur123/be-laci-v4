import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { Role } from "@prisma/client";
import { z } from "zod";

export default async function emailLogRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/email-logs",
    {
      preHandler: [requireAuth, requireRole(Role.SEKRETARIS_CABANG)],
      schema: {
        summary: "Get Email Logs",
        description: "Fetch paginated email logs with summary statistics.",
        tags: ["Email Logs"],
        querystring: z.object({
          page: z.string().optional().default("1"),
          limit: z.string().optional().default("10"),
          search: z.string().optional(),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page, limit, search } = request.query as {
        page: string;
        limit: string;
        search?: string;
      };

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      // Define where clause for search
      const whereClause = search
        ? {
            OR: [
              { to: { contains: search, mode: "insensitive" as const } },
              { subject: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

      // Calculate stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [totalEmails, sentEmails, todayEmails, logs] = await Promise.all([
        fastify.prisma.logEmail.count({ where: whereClause }),
        fastify.prisma.logEmail.count({
          where: { ...whereClause, status: "SENT" },
        }),
        fastify.prisma.logEmail.count({
          where: { ...whereClause, createdAt: { gte: today } },
        }),
        fastify.prisma.logEmail.findMany({
          where: whereClause,
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
      ]);

      const totalPages = Math.ceil(totalEmails / limitNum);

      return reply.send({
        success: true,
        data: {
          stats: {
            today: todayEmails,
            total: totalEmails,
            sent: sentEmails,
          },
          logs,
          pagination: {
            page: pageNum,
            limit: limitNum,
            totalItems: totalEmails,
            totalPages,
          },
        },
      });
    }
  );
}
