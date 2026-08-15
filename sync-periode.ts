import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  const users = await prisma.user.findMany({
    include: {
      periodes: {
        where: { isActive: true },
      },
    },
  });

  for (const user of users) {
    if (user.periodes.length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { periodeAktifId: user.periodes[0]!.id },
      });
      console.log(`Updated user ${user.email} with active period ${user.periodes[0]!.nama}`);
    } else {
      console.log(`User ${user.email} has no active period`);
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
