import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
});

async function main() {
  const email = "pelajarnumagetan@gmail.com";
  const password = "password";
  const userId = "ipnuippnu-admin-cabang";

  console.log("🚀 Memulai proses seeding aman di DB Lokal...");

  // 1. Cek apakah Admin sudah ada
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (!existingUser) {
    console.log("   ➤ Admin belum ada, mendaftarkan via Better Auth API...");
    const signUpResponse = await (auth.api as any).signUpEmail({
      body: { email, password, name: "Sekretaris Cabang" },
      headers: new Headers(),
    });

    if (signUpResponse?.user) {
      const newUserId = signUpResponse.user.id;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: newUserId },
          data: { id: userId, role: "SEKRETARIS_CABANG", isActive: true, emailVerified: true },
        }),
        prisma.account.updateMany({
          where: { userId: newUserId },
          data: { userId: userId },
        }),
      ]);
      console.log("   ✓ Admin Cabang (Sekretaris Cabang) berhasil dibuat.");
    }
  } else {
    console.log("   ✓ Admin sudah ada, melewati pembuatan user.");
  }

  // 2. Seed Allowed Origins
  const domains = [
    "localhost",
    "laci.pelajarnumagetan.or.id",
    "pelajarnumagetan.or.id",
    "data.laci.pelajarnumagetan.or.id",
  ];

  console.log("   ➤ Sinkronisasi daftar domain yang diizinkan...");
  for (const domain of domains) {
    await prisma.allowedOrigin.upsert({
      where: { domain },
      update: {},
      create: { domain },
    });
  }
  console.log("   ✓ Domain berhasil disinkronkan.");

  console.log("✅ Proses Seed Database Selesai!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error("❌ Seed Gagal:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
