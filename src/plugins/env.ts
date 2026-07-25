import fastifyEnv from "@fastify/env";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const schema = {
  type: "object",
  required: ["DATABASE_URL", "API_KEY", "ENCRYPTION_KEY", "CRON_SECRET", "BETTER_AUTH_SECRET"],
  properties: {
    PORT: { type: "number", default: 3001 },
    HOST: { type: "string", default: "0.0.0.0" },
    NODE_ENV: { type: "string", default: "development" },
    DATABASE_URL: { type: "string" },
    DIRECT_URL: { type: "string" },
    API_KEY: { type: "string" },
    ENCRYPTION_KEY: { type: "string" },
    CRON_SECRET: { type: "string" },
    BETTER_AUTH_SECRET: { type: "string" },
    BETTER_AUTH_URL: { type: "string", default: "http://localhost:3001" },
    BETTER_AUTH_API_KEY: { type: "string" },
    FRONTEND_URL: { type: "string", default: "http://localhost:3000" },
    GOOGLE_CLIENT_ID: { type: "string" },
    GOOGLE_CLIENT_SECRET: { type: "string" },
    RECAPTCHA_SECRET_KEY: { type: "string" },
    SMTP_HOST: { type: "string" },
    SMTP_PORT: { type: "number", default: 587 },
    SMTP_USER: { type: "string" },
    SMTP_PASS: { type: "string" },
    R2_ACCOUNT_ID: { type: "string" },
    R2_ACCESS_KEY_ID: { type: "string" },
    R2_SECRET_ACCESS_KEY: { type: "string" },
    R2_BUCKET_NAME: { type: "string" },
  },
};

const options = {
  schema,
  dotenv: true,
};

export default fp(
  async (fastify: FastifyInstance) => {
    await fastify.register(fastifyEnv, options);
  },
  { name: "env-plugin" }
);

declare module "fastify" {
  interface FastifyInstance {
    config: {
      PORT: number;
      HOST: string;
      NODE_ENV: string;
      DATABASE_URL: string;
      DIRECT_URL: string;
      API_KEY: string;
      ENCRYPTION_KEY: string;
      CRON_SECRET: string;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
      BETTER_AUTH_API_KEY?: string;
      FRONTEND_URL: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      RECAPTCHA_SECRET_KEY?: string;
      SMTP_HOST?: string;
      SMTP_PORT?: number;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      R2_ACCOUNT_ID?: string;
      R2_ACCESS_KEY_ID?: string;
      R2_SECRET_ACCESS_KEY?: string;
      R2_BUCKET_NAME?: string;
    };
  }
}
