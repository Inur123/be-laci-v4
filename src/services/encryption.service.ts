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

const encryptionPlugin = fp(
  async (fastify: FastifyInstance) => {
    const key = crypto.scryptSync(fastify.config.ENCRYPTION_KEY, SALT, 32);

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
        if (!ivHex || !encrypted) return encryptedText;
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
  },
  { name: "encryption-service", dependencies: ["env-plugin"] }
);

export default encryptionPlugin;

declare module "fastify" {
  interface FastifyInstance {
    encryption: EncryptionService;
  }
}
