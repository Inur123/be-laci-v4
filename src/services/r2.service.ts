import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export interface R2Service {
  /**
   * Upload encrypted buffer to R2 and return the key
   */
  uploadEncryptedFile(buffer: Buffer, key: string): Promise<string>;
  
  /**
   * Get the encrypted buffer from R2
   */
  getEncryptedFile(key: string): Promise<Buffer>;
}

const r2Plugin = fp(
  async (fastify: FastifyInstance) => {
    const s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${fastify.config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: fastify.config.R2_ACCESS_KEY_ID || "",
        secretAccessKey: fastify.config.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const bucketName = fastify.config.R2_BUCKET_NAME || "dev";

    const service: R2Service = {
      async uploadEncryptedFile(buffer: Buffer, key: string): Promise<string> {
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: buffer,
          ContentType: "application/octet-stream", // Karena sudah dienkripsi (.enc)
        });

        await s3Client.send(command);
        return key;
      },

      async getEncryptedFile(key: string): Promise<Buffer> {
        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        });

        const response = await s3Client.send(command);
        
        if (!response.Body) {
          throw new Error("File tidak ditemukan di R2");
        }

        const arrayBuffer = await response.Body.transformToByteArray();
        return Buffer.from(arrayBuffer);
      },
    };

    fastify.decorate("r2", service);
  },
  { name: "r2-service", dependencies: ["env-plugin"] }
);

export default r2Plugin;

declare module "fastify" {
  interface FastifyInstance {
    r2: R2Service;
  }
}
