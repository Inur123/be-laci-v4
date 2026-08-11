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
    if (url.pathname === "/api/auth/sign-out") {
      try {
        const sessionData = await fastify.auth.api.getSession({ headers: webRequest.headers });
        if (sessionData && sessionData.session) {
          loggingOutUserId = sessionData.session.userId;
        }
      } catch (e) {
        console.error("Error getting session for logout:", e);
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
            
            // Fire and forget
            fastify.prisma.periode.findFirst({
              where: { userId, isActive: true },
            }).then((activePeriode) => {
              if (activePeriode) {
                return fastify.prisma.logActivity.create({
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
            }).catch(e => console.error("Failed to log auth activity", e));
          }
        } else if (path === "/api/auth/sign-out") {
          if (loggingOutUserId) {
            // Fire and forget
            fastify.prisma.periode.findFirst({
              where: { userId: loggingOutUserId, isActive: true },
            }).then((activePeriode) => {
              if (activePeriode) {
                return fastify.prisma.logActivity.create({
                  data: {
                    userId: loggingOutUserId,
                    periodeId: activePeriode.id,
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
            }).catch(e => console.error("Failed to log auth activity", e));
          }
        }
      } catch (e) {
        console.error("Failed to parse auth activity", e);
      }
    }

    return reply.send(responseBody);
  });
}
