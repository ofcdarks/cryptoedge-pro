import { beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export let testUser: { id: number; email: string; token: string };
export { prisma };

beforeAll(async () => {
  // Clean DB
  await prisma.$executeRawUnsafe("DELETE FROM Notification");
  await prisma.$executeRawUnsafe("DELETE FROM Script");
  await prisma.$executeRawUnsafe("DELETE FROM Checklist");
  await prisma.$executeRawUnsafe("DELETE FROM Scene");
  await prisma.$executeRawUnsafe("DELETE FROM SeoResult");
  await prisma.$executeRawUnsafe("DELETE FROM Video");
  await prisma.$executeRawUnsafe("DELETE FROM Idea");
  await prisma.$executeRawUnsafe("DELETE FROM Asset");
  await prisma.$executeRawUnsafe("DELETE FROM BudgetItem");
  await prisma.$executeRawUnsafe("DELETE FROM Template");
  await prisma.$executeRawUnsafe("DELETE FROM Meta");
  await prisma.$executeRawUnsafe("DELETE FROM Channel");
  await prisma.$executeRawUnsafe("DELETE FROM User");

  // Create test user
  const hash = await bcrypt.hash("test123456", 12);
  const user = await prisma.user.create({
    data: { email: "test@lacasa.com", name: "Test User", password: hash, avatar: "TU" },
  });

  const jwt = await import("jsonwebtoken");
  const token = jwt.default.sign({ id: user.id }, process.env.JWT_SECRET || "test-secret-minimum-32-characters-long-for-testing", { expiresIn: "1h" });

  testUser = { id: user.id, email: user.email, token };
});

afterAll(async () => {
  await prisma.$disconnect();
});
