---
name: project-context
description: Konteks project Laci Digital Backend — arsitektur, database schema, constraints, dan informasi deployment. Trigger saat bekerja dengan project structure, database, migrasi, atau fitur apapun yang berkaitan dengan Laci Digital.
---

# Project Context — Laci Digital Backend

## Overview

**Laci Digital** adalah sistem manajemen arsip & administrasi organisasi **IPNU IPPNU Magetan**. Backend ini (Fastify + BetterAuth) adalah hasil pemisahan dari monolith Next.js yang sudah **PRODUCTION**.

### Arsitektur

```
Frontend (Next.js)                   Backend (Fastify) ← INI PROJECT KITA
laci.pelajarnumagetan.or.id          api.laci.pelajarnumagetan.or.id
├── React Pages/Components           ├── BetterAuth Plugin
├── BetterAuth Client                ├── REST API Routes (30+ endpoints)
├── Custom Hooks (useApi)            ├── Prisma ORM → PostgreSQL
├── SSE Client                       ├── Services (Encryption, R2, Email, etc.)
└── Middleware (auth check)          ├── Auth Middleware (Cookie + Bearer)
                                     ├── Realtime SSE Hub
                                     └── Cron Jobs
```

FE dan BE berbagi **database PostgreSQL yang SAMA** dan **Cloudflare R2 yang SAMA**.

## Constraint Kritis

1. **Database SAMA** — BE menggunakan database production yang sudah ada, schema TIDAK BOLEH diubah
2. **Encryption IDENTIK** — Key, algorithm, salt harus PERSIS sama. Salah = data loss
3. **BetterAuth Config IDENTIK** — Secret, cookie prefix, session config harus PERSIS sama. Salah = user logout
4. **Zero Downtime Migration** — Monolith lama tetap berjalan selama transisi

## Database Schema (PostgreSQL via Prisma)

### Models & Relasi

| Model | Deskripsi | Relasi Utama |
|-------|-----------|-------------|
| `User` | Akun pengguna (Sekretaris Cabang/PAC) | → Session, Account, semua modul |
| `Session` | Sesi login BetterAuth | → User |
| `Account` | Akun provider (credential/google) | → User |
| `Verification` | Token verifikasi email | - |
| `Periode` | Periode kepengurusan organisasi | → User, semua modul |
| `ArsipSurat` | Arsip surat masuk/keluar | → User, Periode |
| `BerkasSP` | Berkas Surat Penetapan | → User, Periode |
| `BerkasPimpinan` | Berkas dari pimpinan | → User, Periode |
| `PengajuanBerkas` | Pengajuan berkas PAC→Cabang | → User (2 relasi: pengaju + reviewer), Periode (2 relasi) |
| `Anggota` | Data anggota organisasi | → User, Periode, Perkaderan, Pendidikan |
| `Pendidikan` | Riwayat pendidikan anggota | → Anggota |
| `Perkaderan` | Riwayat perkaderan anggota | → Anggota |
| `AgendaKegiatan` | Agenda/kalender kegiatan | → User, Periode |
| `Presensi` | Event presensi kegiatan | → User, Periode |
| `PresensiData` | Data absensi peserta | → Presensi |
| `LogActivity` | Audit log aktivitas user | → User, Periode |
| `LogEmail` | Log pengiriman email | - |
| `AllowedOrigin` | Domain CORS yang diizinkan | - |

### Enums

> **Schema EXACT dari production** — lihat juga [schema.prisma](file:///Users/muhammadzainurroziqin/Documents/coding/be-laci-fastify/.agents/skills/project-context/references/schema.prisma) di references/

```prisma
enum Role {
  SEKRETARIS_CABANG    // Admin level — full access
  SEKRETARIS_PAC       // Sub-admin — limited access
}

enum JenisSurat {
  MASUK
  KELUAR
}

enum Organisasi {
  IPNU
  IPPNU
  BERSAMA
  CBP_KPP
}

enum StatusPengajuan {
  PENDING
  DITERIMA
  DITOLAK
}

enum PenerimaSurat {
  IPNU
  IPPNU
  BERSAMA
  CBP_KPP
}

enum JenisKelamin {
  LAKI_LAKI
  PEREMPUAN
}

enum LogAction {
  CREATE
  UPDATE
  DELETE
  IMPORT
  EXPORT
  APPROVE
  REJECT
  LOGIN
  LOGOUT
}

enum LogModule {
  ARSIP_SURAT
  ANGGOTA
  BERKAS_PIMPINAN
  BERKAS_SP
  AGENDA_KEGIATAN
  PENGAJUAN_BERKAS
  PERIODE
  USER
  AUTH
  PRESENSI
}

enum EmailType {
  VERIFICATION
  VERIFIED_SUCCESS
  PENGAJUAN_USER
  PENGAJUAN_ADMIN
  PENGAJUAN_STATUS
}

enum EmailStatus {
  PENDING
  SENT
  FAILED
}
```

### Model Anggota — Fields Detail

Model `Anggota` punya banyak field yang di-encrypt. Berikut field EXACT-nya:

| Field | Type | Encrypted? | Nullable? |
|-------|------|:---:|:---:|
| `namaLengkap` | String | ✅ | ❌ |
| `nik` | String? | ✅ | ✅ |
| `nia` | String? | ✅ | ✅ |
| `email` | String? | ✅ | ✅ |
| `tempatLahir` | String? | ✅ | ✅ |
| `alamatLengkap` | String? | ✅ | ✅ |
| `noHp` | String? | ✅ | ✅ |
| `foto` | String? | ❌ (R2 key) | ✅ |
| `tanggalLahir` | DateTime? | ❌ | ✅ |
| `jenisKelamin` | JenisKelamin | ❌ | ❌ |
| `hobi` | String? | ❌ | ✅ |
| `jabatan` | String? | ❌ | ✅ |
| `noRfid` | String? | ❌ | ✅ |
| `pekerjaan` | String? | ❌ | ✅ |
| `jenjangPendidikan` | String? | ❌ | ✅ |
| `namaInstansiPendidikan` | String? | ❌ | ✅ |

### Model PresensiData — Fields Detail

Data absensi publik (tanpa login). Field `namaLengkap`, `email`, `noHp` **di-encrypt**, sedangkan `emailHash` dan `noHpHash` digunakan untuk unique constraint.

### Model PengajuanBerkas — Dual Periode Relation

PengajuanBerkas punya **2 relasi ke Periode**:
- `periodeCabang` (via `periodeId`) — Periode Cabang yang dituju
- `periodePac` (via `periodeIdPac`) — Periode PAC pengirim

## Folder Structure

```
src/
├── index.ts                    # Fastify entry point + server start
├── config/
│   ├── env.ts                  # Environment validation (Zod)
│   └── cors.ts                 # CORS configuration
├── plugins/
│   ├── auth.ts                 # BetterAuth plugin
│   ├── prisma.ts               # Prisma client plugin
│   ├── realtime.ts             # PG LISTEN/NOTIFY + SSE hub
│   └── swagger.ts              # OpenAPI/Swagger docs
├── middleware/
│   ├── auth.middleware.ts       # Session + Bearer token validation
│   ├── role.middleware.ts       # Role-based access control
│   └── rate-limit.middleware.ts # Rate limiting
├── services/
│   ├── encryption.service.ts    # AES-256-CBC (COPY EXACT)
│   ├── storage.service.ts       # Cloudflare R2 operations
│   ├── email.service.ts         # Nodemailer SMTP + templates
│   ├── log.service.ts           # Activity logger
│   ├── jwt.service.ts           # JWT create/verify
│   └── recaptcha.service.ts     # reCAPTCHA verification
├── routes/
│   ├── auth/                    # BetterAuth catch-all routes
│   ├── anggota/                 # CRUD + search + stats + export
│   ├── arsip/                   # CRUD + file upload/download
│   ├── berkas-sp/               # CRUD + file
│   ├── berkas-pimpinan/         # CRUD + file
│   ├── pengajuan-berkas/        # CRUD + approval + email notification
│   ├── agenda-kegiatan/         # CRUD
│   ├── presensi/                # CRUD + public absensi
│   ├── periode/                 # CRUD
│   ├── dashboard/               # Stats & monitoring
│   ├── user-management/         # Admin user CRUD
│   ├── logs/                    # Activity & email logs
│   ├── backup/                  # Backup operations
│   ├── realtime/                # SSE endpoint
│   ├── me/                      # Current user info
│   └── public/                  # Public endpoints (no auth)
├── schemas/                     # Zod validation schemas per module
│   ├── anggota.schema.ts
│   ├── arsip.schema.ts
│   ├── auth.schema.ts
│   └── ...
├── email-templates/             # HTML email template functions
├── utils/
│   ├── date.ts                  # Date formatting utilities
│   └── presensi.ts              # Presensi time check utilities
└── types/                       # Shared TypeScript types
    └── index.ts
```

## Environment Variables

> **PENTING**: Agen membaca langsung variabel environment dari file `fe-laci-v4/.env` tanpa perlu membuat file `.env` di folder backend.


### Reference Env Mapping

| Variable Key | Deskripsi & Catatan |
|--------------|----------------------|
| `DATABASE_URL` | URL PostgreSQL production/dev |
| `DIRECT_URL` | Direct connection URL PostgreSQL |
| `BETTER_AUTH_SECRET` | Secret BetterAuth (HARUS SAMA dengan FE) |
| `BETTER_AUTH_URL` | URL BetterAuth BE (`http://localhost:3001` dev) |
| `FRONTEND_URL` | URL Frontend Next.js (`http://localhost:3000` dev) |
| `ENCRYPTION_KEY` | AES-256 Key (HARUS SAMA dengan FE) |
| `API_KEY` | Header authorization secret |
| `CRON_SECRET` | Secret endpoint cron backup |
| `GOOGLE_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 Secret Key |
| `SMTP_*` | Konfigurasi Gmail Nodemailer |
| `R2_*` | Credentials Cloudflare R2 Bucket |


## Role-Based Access

| Role | Level | Akses |
|------|-------|-------|
| `SEKRETARIS_CABANG` | Admin | Full access semua modul + manajemen user |
| `SEKRETARIS_PAC` | Sub-admin | CRUD data milik sendiri + lihat referensi pengajuan |

### Access Control per Module

- **Dashboard**: Semua role, tapi data di-filter berdasarkan `periodeAktifId`
- **Manajemen User**: Hanya `SEKRETARIS_CABANG`
- **Log Email**: Hanya `SEKRETARIS_CABANG`
- **Backup**: Hanya `SEKRETARIS_CABANG`
- **CRUD Modules**: Semua role, filter berdasarkan `userId` dan `periodeId`
- **Pengajuan Berkas**: PAC bisa submit, Cabang bisa approve/reject

## Modul Utama (15 Modul)

1. **Auth & User Management** — Login, register, profile, reset password
2. **Anggota** — Data anggota organisasi (ENCRYPTED fields)
3. **Arsip Surat** — Surat masuk/keluar + file attachment
4. **Berkas SP** — Surat Penetapan + file
5. **Berkas Pimpinan** — Berkas dari pimpinan + file
6. **Pengajuan Berkas** — Flow pengajuan PAC→Cabang + approval + email notif
7. **Agenda Kegiatan** — Kalender kegiatan organisasi
8. **Presensi** — Event presensi + absensi publik (tanpa login)
9. **Periode** — Periode kepengurusan organisasi
10. **Dashboard** — Statistik, leaderboard, monitoring
11. **Log Activity** — Audit trail semua aksi user
12. **Log Email** — Tracking email terkirim/gagal
13. **Backup** — Backup data ke R2
14. **Realtime** — SSE streaming untuk live updates
15. **Public** — Stats publik, hari besar Islam
