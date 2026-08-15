import fastifyEnv from "@fastify/env";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const schema = {
  type: "object",
  required: [
    "DATABASE_URL",
    "ENCRYPTION_KEY",
    "CRON_SECRET",
    "SSO_ISSUER_URL",
    "SSO_CLIENT_ID",
    "SSO_CLIENT_SECRET",
    "SSO_REDIRECT_URI",
  ],
  properties: {
    PORT: { type: "number", default: 3001 },
    HOST: { type: "string", default: "0.0.0.0" },
    NODE_ENV: { type: "string", default: "development" },
    DATABASE_URL: { type: "string" },
    DIRECT_URL: { type: "string" },
    ENCRYPTION_KEY: { type: "string" },
    CRON_SECRET: { type: "string" },
    FRONTEND_URL: { type: "string", default: "http://localhost:3000" },
    SSO_ISSUER_URL: { type: "string", default: "https://api.ipnu.web.id" },
    SSO_CLIENT_ID: { type: "string" },
    SSO_CLIENT_SECRET: { type: "string" },
    SSO_REDIRECT_URI: {
      type: "string",
      default: "http://localhost:3000/api/auth/oauth2/callback/ipnu-sso",
    },
    SSO_PROVISIONING_SECRET: { type: "string" },
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
      ENCRYPTION_KEY: string;
      CRON_SECRET: string;
      FRONTEND_URL: string;
      SSO_ISSUER_URL: string;
      SSO_CLIENT_ID: string;
      SSO_CLIENT_SECRET: string;
      SSO_REDIRECT_URI: string;
      SSO_PROVISIONING_SECRET?: string;
      R2_ACCOUNT_ID?: string;
      R2_ACCESS_KEY_ID?: string;
      R2_SECRET_ACCESS_KEY?: string;
      R2_BUCKET_NAME?: string;
    };
  }
}
