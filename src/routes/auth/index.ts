import type { FastifyInstance } from "fastify";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.all("/api/auth/*", async (request, reply) => {
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

    const response = await fastify.auth.handler(webRequest);

    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });

    reply.status(response.status);

    const responseBody = await response.text();
    return reply.send(responseBody);
  });
}
