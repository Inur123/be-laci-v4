---
name: api-conventions
description: Konvensi REST API untuk Laci Digital Backend — response format, error handling, pagination, query parameters, HTTP status codes. Trigger saat membuat API endpoint, response, error handling, atau bekerja dengan request/response format.
---

# API Conventions — Laci Digital Backend

## Response Format

### Success Response

```typescript
// Single item
{
  "success": true,
  "data": { ... },
  "message": "Berhasil membuat anggota baru"  // optional
}

// List with pagination
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "totalPages": 15
  }
}

// No data (e.g., delete)
{
  "success": true,
  "message": "Data berhasil dihapus"
}
```

### Error Response

```typescript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",      // Machine-readable code (UPPER_SNAKE_CASE)
    "message": "Data tidak valid",    // Human-readable message (Indonesian)
    "details": { ... }               // Optional — validation details, etc.
  }
}
```

### Standard Error Codes

| Code | HTTP Status | Keterangan |
|------|:-----------:|------------|
| `UNAUTHORIZED` | 401 | Belum login / session expired |
| `FORBIDDEN` | 403 | Tidak punya akses (role) |
| `NOT_FOUND` | 404 | Resource tidak ditemukan |
| `VALIDATION_ERROR` | 422 | Input tidak valid |
| `CONFLICT` | 409 | Data duplikat |
| `DUPLICATE` | 409 | Unique constraint violation |
| `USER_INACTIVE` | 403 | Akun dinonaktifkan |
| `TOKEN_REVOKED` | 401 | JWT sudah di-revoke (post-logout) |
| `RATE_LIMIT` | 429 | Terlalu banyak request |
| `INTERNAL_ERROR` | 500 | Server error |
| `FILE_TOO_LARGE` | 413 | File melebihi batas ukuran |
| `INVALID_FILE_TYPE` | 422 | Tipe file tidak didukung |

## HTTP Status Codes

| Status | Penggunaan |
|:------:|------------|
| `200` | Success — GET, PUT, PATCH, DELETE |
| `201` | Created — POST yang membuat resource baru |
| `204` | No Content — DELETE tanpa response body (jarang dipakai, prefer 200 + message) |
| `400` | Bad Request — Request malformed |
| `401` | Unauthorized — Belum login |
| `403` | Forbidden — Tidak punya akses |
| `404` | Not Found — Resource tidak ada |
| `409` | Conflict — Duplikat data |
| `413` | Payload Too Large — File terlalu besar |
| `422` | Unprocessable Entity — Validation error |
| `429` | Too Many Requests — Rate limited |
| `500` | Internal Server Error — Server crash |

## Query Parameters

### Pagination

```
GET /api/anggota?page=1&limit=10
```

| Parameter | Type | Default | Keterangan |
|-----------|------|---------|------------|
| `page` | number | `1` | Halaman (1-indexed) |
| `limit` | number | `10` | Item per halaman (max 100) |

### Filtering

```
GET /api/anggota?organisasi=IPNU&jenisKelamin=LAKI_LAKI&periodeId=xxx
GET /api/arsip?jenisSurat=MASUK&tahun=2025
GET /api/pengajuan-berkas?status=PENDING
```

Filter menggunakan query parameter dengan nama field yang sama di database.

### Searching

```
GET /api/anggota?search=ahmad
GET /api/arsip?search=undangan
```

| Parameter | Keterangan |
|-----------|------------|
| `search` | Full-text search di field yang relevan |

Catatan: Untuk model dengan encrypted fields (Anggota), search dilakukan di client-side setelah decrypt, BUKAN di database. Alternatif: simpan hash untuk search.

### Sorting

```
GET /api/anggota?sortBy=createdAt&sortOrder=desc
```

| Parameter | Type | Default | Options |
|-----------|------|---------|---------|
| `sortBy` | string | `createdAt` | Field name yang bisa di-sort |
| `sortOrder` | string | `desc` | `asc`, `desc` |

### Date Range

```
GET /api/arsip?startDate=2025-01-01&endDate=2025-12-31
GET /api/log-activity?startDate=2025-07-01&endDate=2025-07-31
```

## URL Naming

- Gunakan **kebab-case** untuk URL path: `/api/berkas-sp`, `/api/pengajuan-berkas`
- Gunakan **camelCase** untuk query parameters: `?periodeId=xxx&sortBy=createdAt`
- Gunakan **camelCase** untuk request/response body fields
- Resource harus **plural**: `/api/anggota` (bukan `/api/anggotum`), tapi beberapa Indonesian nouns sudah natural plural
- ID parameter: `/:id` (bukan `/:anggotaId`)

## API Endpoint Mapping

### Auth & User Management

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|:----:|
| ALL | `/api/auth/**` | BetterAuth handler | - |
| PUT | `/api/me/profile` | Update profile sendiri | ✅ |
| GET | `/api/me` | Get current user info | ✅ |
| GET | `/api/users` | List users (admin) | ✅ Cabang |
| GET | `/api/users/:id` | Detail user | ✅ Cabang |
| POST | `/api/users/:id/reset-password` | Reset password user | ✅ Cabang |
| PATCH | `/api/users/:id/toggle-status` | Aktifkan/nonaktifkan user | ✅ Cabang |
| DELETE | `/api/users/:id` | Hapus user | ✅ Cabang |
| GET | `/api/users/stats` | Statistik user | ✅ Cabang |

### CRUD Modules (Pattern Seragam)

Setiap modul CRUD mengikuti pattern yang sama:

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/{module}` | List (dengan pagination, filter, search) |
| GET | `/api/{module}/:id` | Detail by ID |
| POST | `/api/{module}` | Create baru |
| PUT | `/api/{module}/:id` | Update |
| DELETE | `/api/{module}/:id` | Delete |
| GET | `/api/{module}/stats` | Statistik modul |

Modules: `anggota`, `arsip`, `berkas-sp`, `berkas-pimpinan`, `pengajuan-berkas`, `agenda-kegiatan`, `presensi`, `periode`

### File Operations

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/arsip/:id/download` | Download file arsip (decrypt) |
| GET | `/api/berkas-sp/:id/download` | Download file berkas SP (decrypt) |
| GET | `/api/berkas-pimpinan/:id/download` | Download file berkas pimpinan (decrypt) |
| GET | `/api/pengajuan-berkas/:id/download` | Download file pengajuan (decrypt) |
| GET | `/api/anggota/:id/image` | Get foto anggota (decrypt) |
| GET | `/api/users/:id/image` | Get foto profile user |

### Special Endpoints

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|:----:|
| PATCH | `/api/pengajuan-berkas/:id/status` | Approve/reject pengajuan | ✅ Cabang |
| POST | `/api/anggota/copy` | Copy anggota ke periode aktif | ✅ Cabang |
| POST | `/api/presensi/:id/absensi` | Submit absensi publik | ❌ Public |
| GET | `/api/dashboard/stats` | Dashboard statistik | ✅ |
| GET | `/api/realtime` | SSE stream | ✅ |
| GET | `/api/logs/activity` | Activity logs | ✅ |
| GET | `/api/logs/email` | Email logs | ✅ Cabang |
| POST | `/api/backup` | Trigger backup | ✅ Cabang |
| POST | `/api/cron/backup` | Cron backup (API key) | API Key |
| GET | `/api/public/stats` | Public statistics | ❌ Public |
| GET | `/api/public/phbi` | Hari besar Islam | ❌ Public |
| GET | `/api/public/data` | Public data | ❌ Public |

## Validation Pattern (Zod)

```typescript
// src/schemas/anggota.schema.ts
import { z } from "zod";

// Shared field schemas
const organisasiEnum = z.enum(["IPNU", "IPPNU"]);
const jenisKelaminEnum = z.enum(["LAKI_LAKI", "PEREMPUAN"]);

// Create schema
export const createAnggotaBody = z.object({
  nama: z.string().min(2, "Nama minimal 2 karakter").max(100),
  nik: z.string().length(16, "NIK harus 16 digit"),
  alamat: z.string().min(5, "Alamat minimal 5 karakter"),
  noHP: z.string().min(10, "Nomor HP minimal 10 digit"),
  tempatLahir: z.string().min(2),
  tanggalLahir: z.string().datetime(), // ISO 8601
  jenisKelamin: jenisKelaminEnum,
  organisasi: organisasiEnum,
  kecamatan: z.string().min(2),
  desa: z.string().min(2),
  namaAyah: z.string().optional(),
  namaIbu: z.string().optional(),
});

// Update schema — semua field optional
export const updateAnggotaBody = createAnggotaBody.partial();

// Query schema
export const getAnggotaQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  organisasi: organisasiEnum.optional(),
  jenisKelamin: jenisKelaminEnum.optional(),
  periodeId: z.string().uuid().optional(),
  sortBy: z.enum(["createdAt", "nama"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Params schema
export const idParams = z.object({
  id: z.string().uuid("ID tidak valid"),
});
```

## Content Types

| Request Type | Content-Type |
|-------------|-------------|
| JSON body | `application/json` |
| File upload | `multipart/form-data` |
| File download | Sesuai file type (`application/pdf`, `image/jpeg`, etc.) |

## Rate Limiting

| Endpoint Group | Limit | Window |
|----------------|-------|--------|
| Auth (login, register) | 10 req | 1 menit |
| API (authenticated) | 100 req | 1 menit |
| Public endpoints | 30 req | 1 menit |
| File upload | 20 req | 1 menit |
| Absensi publik | 5 req | 1 menit |
