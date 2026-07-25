---
name: fastify-patterns
description: Konvensi dan pattern Fastify yang digunakan di project Laci Digital Backend. Trigger saat membuat routes, plugins, middleware, hooks, error handling, atau structure code Fastify apapun. KRITIS — Fastify punya pattern unik yang berbeda dari Express.
---

# Fastify Patterns & Conventions

## Core Concepts

Fastify berbeda dari Express. Pahami konsep ini:

1. **Plugin-based**: Semua fitur (routes, services, middleware) dibungkus dalam plugin
2. **Encapsulation**: Plugin terisolasi secara default — decorator dan hooks di dalamnya tidak "bocor" ke luar
3. **Decorators**: Cara menambahkan property/method ke fastify instance atau request/reply
4. **Hooks**: Lifecycle events (onRequest, preHandler, etc.) untuk intercepting request
5. **Schema-based validation**: Validasi input via JSON Schema (atau Zod → JSON Schema)

## Plugin Pattern

### Basic Plugin

```typescript
// Semua plugin HARUS di-export sebagai fungsi async
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

// Gunakan fp() agar plugin TIDAK encapsulated (decorator bisa diakses globally)
export default fp(async (fastify: FastifyInstance) => {
  // Setup logic di sini
  const service = createSomeService();

  // Expose via decorator
  fastify.decorate("myService", service);
}, {
  name: "my-service-plugin",        // Nama unik
  dependencies: ["prisma-plugin"],   // Plugin yang harus di-load duluan
});

// Type augmentation — WAJIB untuk TypeScript
declare module "fastify" {
  interface FastifyInstance {
    myService: ReturnType<typeof createSomeService>;
  }
}
```

### Kapan Pakai `fp()` dan Kapan Tidak

| Situasi | Gunakan `fp()`? | Alasan |
|---------|:---:|--------|
| Service/utility (encryption, email, prisma) | ✅ | Harus bisa diakses dari semua routes |
| Route group (anggota routes, arsip routes) | ❌ | Routes harus encapsulated |
| Middleware global (auth) | ✅ | Harus bisa diakses dari semua routes |
| Config plugin | ✅ | Config harus global |

## Route Pattern

### Route File Structure

Setiap modul memiliki folder di `src/routes/` dengan file-file berikut:

```
src/routes/anggota/
├── index.ts          # Route registration (autoPrefix)
├── handler.ts        # Request handlers (business logic)
└── schema.ts         # Zod schemas + JSON Schema untuk validation
```

### Route Registration

```typescript
// src/routes/anggota/index.ts
import type { FastifyInstance } from "fastify";
import { requireAuth } from "@/middleware/auth.middleware";
import { requireRole } from "@/middleware/role.middleware";
import * as handler from "./handler";
import * as schema from "./schema";

export default async function anggotaRoutes(fastify: FastifyInstance) {
  // Semua routes di sini memerlukan auth
  fastify.addHook("onRequest", requireAuth);

  // GET /api/anggota — List anggota
  fastify.get("/", {
    schema: schema.getAnggotaListSchema,
  }, handler.getAnggotaList);

  // GET /api/anggota/:id — Detail anggota
  fastify.get("/:id", {
    schema: schema.getAnggotaByIdSchema,
  }, handler.getAnggotaById);

  // POST /api/anggota — Create anggota
  fastify.post("/", {
    schema: schema.createAnggotaSchema,
  }, handler.createAnggota);

  // PUT /api/anggota/:id — Update anggota
  fastify.put("/:id", {
    schema: schema.updateAnggotaSchema,
  }, handler.updateAnggota);

  // DELETE /api/anggota/:id — Delete anggota
  fastify.delete("/:id", handler.deleteAnggota);

  // GET /api/anggota/stats — Statistik
  fastify.get("/stats", handler.getAnggotaStats);

  // POST /api/anggota/copy — Copy ke periode aktif
  fastify.post("/copy", {
    preHandler: [requireRole("SEKRETARIS_CABANG")],
  }, handler.copyAnggotaToPeriode);
}
```

### Handler Pattern

```typescript
// src/routes/anggota/handler.ts
import type { FastifyRequest, FastifyReply } from "fastify";

// Definisikan types untuk request
interface GetAnggotaListQuery {
  page?: number;
  limit?: number;
  search?: string;
  organisasi?: string;
  periodeId?: string;
}

export async function getAnggotaList(
  request: FastifyRequest<{ Querystring: GetAnggotaListQuery }>,
  reply: FastifyReply
) {
  const { page = 1, limit = 10, search, organisasi, periodeId } = request.query;
  const user = request.user!; // User pasti ada karena ada requireAuth

  try {
    // Build where clause
    const where = {
      userId: user.id,
      periodeId: periodeId || user.periodeAktifId,
      ...(organisasi && { organisasi }),
    };

    // Query
    const [data, total] = await Promise.all([
      request.server.prisma.anggota.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      request.server.prisma.anggota.count({ where }),
    ]);

    // Decrypt sensitive fields
    const decryptedData = data.map((item) => ({
      ...item,
      nama: request.server.encryption.decryptText(item.nama),
      nik: request.server.encryption.decryptText(item.nik),
      alamat: request.server.encryption.decryptText(item.alamat),
      noHP: request.server.encryption.decryptText(item.noHP),
      tempatLahir: request.server.encryption.decryptText(item.tempatLahir),
      namaAyah: item.namaAyah ? request.server.encryption.decryptText(item.namaAyah) : null,
      namaIbu: item.namaIbu ? request.server.encryption.decryptText(item.namaIbu) : null,
    }));

    return reply.send({
      success: true,
      data: decryptedData,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    request.log.error(error, "Failed to get anggota list");
    return reply.status(500).send({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Gagal mengambil data anggota" },
    });
  }
}
```

## Hooks (Lifecycle)

Urutan eksekusi hooks Fastify:

```
1. onRequest       ← Auth check (requireAuth)
2. preParsing      ← Jarang dipakai
3. preValidation   ← Sebelum schema validation
4. preHandler      ← Role check (requireRole), business logic guards
5. handler         ← Handler utama
6. preSerialization ← Sebelum response di-serialize
7. onSend          ← Modifikasi response
8. onResponse      ← After response sent (logging, analytics)
9. onError         ← Error handling
```

### Penggunaan Hooks di Project Ini

| Hook | Kegunaan | Contoh |
|------|----------|--------|
| `onRequest` | Authentication check | `requireAuth` middleware |
| `preHandler` | Role check, rate limiting | `requireRole("SEKRETARIS_CABANG")` |
| `onResponse` | Activity logging | Log setiap request ke `LogActivity` |
| `onError` | Centralized error handling | Format error response |

## Error Handling

### Custom Error Classes

```typescript
// src/utils/errors.ts

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, "NOT_FOUND", `${resource} tidak ditemukan`);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Anda tidak memiliki akses") {
    super(403, "FORBIDDEN", message);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(422, "VALIDATION_ERROR", "Data tidak valid", details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "CONFLICT", message);
  }
}
```

### Centralized Error Handler

```typescript
// Di src/index.ts atau plugin
fastify.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  // Custom AppError
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    });
  }

  // Fastify validation error
  if (error.validation) {
    return reply.status(422).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Data tidak valid",
        details: error.validation,
      },
    });
  }

  // Prisma errors
  if (error.code === "P2002") {
    return reply.status(409).send({
      success: false,
      error: { code: "DUPLICATE", message: "Data sudah ada" },
    });
  }

  if (error.code === "P2025") {
    return reply.status(404).send({
      success: false,
      error: { code: "NOT_FOUND", message: "Data tidak ditemukan" },
    });
  }

  // Generic error — JANGAN expose detail ke client
  return reply.status(500).send({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan internal" },
  });
});
```

## Entry Point Pattern

```typescript
// src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import { env } from "@/config/env";
import { getCorsConfig } from "@/config/cors";

// Plugins
import prismaPlugin from "@/plugins/prisma";
import authPlugin from "@/plugins/auth";
import realtimePlugin from "@/plugins/realtime";
import swaggerPlugin from "@/plugins/swagger";

// Services
import encryptionService from "@/services/encryption.service";
import storageService from "@/services/storage.service";
import emailService from "@/services/email.service";
import logService from "@/services/log.service";
import jwtService from "@/services/jwt.service";

// Routes
import authRoutes from "@/routes/auth";
import anggotaRoutes from "@/routes/anggota";
// ... import routes lainnya

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport: env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
    },
  });

  // 1. Register core plugins
  await fastify.register(cors, getCorsConfig());
  await fastify.register(cookie);
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  // 2. Register service plugins
  await fastify.register(prismaPlugin);
  await fastify.register(encryptionService);
  await fastify.register(storageService);
  await fastify.register(emailService);
  await fastify.register(logService);
  await fastify.register(jwtService);

  // 3. Register auth (depends on prisma + email)
  await fastify.register(authPlugin);

  // 4. Register documentation
  await fastify.register(swaggerPlugin);

  // 5. Register realtime
  await fastify.register(realtimePlugin);

  // 6. Register routes with prefix
  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(anggotaRoutes, { prefix: "/api/anggota" });
  // ... register routes lainnya

  return fastify;
}

// Start server
async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server running on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
```

## File Upload (Multipart)

```typescript
// Pattern untuk handle file upload di route handler
export async function createWithFile(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parts = request.parts();

  let fileBuffer: Buffer | null = null;
  let fileName: string | null = null;
  const fields: Record<string, string> = {};

  for await (const part of parts) {
    if (part.type === "file") {
      fileBuffer = await part.toBuffer();
      fileName = part.filename;
    } else {
      fields[part.fieldname] = part.value as string;
    }
  }

  // Validate fields
  const parsed = createSchema.safeParse(fields);
  if (!parsed.success) {
    return reply.status(422).send({
      success: false,
      error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() },
    });
  }

  // Encrypt and upload file if exists
  if (fileBuffer) {
    const encryptedFile = request.server.encryption.encryptFile(fileBuffer);
    const key = await request.server.storage.upload(encryptedFile, fileName!);
    // Save key to database
  }
}
```

## Testing Pattern

```typescript
// Gunakan Fastify inject untuk testing
import { buildApp } from "@/index";

describe("Anggota Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get anggota list", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/anggota",
      headers: {
        cookie: "ipnu-laci.session_token=valid-session-token",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toBeInstanceOf(Array);
  });
});
```
