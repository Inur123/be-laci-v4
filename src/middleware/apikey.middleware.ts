import type { FastifyRequest, FastifyReply } from "fastify";

export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const apiKey = request.headers["x-api-key"] as string;

  if (!apiKey) {
    return reply.status(401).send({
      success: false,
      message: "Unauthorized: Missing x-api-key header",
    });
  }

  try {
    const validKey = await request.server.prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!validKey || !validKey.isActive) {
      return reply.status(401).send({
        success: false,
        message: "Unauthorized: Invalid or inactive API Key",
      });
    }

    // Attach api key details to request if needed later
    (request as any).apiKeyData = validKey;
  } catch (error) {
    request.log.error(error, "Error validating API key");
    return reply.status(500).send({
      success: false,
      message: "Internal server error during authentication",
    });
  }
}
