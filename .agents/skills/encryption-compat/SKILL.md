---
name: encryption-compat
description: Spesifikasi enkripsi data Laci Digital yang HARUS IDENTIK dengan monolith. Trigger saat bekerja dengan encryption, decrypt, encrypt, data anggota, atau field-field sensitif. KRITIS — kesalahan di sini menyebabkan data loss permanen.
---

# Encryption Compatibility — COPY EXACT

> **⚠️ PERINGATAN KRITIS**: Enkripsi di project ini melindungi data personal anggota (nama, NIK, alamat, dll) yang sudah tersimpan di database production. Algoritma, key derivation, salt, dan format output HARUS **100% IDENTIK** dengan monolith. Perbedaan sekecil apapun = data anggota TIDAK BISA DIDECRYPT = **DATA LOSS PERMANEN**.

## Spesifikasi Enkripsi

### Text Encryption (untuk field database)

| Parameter | Nilai | JANGAN DIUBAH |
|-----------|-------|:---:|
| Algorithm | `aes-256-cbc` | ❌ |
| IV Length | 16 bytes (random per encryption) | ❌ |
| Key Derivation | `crypto.scryptSync(key, salt, 32)` | ❌ |
| Salt | `"laci-ipnu-ippnu-salt-2025"` | ❌ |
| Key Source | `process.env.ENCRYPTION_KEY` | ❌ |
| Output Format | `{iv_hex}:{encrypted_hex}` | ❌ |

### Implementasi Text Encryption

```typescript
import crypto from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const SALT = "laci-ipnu-ippnu-salt-2025";

function deriveKey(encryptionKey: string): Buffer {
  return crypto.scryptSync(encryptionKey, SALT, 32);
}

function encryptText(text: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function decryptText(encryptedText: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

### File Encryption (untuk file di R2 Storage)

| Parameter | Nilai | JANGAN DIUBAH |
|-----------|-------|:---:|
| Compression | GZIP (`zlib.gzipSync`) sebelum encrypt | ❌ |
| Algorithm | `aes-256-cbc` (sama) | ❌ |
| Key Derivation | Sama dengan text | ❌ |
| Output Format | `iv_bytes(16) + encrypted_compressed_bytes` | ❌ |

### Implementasi File Encryption

```typescript
import crypto from "node:crypto";
import zlib from "node:zlib";

function encryptFile(buffer: Buffer, encryptionKey: string): Buffer {
  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const compressed = zlib.gzipSync(buffer);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(compressed),
    cipher.final(),
  ]);
  // Output: IV (16 bytes) + Encrypted data
  return Buffer.concat([iv, encrypted]);
}

function decryptFile(encryptedBuffer: Buffer, encryptionKey: string): Buffer {
  const key = deriveKey(encryptionKey);
  const iv = encryptedBuffer.subarray(0, IV_LENGTH);
  const encrypted = encryptedBuffer.subarray(IV_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const compressed = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return zlib.gunzipSync(compressed);
}
```

## Fields yang Di-Encrypt per Model

### Model `Anggota`

| Field | Type | Encrypted? | Nullable? | Keterangan |
|-------|------|:---:|:---:|------------|
| `namaLengkap` | String | ✅ | ❌ | Nama lengkap anggota |
| `nik` | String? | ✅ | ✅ | Nomor Induk Kependudukan |
| `nia` | String? | ✅ | ✅ | Nomor Induk Anggota |
| `email` | String? | ✅ | ✅ | Email anggota |
| `tempatLahir` | String? | ✅ | ✅ | Tempat lahir |
| `alamatLengkap` | String? | ✅ | ✅ | Alamat lengkap |
| `noHp` | String? | ✅ | ✅ | Nomor HP/WhatsApp |
| `foto` | String? | ❌ | ✅ | R2 key (FILE di R2 ter-encrypt) |
| `tanggalLahir` | DateTime? | ❌ | ✅ | Tanggal lahir |
| `jenisKelamin` | JenisKelamin | ❌ | ❌ | Enum, plain |
| `hobi` | String? | ❌ | ✅ | Plain text |
| `jabatan` | String? | ❌ | ✅ | Plain text |
| `noRfid` | String? | ❌ | ✅ | Plain text |
| `pekerjaan` | String? | ❌ | ✅ | Plain text |
| `jenjangPendidikan` | String? | ❌ | ✅ | Plain text |
| `namaInstansiPendidikan` | String? | ❌ | ✅ | Plain text |

### Model `PresensiData`

| Field | Type | Encrypted? | Nullable? | Keterangan |
|-------|------|:---:|:---:|------------|
| `namaLengkap` | String | ✅ | ❌ | Nama peserta |
| `email` | String | ✅ | ❌ | Email peserta |
| `noHp` | String | ✅ | ❌ | No HP peserta |
| `emailHash` | String | ❌ | ❌ | SHA-256 hash untuk unique constraint |
| `noHpHash` | String | ❌ | ❌ | SHA-256 hash untuk unique constraint |
| `organisasi` | String | ❌ | ❌ | Plain text |
| `tingkat` | String? | ❌ | ✅ | Plain text |
| `jabatan` | String? | ❌ | ✅ | Plain text |
| `instansi` | String? | ❌ | ✅ | Plain text |

### File Storage (R2)

Semua file yang di-upload ke R2 **di-encrypt** sebelum di-upload:
- Foto anggota → encrypt file → upload ke R2
- File arsip surat → encrypt file → upload ke R2
- File berkas SP → encrypt file → upload ke R2
- File berkas pimpinan → encrypt file → upload ke R2
- File pengajuan berkas → encrypt file → upload ke R2

### Pattern Encrypt saat Create/Update

```typescript
// Saat CREATE anggota — field names EXACT dari schema.prisma
const encryptedData = {
  // Encrypted fields
  namaLengkap: encryptText(input.namaLengkap, env.ENCRYPTION_KEY),
  nik: input.nik ? encryptText(input.nik, env.ENCRYPTION_KEY) : null,
  nia: input.nia ? encryptText(input.nia, env.ENCRYPTION_KEY) : null,
  email: input.email ? encryptText(input.email, env.ENCRYPTION_KEY) : null,
  tempatLahir: input.tempatLahir ? encryptText(input.tempatLahir, env.ENCRYPTION_KEY) : null,
  alamatLengkap: input.alamatLengkap ? encryptText(input.alamatLengkap, env.ENCRYPTION_KEY) : null,
  noHp: input.noHp ? encryptText(input.noHp, env.ENCRYPTION_KEY) : null,
  // Non-encrypted fields — tetap plain
  tanggalLahir: input.tanggalLahir,
  jenisKelamin: input.jenisKelamin,
  hobi: input.hobi,
  jabatan: input.jabatan,
  noRfid: input.noRfid,
  pekerjaan: input.pekerjaan,
  jenjangPendidikan: input.jenjangPendidikan,
  namaInstansiPendidikan: input.namaInstansiPendidikan,
};

await prisma.anggota.create({ data: encryptedData });
```

### Pattern Decrypt saat Read

```typescript
// Saat GET anggota — handle nullable encrypted fields
const anggota = await prisma.anggota.findUnique({ where: { id } });

const decryptedAnggota = {
  ...anggota,
  namaLengkap: decryptText(anggota.namaLengkap, env.ENCRYPTION_KEY),
  nik: anggota.nik ? decryptText(anggota.nik, env.ENCRYPTION_KEY) : null,
  nia: anggota.nia ? decryptText(anggota.nia, env.ENCRYPTION_KEY) : null,
  email: anggota.email ? decryptText(anggota.email, env.ENCRYPTION_KEY) : null,
  tempatLahir: anggota.tempatLahir ? decryptText(anggota.tempatLahir, env.ENCRYPTION_KEY) : null,
  alamatLengkap: anggota.alamatLengkap ? decryptText(anggota.alamatLengkap, env.ENCRYPTION_KEY) : null,
  noHp: anggota.noHp ? decryptText(anggota.noHp, env.ENCRYPTION_KEY) : null,
};
```

## Service Implementation

Implementasi encryption service sebagai Fastify plugin:

```typescript
// src/services/encryption.service.ts
import crypto from "node:crypto";
import zlib from "node:zlib";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const SALT = "laci-ipnu-ippnu-salt-2025";

export interface EncryptionService {
  encryptText(text: string): string;
  decryptText(encryptedText: string): string;
  encryptFile(buffer: Buffer): Buffer;
  decryptFile(encryptedBuffer: Buffer): Buffer;
}

export default fp(async (fastify: FastifyInstance) => {
  const encryptionKey = fastify.config.ENCRYPTION_KEY;
  const key = crypto.scryptSync(encryptionKey, SALT, 32);

  const service: EncryptionService = {
    encryptText(text: string): string {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      return `${iv.toString("hex")}:${encrypted}`;
    },

    decryptText(encryptedText: string): string {
      const [ivHex, encrypted] = encryptedText.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    },

    encryptFile(buffer: Buffer): Buffer {
      const iv = crypto.randomBytes(IV_LENGTH);
      const compressed = zlib.gzipSync(buffer);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
      return Buffer.concat([iv, encrypted]);
    },

    decryptFile(encryptedBuffer: Buffer): Buffer {
      const iv = encryptedBuffer.subarray(0, IV_LENGTH);
      const encrypted = encryptedBuffer.subarray(IV_LENGTH);
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return zlib.gunzipSync(compressed);
    },
  };

  fastify.decorate("encryption", service);
}, { name: "encryption-service" });

// Type augmentation
declare module "fastify" {
  interface FastifyInstance {
    encryption: EncryptionService;
  }
}
```

## Checklist Validasi Enkripsi

Sebelum go-production, HARUS verifikasi:

- [ ] Decrypt data anggota existing dari database production berhasil
- [ ] Encrypt data baru → decrypt → hasilnya sama dengan input
- [ ] Decrypt file dari R2 existing berhasil
- [ ] Encrypt file baru → upload ke R2 → download → decrypt → file sama
- [ ] `ENCRYPTION_KEY` environment variable sama persis dengan monolith
