import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LACI_SESSION_COOKIE,
  LACI_SESSION_MAX_AGE_SECONDS,
} from "../lib/sso";

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function createLocalSession(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string
) {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + LACI_SESSION_MAX_AGE_SECONDS * 1000
  );

  await fastify.prisma.$transaction([
    fastify.prisma.session.deleteMany({
      where: { expiresAt: { lte: now } },
    }),
    fastify.prisma.session.create({
      data: {
        id: randomUUID(),
        userId,
        token: hashSessionToken(rawToken),
        expiresAt,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"]?.slice(0, 1024),
      },
    }),
  ]);

  reply.setCookie(LACI_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: fastify.config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LACI_SESSION_MAX_AGE_SECONDS,
  });
}

export async function getLocalSession(
  fastify: FastifyInstance,
  request: FastifyRequest
) {
  const rawToken = request.cookies[LACI_SESSION_COOKIE];
  if (!rawToken) return null;

  const session = await fastify.prisma.session.findUnique({
    where: { token: hashSessionToken(rawToken) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await fastify.prisma.session.delete({ where: { id: session.id } });
    }
    return null;
  }

  return session;
}

export async function revokeLocalSession(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const rawToken = request.cookies[LACI_SESSION_COOKIE];
  if (rawToken) {
    await fastify.prisma.session.deleteMany({
      where: { token: hashSessionToken(rawToken) },
    });
  }

  reply.clearCookie(LACI_SESSION_COOKIE, {
    httpOnly: true,
    secure: fastify.config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

