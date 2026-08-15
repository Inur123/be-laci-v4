import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "node:path";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL wajib diisi.");

const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const providerId = "ipnu-sso";

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function promoteCabangBySubject(subject: string) {
  const account = await prisma.account.findUnique({
    where: {
      providerId_accountId: { providerId, accountId: subject },
    },
  });
  if (!account) throw new Error(`SSO subject tidak ditemukan: ${subject}`);
  await prisma.user.update({
    where: { id: account.userId },
    data: { role: "SEKRETARIS_CABANG" },
  });
}

async function promoteCabangByEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { accounts: { where: { providerId } } },
  });
  if (!user?.accounts.length) {
    throw new Error(`Akun SSO dengan email ini tidak ditemukan: ${email}`);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { role: "SEKRETARIS_CABANG" },
  });
}

async function main() {
  for (const subject of listFromEnv("SSO_CABANG_SUBJECTS")) {
    await promoteCabangBySubject(subject);
  }
  for (const email of listFromEnv("SSO_CABANG_EMAILS")) {
    await promoteCabangByEmail(email);
  }

  for (const domain of listFromEnv("ALLOWED_ORIGINS")) {
    await prisma.allowedOrigin.upsert({
      where: { domain },
      update: {},
      create: { domain },
    });
  }

  console.log("Seed role dan allowed origin selesai.");
}

main()
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
