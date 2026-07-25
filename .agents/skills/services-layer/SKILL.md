---
name: services-layer
description: Service layer patterns untuk Laci Digital Backend — R2 Storage, Email, Activity Logger, JWT, reCAPTCHA, dan Realtime SSE. Trigger saat bekerja dengan file upload/download, email, logging, JWT tokens, reCAPTCHA, atau SSE realtime.
---

# Services Layer — Fastify Plugins

Semua services diimplementasikan sebagai **Fastify plugin** menggunakan `fp()` agar bisa diakses dari semua routes via `fastify.serviceName` atau `request.server.serviceName`.

## 1. R2 Storage Service

Cloudflare R2 (S3-compatible) untuk menyimpan file terenkripsi.

```typescript
// src/services/storage.service.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

export interface StorageService {
  upload(buffer: Buffer, originalName: string, folder?: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export default fp(async (fastify: FastifyInstance) => {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${fastify.config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: fastify.config.R2_ACCESS_KEY_ID,
      secretAccessKey: fastify.config.R2_SECRET_ACCESS_KEY,
    },
  });

  const bucket = fastify.config.R2_BUCKET_NAME;

  const service: StorageService = {
    async upload(buffer: Buffer, originalName: string, folder = "files"): Promise<string> {
      const ext = originalName.split(".").pop() || "bin";
      const key = `${folder}/${randomUUID()}.${ext}.enc`;  // .enc suffix untuk encrypted

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: "application/octet-stream", // Selalu octet-stream karena encrypted
      }));

      return key;
    },

    async download(key: string): Promise<Buffer> {
      const response = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }));

      const stream = response.Body;
      if (!stream) throw new Error("Empty response from R2");

      // Convert stream ke buffer
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async delete(key: string): Promise<void> {
      await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
    },
  };

  fastify.decorate("storage", service);
}, { name: "storage-service" });

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageService;
  }
}
```

### Pattern: Upload File Terenkripsi

```typescript
// Saat upload file, SELALU encrypt dulu baru upload
async function uploadEncryptedFile(
  server: FastifyInstance,
  fileBuffer: Buffer,
  fileName: string,
  folder: string
): Promise<string> {
  const encrypted = server.encryption.encryptFile(fileBuffer);
  const key = await server.storage.upload(encrypted, fileName, folder);
  return key;
}

// Saat download file, download dulu baru decrypt
async function downloadDecryptedFile(
  server: FastifyInstance,
  key: string
): Promise<Buffer> {
  const encrypted = await server.storage.download(key);
  return server.encryption.decryptFile(encrypted);
}
```

## 2. Email Service

Nodemailer untuk pengiriman email (verifikasi, OTP, notifikasi pengajuan).

```typescript
// src/services/email.service.ts
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export interface EmailService {
  sendOTP(email: string, otp: string): Promise<void>;
  sendVerification(email: string, url: string): Promise<void>;
  sendPengajuanNotification(params: PengajuanEmailParams): Promise<void>;
  sendPengajuanStatusUpdate(params: PengajuanStatusParams): Promise<void>;
}

interface PengajuanEmailParams {
  recipientEmail: string;
  recipientName: string;
  pengajuanTitle: string;
  pengajuName: string;
  isAdmin: boolean; // true = notif ke admin, false = konfirmasi ke pengaju
}

interface PengajuanStatusParams {
  recipientEmail: string;
  recipientName: string;
  pengajuanTitle: string;
  status: "DITERIMA" | "DITOLAK";
  catatan?: string;
}

export default fp(async (fastify: FastifyInstance) => {
  const transporter: Transporter = nodemailer.createTransport({
    host: fastify.config.SMTP_HOST,
    port: fastify.config.SMTP_PORT,
    secure: false,
    auth: {
      user: fastify.config.SMTP_USER,
      pass: fastify.config.SMTP_PASS,
    },
  });

  // Verify connection
  try {
    await transporter.verify();
    fastify.log.info("SMTP connection verified");
  } catch (error) {
    fastify.log.warn("SMTP connection failed — emails will not be sent");
  }

  const service: EmailService = {
    async sendOTP(email: string, otp: string): Promise<void> {
      await sendAndLog(fastify, transporter, {
        to: email,
        subject: "Kode OTP - Laci Digital",
        html: generateOTPTemplate(otp),
        type: "OTP",
      });
    },

    async sendVerification(email: string, url: string): Promise<void> {
      await sendAndLog(fastify, transporter, {
        to: email,
        subject: "Verifikasi Email - Laci Digital",
        html: generateVerificationTemplate(url),
        type: "VERIFICATION",
      });
    },

    async sendPengajuanNotification(params: PengajuanEmailParams): Promise<void> {
      await sendAndLog(fastify, transporter, {
        to: params.recipientEmail,
        subject: `Pengajuan Berkas Baru - ${params.pengajuanTitle}`,
        html: generatePengajuanTemplate(params),
        type: "NOTIFICATION",
      });
    },

    async sendPengajuanStatusUpdate(params: PengajuanStatusParams): Promise<void> {
      await sendAndLog(fastify, transporter, {
        to: params.recipientEmail,
        subject: `Status Pengajuan: ${params.status} - ${params.pengajuanTitle}`,
        html: generatePengajuanStatusTemplate(params),
        type: "PENGAJUAN_STATUS",
      });
    },
  };

  fastify.decorate("emailService", service);
}, { name: "email-service" });

// Helper: Send email dan log ke database
async function sendAndLog(
  fastify: FastifyInstance,
  transporter: Transporter,
  params: { to: string; subject: string; html: string; type: string }
): Promise<void> {
  try {
    await transporter.sendMail({
      from: `"Laci Digital" <${fastify.config.SMTP_USER}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    // Log ke database (fire and forget)
    fastify.prisma.logEmail.create({
      data: {
        to: params.to,
        subject: params.subject,
        type: params.type as any,
        status: "SENT",
      },
    }).catch((err) => fastify.log.error(err, "Failed to log email"));
  } catch (error) {
    // Log failed email
    fastify.prisma.logEmail.create({
      data: {
        to: params.to,
        subject: params.subject,
        type: params.type as any,
        status: "FAILED",
        error: (error as Error).message,
      },
    }).catch((err) => fastify.log.error(err, "Failed to log email error"));

    fastify.log.error(error, `Failed to send email to ${params.to}`);
    // Jangan throw — email failure bukan critical path
  }
}

declare module "fastify" {
  interface FastifyInstance {
    emailService: EmailService;
  }
}
```

### Email Templates

Email templates disimpan di `src/email-templates/` sebagai fungsi TypeScript yang return HTML string. Copy EXACT dari monolith.

## 3. JWT Service

```typescript
// src/services/jwt.service.ts
import * as jose from "jose";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export interface JwtService {
  create(payload: { sub: string; role: string }): Promise<string>;
  verify(token: string): Promise<{ sub: string; role: string; iat: number } | null>;
}

export default fp(async (fastify: FastifyInstance) => {
  const secret = new TextEncoder().encode(fastify.config.BETTER_AUTH_SECRET);

  const service: JwtService = {
    async create(payload): Promise<string> {
      return new jose.SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(secret);
    },

    async verify(token): Promise<{ sub: string; role: string; iat: number } | null> {
      try {
        const { payload } = await jose.jwtVerify(token, secret);
        return payload as { sub: string; role: string; iat: number };
      } catch {
        return null;
      }
    },
  };

  fastify.decorate("jwtService", service);
}, { name: "jwt-service" });

declare module "fastify" {
  interface FastifyInstance {
    jwtService: JwtService;
  }
}
```

## 4. reCAPTCHA Service

```typescript
// src/services/recaptcha.service.ts
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export interface RecaptchaService {
  verify(token: string): Promise<{ success: boolean; score: number }>;
}

export default fp(async (fastify: FastifyInstance) => {
  const service: RecaptchaService = {
    async verify(token: string) {
      const response = await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret: fastify.config.RECAPTCHA_SECRET_KEY,
            response: token,
          }),
        }
      );

      const data = await response.json() as { success: boolean; score: number };
      return data;
    },
  };

  fastify.decorate("recaptcha", service);
}, { name: "recaptcha-service" });

declare module "fastify" {
  interface FastifyInstance {
    recaptcha: RecaptchaService;
  }
}
```

## 5. Realtime SSE Hub

PG LISTEN/NOTIFY + Server-Sent Events.

```typescript
// src/plugins/realtime.ts
import { Client } from "pg";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

interface SSEClient {
  id: string;
  userId: string;
  reply: FastifyReply;
}

export default fp(async (fastify: FastifyInstance) => {
  const clients: Map<string, SSEClient> = new Map();
  let pgClient: Client | null = null;

  // Setup PG LISTEN
  async function setupListener() {
    pgClient = new Client({ connectionString: fastify.config.DATABASE_URL });
    await pgClient.connect();
    await pgClient.query("LISTEN laci_realtime");

    pgClient.on("notification", (msg) => {
      if (msg.channel === "laci_realtime" && msg.payload) {
        // Broadcast ke semua connected SSE clients
        const data = JSON.parse(msg.payload);
        for (const client of clients.values()) {
          try {
            client.reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch {
            clients.delete(client.id);
          }
        }
      }
    });

    pgClient.on("error", (err) => {
      fastify.log.error(err, "PG LISTEN client error");
      // Reconnect
      setTimeout(setupListener, 5000);
    });
  }

  await setupListener();

  // Decorate with SSE handler
  fastify.decorate("addSSEClient", (id: string, userId: string, reply: FastifyReply) => {
    clients.set(id, { id, userId, reply });
  });

  fastify.decorate("removeSSEClient", (id: string) => {
    clients.delete(id);
  });

  // Cleanup on close
  fastify.addHook("onClose", async () => {
    if (pgClient) {
      await pgClient.end();
    }
    clients.clear();
  });
}, { name: "realtime-plugin" });

declare module "fastify" {
  interface FastifyInstance {
    addSSEClient(id: string, userId: string, reply: FastifyReply): void;
    removeSSEClient(id: string): void;
  }
}
```

### SSE Route

```typescript
// src/routes/realtime/index.ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "@/middleware/auth.middleware";

export default async function realtimeRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    preHandler: [requireAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const clientId = randomUUID();

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": request.headers.origin || "*",
      "Access-Control-Allow-Credentials": "true",
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

    // Register client
    fastify.addSSEClient(clientId, request.user!.id, reply);

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
        fastify.removeSSEClient(clientId);
      }
    }, 30000);

    // Cleanup on disconnect
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      fastify.removeSSEClient(clientId);
    });
  });
}
```

## Ringkasan Service Registration Order

Di `src/index.ts`, register services dalam urutan ini:

```typescript
// 1. Core (no dependencies)
await fastify.register(prismaPlugin);       // Database

// 2. Services (depends on config/prisma)
await fastify.register(encryptionService);  // Encryption
await fastify.register(storageService);     // R2 Storage
await fastify.register(emailService);       // Email (depends on prisma for logging)
await fastify.register(logService);         // Activity Logger (depends on prisma)
await fastify.register(jwtService);         // JWT
await fastify.register(recaptchaService);   // reCAPTCHA

// 3. Auth (depends on prisma + email)
await fastify.register(authPlugin);

// 4. Infrastructure
await fastify.register(swaggerPlugin);      // API Docs
await fastify.register(realtimePlugin);     // SSE Hub (depends on prisma)

// 5. Routes (depends on everything above)
await fastify.register(authRoutes, { prefix: "/api/auth" });
await fastify.register(anggotaRoutes, { prefix: "/api/anggota" });
// ...
```
