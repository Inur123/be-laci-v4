import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/auth.middleware";
import { z } from "zod";

export default async function activityRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/activities",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Riwayat Aktivitas"],
        summary: "Get Activity Logs",
        description: "Mendapatkan daftar riwayat aktivitas.",
        querystring: z.object({
          type: z.enum(["personal", "global"]).optional().default("personal"),
          limit: z.string().optional().default("50"),
          page: z.string().optional().default("1"),
          search: z.string().optional(),
          module: z.string().optional(),
          action: z.string().optional(),
          userId: z.string().optional(),
          date: z.string().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { 
        type = "personal", 
        limit = "50", 
        page = "1",
        search,
        module: moduleFilter,
        action: actionFilter,
        userId: userIdFilter,
        date: dateFilter,
        startDate,
        endDate,
      } = request.query as {
        type?: string;
        limit?: string;
        page?: string;
        search?: string;
        module?: string;
        action?: string;
        userId?: string;
        date?: string;
        startDate?: string;
        endDate?: string;
      };

      const take = parseInt(limit, 10) || 50;
      const skip = (parseInt(page, 10) - 1) * take;

      let periodeId = user.periodeAktifId;
      if (!periodeId) {
        const activePeriode = await fastify.prisma.periode.findFirst({
          where: { userId: user.id, isActive: true },
        });
        if (activePeriode) {
          periodeId = activePeriode.id;
        }
      }

      if (!periodeId) {
        return reply.send({
          success: true,
          data: [],
          meta: {
            total: 0,
            page: parseInt(page, 10),
            limit: take,
            stats: {},
          },
        });
      }

      let whereClause: any = {};

      if (type === "personal") {
        whereClause.periodeId = periodeId;
        whereClause.userId = user.id;
      }

      // Add dynamic filters
      if (search && search.trim() !== "") {
        whereClause.OR = [
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      if (moduleFilter && moduleFilter !== "Semua Modul") {
        let mappedModule = moduleFilter.toUpperCase();
        if (moduleFilter === "Autentikasi") mappedModule = "AUTH";
        if (moduleFilter === "Kegiatan") mappedModule = "AGENDA_KEGIATAN";
        if (moduleFilter === "Manajemen User") mappedModule = "USER";
        if (moduleFilter === "Arsip Surat") mappedModule = "ARSIP_SURAT";
        if (moduleFilter === "Periode") mappedModule = "PERIODE";
        
        whereClause.module = mappedModule;
      }

      // In Flutter UI, "Entitas" maps to LogAction Enum
      if (actionFilter && actionFilter !== "Semua Entitas") {
        // Map common UI values to Enum
        let mappedAction = actionFilter.toUpperCase();
        if (actionFilter === "Tambah") mappedAction = "CREATE";
        if (actionFilter === "Ubah" || actionFilter === "Update") mappedAction = "UPDATE";
        if (actionFilter === "Hapus") mappedAction = "DELETE";
        if (actionFilter === "Lihat") mappedAction = "READ"; // If READ exists, otherwise it will just fail nicely
        
        whereClause.action = mappedAction;
      }

      // Only filter by user if it's Global tab
      if (type === "global" && userIdFilter && userIdFilter !== "Semua PAC") {
        whereClause.userId = userIdFilter;
      }

      if (startDate && endDate) {
        whereClause.createdAt = {
          gte: new Date(startDate),
          lte: new Date(endDate),
        };
      } else if (dateFilter && dateFilter !== "Semua Waktu") {
        const now = new Date();
        let queryStartDate: Date | undefined;

        if (dateFilter === "Hari Ini") {
          queryStartDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (dateFilter === "Kemarin") {
          queryStartDate = new Date(now.setDate(now.getDate() - 1));
          queryStartDate.setHours(0, 0, 0, 0);
          whereClause.createdAt = {
            gte: queryStartDate,
            lt: new Date(new Date().setHours(0, 0, 0, 0)),
          };
        } else if (dateFilter === "7 Hari Terakhir") {
          queryStartDate = new Date(now.setDate(now.getDate() - 7));
        } else if (dateFilter === "30 Hari Terakhir") {
          queryStartDate = new Date(now.setDate(now.getDate() - 30));
        } else if (dateFilter === "Bulan Ini") {
          queryStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (dateFilter === "Bulan Lalu") {
          queryStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          whereClause.createdAt = {
            gte: queryStartDate,
            lt: new Date(now.getFullYear(), now.getMonth(), 1),
          };
        }

        if (queryStartDate && !whereClause.createdAt) {
          whereClause.createdAt = { gte: queryStartDate };
        }
      }

      // Filter to only include active and verified users
      whereClause.user = {
        isActive: true,
        emailVerified: true,
      };

      console.log("ACTIVITY ROUTE: User ID =", user.id);
      console.log("ACTIVITY ROUTE: whereClause =", JSON.stringify(whereClause, null, 2));

      const [activities, total, statsGroup] = await Promise.all([
        fastify.prisma.logActivity.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true,
                image: true,
              },
            },
            periode: {
              select: {
                nama: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take,
          skip,
        }),
        fastify.prisma.logActivity.count({
          where: whereClause,
        }),
        fastify.prisma.logActivity.groupBy({
          by: ["module"],
          where: whereClause,
          _count: true,
        }),
      ]);

      const stats = statsGroup.reduce((acc, curr) => {
        acc[curr.module] = curr._count;
        return acc;
      }, {} as Record<string, number>);

      const formattedActivities = activities.map((act) => {
        const d = new Date(act.createdAt);
        d.setUTCHours(d.getUTCHours() + 7); // Convert UTC to WIB (Asia/Jakarta)
        return {
          ...act,
          createdAt: d.toISOString().replace('Z', ''), // Remove 'Z' so frontend parses it as exact local time without offset
        };
      });

      return reply.send({
        success: true,
        data: formattedActivities,
        meta: {
          total,
          page: Number(page),
          limit: take,
          hasMore: skip + activities.length < total,
          stats,
        },
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/activities/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Riwayat Aktivitas"],
        summary: "Get Activity Detail",
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const activity = await fastify.prisma.logActivity.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
              image: true,
            },
          },
          periode: {
            select: {
              nama: true,
            },
          },
        },
      });

      if (!activity) {
        return reply.status(404).send({
          success: false,
          message: "Activity log not found",
        });
      }

      const d = new Date(activity.createdAt);
      d.setUTCHours(d.getUTCHours() + 7);

      return reply.send({
        success: true,
        data: {
          ...activity,
          createdAt: d.toISOString().replace('Z', ''),
        },
      });
    }
  );
}
