import type { FastifyInstance } from "fastify";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.all("/api/auth/*", { schema: { tags: ["Autentikasi & Sesi"] } }, async (request, reply) => {
    const url = new URL(request.url, `${request.protocol}://${request.hostname}`);

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

    const webRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? JSON.stringify(request.body)
          : undefined,
    });

    let loggingOutUserId: string | null = null;
    let loggingOutPeriodeId: string | null = null;
    if (url.pathname === "/api/auth/sign-out") {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const session = await fastify.prisma.session.findUnique({
          where: { token },
        });
        if (session) {
          loggingOutUserId = session.userId;
          const activePeriode = await fastify.prisma.periode.findFirst({
            where: { userId: session.userId, isActive: true },
          });
          if (activePeriode) {
            loggingOutPeriodeId = activePeriode.id;
          }
        }
      }
    }

    const response = await fastify.auth.handler(webRequest);

    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });

    reply.status(response.status);

    const responseBody = await response.text();

    // ============================================
    // ACTIVITY LOGGING FOR LOGIN & LOGOUT
    // ============================================
    if (response.status === 200) {
      try {
        const path = url.pathname;
        const customDevice = request.headers["x-client-device"] as string;
        const userAgent = request.headers["user-agent"] as string;
        const ipAddress = request.ip;
        const device = customDevice || (userAgent?.includes("Mobile") || userAgent?.includes("Dart") ? "Mobile" : "Web");
        const location = request.headers["x-user-location"] as string | undefined;

        if (path === "/api/auth/sign-in/email") {
          const json = JSON.parse(responseBody);
          if (json.user && json.user.id) {
            const userId = json.user.id;
            const activePeriode = await fastify.prisma.periode.findFirst({
              where: { userId, isActive: true },
            });
            
            if (activePeriode) {
              await fastify.prisma.logActivity.create({
                data: {
                  userId,
                  periodeId: activePeriode.id,
                  action: "LOGIN",
                  module: "AUTH",
                  description: "Pengurus berhasil masuk (login) ke dalam sistem",
                  ipAddress,
                  userAgent,
                  device,
                  location,
                },
              });
            }
          }
        } else if (path === "/api/auth/sign-out") {
          if (loggingOutUserId && loggingOutPeriodeId) {
            await fastify.prisma.logActivity.create({
              data: {
                userId: loggingOutUserId,
                periodeId: loggingOutPeriodeId,
                action: "LOGOUT",
                module: "AUTH",
                description: "Pengurus berhasil keluar (logout) dari sistem",
                ipAddress,
                userAgent,
                device,
                location,
              },
            });
          }
        }
      } catch (e) {
        console.error("Failed to log auth activity", e);
      }
    }

    return reply.send(responseBody);
  });
}
