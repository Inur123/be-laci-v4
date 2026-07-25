# Project Rules — Laci Digital Backend (Fastify + BetterAuth)

## Konteks Project

Ini adalah **backend API** untuk sistem **Laci Digital IPNU IPPNU Magetan** — sistem manajemen arsip & administrasi organisasi. Backend ini dipisahkan dari monolith Next.js yang sudah **PRODUCTION** dengan data aktif.

> **PERINGATAN KRITIS**: Database sudah berisi data production yang terenkripsi. JANGAN PERNAH mengubah schema Prisma tanpa instruksi eksplisit dari user. JANGAN PERNAH mengubah encryption logic. Kesalahan di sini = DATA LOSS PERMANEN.

## Bahasa

- **Code**: English (variabel, fungsi, comment, file names)
- **Commit messages**: Indonesian
- **Documentation**: Indonesian
- **API response messages**: Indonesian (untuk user-facing), English (untuk error codes)

## TypeScript

- Strict mode: `true`
- Target: `ES2022`
- Module: `NodeNext`
- No `any` type kecuali unavoidable — gunakan `unknown` lalu narrow
- Gunakan `interface` untuk object shapes, `type` untuk unions/intersections/utility
- Semua function harus punya typed return value
- Prefer `const` over `let`, tidak boleh `var`
- Gunakan optional chaining (`?.`) dan nullish coalescing (`??`)

## Naming Conventions

- **Files**: `kebab-case.ts` (contoh: `auth.middleware.ts`, `anggota.schema.ts`)
- **Routes folder**: `kebab-case/` (contoh: `berkas-sp/`, `pengajuan-berkas/`)
- **Variables/Functions**: `camelCase`
- **Classes/Interfaces/Types**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE` untuk env vars, `camelCase` untuk lainnya
- **Enum values**: `UPPER_SNAKE_CASE`

## Dependency Versions

- **Runtime**: Bun (package manager & runtime)
- **Node Compat**: Node.js 20+ (LTS)
- **Fastify**: 5.x (Ecosystem Resmi: `@fastify/env`, `@fastify/cors`, `@fastify/cookie`, `@fastify/sensible`)
- **BetterAuth**: Official 1.6+ (`better-auth`, `@better-auth/prisma-adapter`, `@better-auth/infra`)
- **Prisma**: 7.x (dengan `@prisma/adapter-pg` & `prisma.config.ts`)
- **Zod**: 4.x
- **TypeScript**: 5.x

## Package Manager

- Gunakan **`bun`** untuk semua operasi:
  - `bun install` (bukan `npm install`)
  - `bun add <pkg>` (bukan `npm install <pkg>`)
  - `bun run dev` (bukan `npm run dev`)
  - `bunx` (bukan `npx`)
- Lockfile: `bun.lock` (bukan `package-lock.json`)

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Branch naming: `feature/`, `fix/`, `chore/`
- Jangan commit file `.env`, `node_modules/`, `dist/`

## Security Rules

- JANGAN PERNAH log sensitive data (password, token, encryption key, secret)
- JANGAN PERNAH return raw Prisma/database errors ke client
- Semua input HARUS divalidasi dengan Zod schema sebelum diproses
- Semua endpoint (kecuali public) HARUS melewati auth middleware
- Rate limiting HARUS diterapkan di semua endpoint
- CORS hanya mengizinkan origin yang terdaftar

## Import Order

```typescript
// 1. Node built-in modules
import crypto from "node:crypto";

// 2. External packages
import Fastify from "fastify";
import { z } from "zod";

// 3. Internal modules (absolute from src/)
import { authMiddleware } from "@/middleware/auth.middleware";

// 4. Relative imports
import { anggotaSchema } from "./schema";
```

## Error Handling

- Gunakan custom error classes, bukan throw string
- Semua error harus di-catch dan diformat ke response standar
- Log error detail di server, kirim pesan generic ke client
- Gunakan Fastify `setErrorHandler` untuk centralized error handling
