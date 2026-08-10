import type { FastifyRequest, FastifyReply } from "fastify";

export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip API key check for Swagger UI routes so documentation remains accessible and OPTIONS requests for CORS
  if (request.method === 'OPTIONS' || request.url.startsWith('/docs') || request.url.startsWith('/health')) {
    return;
  }

  const expectedKey = process.env.APP_API_KEY;
  const providedKey = request.headers['x-app-key'];

  // Jika di ENV tidak ada APP_API_KEY, abaikan (anggap tidak dipakai)
  if (!expectedKey) {
    return;
  }

  if (providedKey !== expectedKey) {
    request.log.warn({ url: request.url, ip: request.ip }, "Unauthorized API Key attempt");
    return reply.status(403).send({
      success: false,
      error: { code: "FORBIDDEN", message: "Akses ditolak. App Key tidak valid atau tidak ditemukan." },
    });
  }
}
