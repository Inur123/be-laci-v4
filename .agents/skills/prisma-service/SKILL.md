---
name: prisma-service
description: Pattern penggunaan Prisma ORM di Fastify untuk Laci Digital. Trigger saat bekerja dengan database, query, Prisma, transaction, atau plugin database.
---

# Prisma Service — Fastify Plugin Pattern

## Prisma sebagai Fastify Plugin

```typescript
// src/plugins/prisma.ts
import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: fastify.config.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["error"],
  });

  // Connect on startup
  await prisma.$connect();
  fastify.log.info("Prisma connected to database");

  // Decorate fastify instance
  fastify.decorate("prisma", prisma);

  // Disconnect on shutdown
  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
    fastify.log.info("Prisma disconnected");
  });
}, {
  name: "prisma-plugin",
});

// Type augmentation
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
```

## Akses Prisma di Route Handler

```typescript
// Di route handler, akses via request.server.prisma
export async function getAnggotaList(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const data = await request.server.prisma.anggota.findMany({
    where: { userId: request.user!.id },
  });
  // ...
}
```

## Schema Prisma

> **PENTING**: Schema Prisma HARUS di-copy EXACT dari monolith Next.js. JANGAN UBAH schema kecuali ada instruksi eksplisit.

File `prisma/schema.prisma` harus identik dengan project monolith. Jalankan:
```bash
npx prisma generate   # Generate client dari schema
npx prisma db pull     # Atau pull schema dari database existing
```

**JANGAN** jalankan `npx prisma db push` atau `npx prisma migrate` ke database production tanpa instruksi eksplisit.

## Query Patterns

### Pagination

```typescript
async function paginatedQuery<T>(
  model: any,
  where: object,
  page: number,
  limit: number,
  orderBy: object = { createdAt: "desc" as const },
  include?: object
): Promise<{ data: T[]; total: number; totalPages: number }> {
  const [data, total] = await Promise.all([
    model.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy,
      ...(include && { include }),
    }),
    model.count({ where }),
  ]);

  return {
    data,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
```

### Where Clause Builder

```typescript
// Pattern untuk membangun where clause dari query params
function buildAnggotaWhere(
  userId: string,
  periodeId: string,
  filters: {
    organisasi?: string;
    jenisKelamin?: string;
    kecamatan?: string;
  }
) {
  return {
    userId,
    periodeId,
    ...(filters.organisasi && { organisasi: filters.organisasi }),
    ...(filters.jenisKelamin && { jenisKelamin: filters.jenisKelamin }),
    ...(filters.kecamatan && { kecamatan: filters.kecamatan }),
  };
}
```

### Include Relations

```typescript
// Pattern umum include relations
const anggotaWithRelations = {
  include: {
    pendidikan: true,
    perkaderan: true,
    user: {
      select: { id: true, name: true, email: true },
    },
    periode: {
      select: { id: true, nama: true },
    },
  },
};

// Pengajuan berkas — include user pengaju dan reviewer
const pengajuanWithRelations = {
  include: {
    user: { select: { id: true, name: true, email: true } },           // pengaju
    reviewedBy: { select: { id: true, name: true, email: true } },     // reviewer
    periode: { select: { id: true, nama: true } },
    periodePengaju: { select: { id: true, nama: true } },
  },
};
```

### Transactions

```typescript
// Gunakan $transaction untuk operasi yang harus atomic
export async function createAnggotaWithRelations(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const result = await request.server.prisma.$transaction(async (tx) => {
    // 1. Create anggota
    const anggota = await tx.anggota.create({
      data: { /* encrypted data */ },
    });

    // 2. Create pendidikan records
    if (input.pendidikan?.length) {
      await tx.pendidikan.createMany({
        data: input.pendidikan.map((p) => ({
          ...p,
          anggotaId: anggota.id,
        })),
      });
    }

    // 3. Create perkaderan records
    if (input.perkaderan?.length) {
      await tx.perkaderan.createMany({
        data: input.perkaderan.map((p) => ({
          ...p,
          anggotaId: anggota.id,
        })),
      });
    }

    return anggota;
  });

  return reply.status(201).send({ success: true, data: result });
}
```

### Soft vs Hard Delete

Di project ini, SEMUA delete adalah **HARD DELETE** (data benar-benar dihapus dari database). Tidak ada soft delete.

```typescript
// Hard delete
await request.server.prisma.anggota.delete({
  where: { id },
});

// Jika ada file di R2, hapus juga
if (record.fileKey) {
  await request.server.storage.delete(record.fileKey);
}
```

### Realtime Notification setelah Mutasi

Setelah setiap CREATE, UPDATE, atau DELETE, kirim notification via PG LISTEN/NOTIFY:

```typescript
// Pattern: Notify setelah mutasi
async function notifyRealtime(
  prisma: PrismaClient,
  module: string,
  action: string,
  userId: string
) {
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify('laci_realtime', $1)`,
    JSON.stringify({ module, action, userId, timestamp: new Date().toISOString() })
  );
}

// Usage setelah create/update/delete:
await notifyRealtime(request.server.prisma, "ANGGOTA", "CREATE", request.user!.id);
```

## Data Filtering berdasarkan Role

```typescript
// SEKRETARIS_CABANG: Bisa lihat semua data
// SEKRETARIS_PAC: Hanya data milik sendiri (berdasarkan userId)

function getBaseWhere(user: User): { userId?: string } {
  if (user.role === "SEKRETARIS_CABANG") {
    return {}; // Tidak ada filter userId — lihat semua
  }
  return { userId: user.id }; // Filter hanya data sendiri
}

// Usage:
const where = {
  ...getBaseWhere(request.user!),
  periodeId: request.user!.periodeAktifId,
  // ... filter lainnya
};
```

## Activity Logging setelah Mutasi

Setiap mutasi (CREATE, UPDATE, DELETE) HARUS di-log ke `LogActivity`:

```typescript
// Pattern: Log activity (non-blocking)
async function logActivity(
  prisma: PrismaClient,
  params: {
    userId: string;
    periodeId: string | null;
    action: "CREATE" | "UPDATE" | "DELETE";
    module: string;
    description: string;
    ipAddress?: string;
    userAgent?: string;
  }
) {
  // Fire and forget — jangan blokir response
  prisma.logActivity.create({
    data: {
      userId: params.userId,
      periodeId: params.periodeId,
      action: params.action,
      module: params.module,
      description: params.description,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
    },
  }).catch((err) => {
    // Log error tapi jangan throw — activity log bukan critical path
    console.error("Failed to log activity:", err);
  });
}

// Usage:
logActivity(request.server.prisma, {
  userId: request.user!.id,
  periodeId: request.user!.periodeAktifId,
  action: "CREATE",
  module: "ANGGOTA",
  description: `Menambahkan anggota baru: ${nama}`,
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"],
});
```
