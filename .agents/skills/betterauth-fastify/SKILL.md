---
name: betterauth-fastify
description: Konfigurasi dan integrasi BetterAuth dengan Fastify untuk Laci Digital. Trigger saat bekerja dengan authentication, session, login, register, OAuth, cookie, JWT, auth middleware, atau konfigurasi BetterAuth. KRITIS — config harus IDENTIK dengan monolith.
---

# BetterAuth + Fastify Integration

> **⚠️ KRITIS**: Konfigurasi BetterAuth HARUS **IDENTIK** dengan monolith Next.js yang sudah production. Jika berbeda, semua session user existing menjadi invalid (user logout massal), OAuth flow break, dan token-token yang sudah ada tidak bisa diverifikasi.

## Konfigurasi yang HARUS IDENTIK

| Setting | Nilai EXACT | Dampak jika Berbeda |
|---------|-------------|---------------------|
| `secret` | `process.env.BETTER_AUTH_SECRET` (env SAMA) | Cookie/token tidak bisa di-decode |
| `advanced.cookiePrefix` | `"ipnu-laci"` | Cookie name mismatch → session lost |
| `advanced.useSecureCookies` | `true` | Cookie tidak terkirim di production |
| `session.expiresIn` | `60 * 60 * 6` (6 jam / 21600 detik) | Session behavior berubah |
| `session.updateAge` | `60 * 60` (1 jam / 3600 detik) | Refresh interval berubah |
| `session.cookieCache.maxAge` | `5 * 60` (5 menit / 300 detik) | Cache behavior berubah |
| `user.additionalFields` | `role`, `isActive`, `periodeAktifId`, `lastLogoutAt` | User fields missing |
| `emailAndPassword.requireEmailVerification` | `false` | Login behavior berubah |
| `account.accountLinking.enabled` | `true` | OAuth linking gagal |
| `account.accountLinking.trustedProviders` | `["google"]` | Google auto-link gagal |
| `plugins` | `emailOTP({ length: 6, expiresIn: 300 })` | OTP format mismatch |
| `socialProviders.google` | Client ID & Secret SAMA | OAuth flow break |

## Implementasi BetterAuth Plugin untuk Fastify

```typescript
// src/plugins/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  const auth = betterAuth({
    secret: fastify.config.BETTER_AUTH_SECRET,
    baseURL: fastify.config.BETTER_AUTH_URL,

    database: prismaAdapter(fastify.prisma, {
      provider: "postgresql",
    }),

    // Session — HARUS IDENTIK
    session: {
      expiresIn: 60 * 60 * 6,      // 6 jam
      updateAge: 60 * 60,           // refresh setiap 1 jam
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,             // cache 5 menit
      },
    },

    // User custom fields — HARUS IDENTIK
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: true,
          defaultValue: "SEKRETARIS_PAC",
          input: true,
        },
        isActive: {
          type: "boolean",
          required: true,
          defaultValue: true,
          input: false,
        },
        periodeAktifId: {
          type: "string",
          required: false,
          input: true,
        },
        lastLogoutAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },

    // Email + Password — HARUS IDENTIK
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
    },

    // Google OAuth — HARUS IDENTIK
    socialProviders: {
      google: {
        clientId: fastify.config.GOOGLE_CLIENT_ID,
        clientSecret: fastify.config.GOOGLE_CLIENT_SECRET,
      },
    },

    // Account linking — HARUS IDENTIK
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },

    // Plugins — HARUS IDENTIK
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300, // 5 menit
        sendVerificationOTP: async ({ email, otp }) => {
          // Kirim via email service
          await fastify.emailService.sendOTP(email, otp);
        },
      }),
    ],

    // Advanced — KRITIS untuk cross-subdomain
    advanced: {
      cookiePrefix: "ipnu-laci",
      useSecureCookies: true,
      crossSubDomainCookies: {
        enabled: true,
        domain: ".pelajarnumagetan.or.id",
      },
    },

    // Trusted origins — KRITIS untuk CORS
    trustedOrigins: [
      "https://laci.pelajarnumagetan.or.id",
      "http://localhost:3000",  // development
    ],
  });

  // Decorate fastify with auth instance
  fastify.decorate("auth", auth);
}, {
  name: "auth-plugin",
  dependencies: ["prisma-plugin"], // auth depends on prisma
});

// Type augmentation
declare module "fastify" {
  interface FastifyInstance {
    auth: ReturnType<typeof betterAuth>;
  }
}
```

## Mount BetterAuth Routes di Fastify

```typescript
// src/routes/auth/index.ts
import type { FastifyInstance } from "fastify";

export default async function authRoutes(fastify: FastifyInstance) {
  // BetterAuth catch-all handler
  // BetterAuth menyediakan handler yang bisa di-mount sebagai route
  fastify.all("/api/auth/*", async (request, reply) => {
    // Convert Fastify request/reply ke Web API Request/Response
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
      body: request.method !== "GET" && request.method !== "HEAD"
        ? JSON.stringify(request.body)
        : undefined,
    });

    const response = await fastify.auth.handler(webRequest);

    // Copy response headers
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });

    reply.status(response.status);

    const responseBody = await response.text();
    return reply.send(responseBody);
  });
}
```

## Auth Middleware

### Cookie-based Auth (untuk Web Client)

```typescript
// src/middleware/auth.middleware.ts
import type { FastifyRequest, FastifyReply } from "fastify";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Method 1: Cookie session (web)
    const sessionCookie = request.cookies["ipnu-laci.session_token"];

    if (sessionCookie) {
      const session = await request.server.auth.api.getSession({
        headers: new Headers({
          cookie: request.headers.cookie || "",
        }),
      });

      if (session?.user) {
        // Check if user is active
        if (!session.user.isActive) {
          return reply.status(403).send({
            success: false,
            error: { code: "USER_INACTIVE", message: "Akun Anda dinonaktifkan" },
          });
        }

        request.user = session.user;
        request.session = session.session;
        return;
      }
    }

    // Method 2: Bearer token (mobile/API)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await request.server.jwtService.verify(token);

      if (payload) {
        // Verify lastLogoutAt
        const user = await request.server.prisma.user.findUnique({
          where: { id: payload.sub },
        });

        if (user && user.isActive) {
          if (user.lastLogoutAt && payload.iat) {
            const logoutTime = Math.floor(new Date(user.lastLogoutAt).getTime() / 1000);
            if (payload.iat < logoutTime) {
              return reply.status(401).send({
                success: false,
                error: { code: "TOKEN_REVOKED", message: "Token sudah tidak berlaku" },
              });
            }
          }

          request.user = user;
          return;
        }
      }
    }

    // No valid auth found
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu" },
    });
  } catch (error) {
    request.log.error(error, "Auth middleware error");
    return reply.status(401).send({
      success: false,
      error: { code: "AUTH_ERROR", message: "Gagal memvalidasi sesi" },
    });
  }
}
```

### Role-based Access Control

```typescript
// src/middleware/role.middleware.ts
import type { FastifyRequest, FastifyReply } from "fastify";

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu" },
      });
    }

    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Anda tidak memiliki akses ke fitur ini" },
      });
    }
  };
}

// Usage di route:
// fastify.get("/", {
//   preHandler: [requireAuth, requireRole("SEKRETARIS_CABANG")],
// }, handler);
```

## Cross-Subdomain Cookie — Konfigurasi CORS

```typescript
// src/config/cors.ts
import type { FastifyCorsOptions } from "@fastify/cors";

export function getCorsConfig(): FastifyCorsOptions {
  const allowedOrigins = [
    "https://laci.pelajarnumagetan.or.id",
    // Development
    "http://localhost:3000",
  ];

  return {
    origin: allowedOrigins,
    credentials: true,   // WAJIB untuk cookie cross-origin
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
    exposedHeaders: ["Set-Cookie"],
    maxAge: 86400, // preflight cache 24 jam
  };
}
```

## JWT untuk Mobile Auth

```typescript
// JWT config yang HARUS IDENTIK
const JWT_CONFIG = {
  algorithm: "HS256" as const,
  expiresIn: "24h",    // 24 jam
  // Secret sama dengan BETTER_AUTH_SECRET
};

// Saat verify JWT, HARUS cek lastLogoutAt
// Jika user logout setelah JWT dibuat, JWT invalid
```

## Type Augmentation untuk Request

```typescript
// src/types/fastify.d.ts
import type { User, Session } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    session?: Session;
  }
}
```

## Checklist Validasi Auth

- [ ] Login dengan email+password existing berhasil
- [ ] Session cookie name = `ipnu-laci.session_token`
- [ ] Cookie dikirim dengan domain `.pelajarnumagetan.or.id`
- [ ] Cookie `httpOnly`, `secure`, `sameSite=none`
- [ ] Get session dari FE domain ke BE domain berhasil (cross-origin cookie)
- [ ] Google OAuth flow berhasil (redirect, callback, auto-link)
- [ ] Email OTP terkirim dan bisa diverifikasi
- [ ] User `additionalFields` (role, isActive, periodeAktifId) terbaca di session
- [ ] Bearer token (JWT) auth untuk mobile berhasil
- [ ] `lastLogoutAt` check — JWT yang dibuat sebelum logout di-reject
- [ ] Rate limiting aktif di auth endpoints
