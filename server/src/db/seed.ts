import prisma from "./prisma";
import bcrypt from "bcryptjs";

async function seed(): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount > 0) { console.log("DB already seeded"); return; }

  const hash = await bcrypt.hash("admin123", 12);
  const user = await prisma.user.create({
    data: { email: "admin@lacasastudio.com", name: "Admin", password: hash, avatar: "AD", role: "admin" },
  });

  const ch1 = await prisma.channel.create({
    data: { name: "Canal Principal", color: "#EF4444", icon: "🎬", subs: "12.5K", userId: user.id },
  });

  await prisma.video.createMany({
    data: [
      { title: "Como eu ganho R$10k/mês com YouTube", channelId: ch1.id, userId: user.id, status: "idea", priority: "alta", date: "2025-02-01" },
      { title: "Setup tour 2025 - meu escritório", channelId: ch1.id, userId: user.id, status: "script", priority: "média" },
      { title: "Top 5 erros de iniciantes no YouTube", channelId: ch1.id, userId: user.id, status: "editing", priority: "alta", date: "2025-01-20" },
    ],
  });

  await prisma.notification.create({
    data: { userId: user.id, type: "success", message: "Bem-vindo ao LaCasaStudio! 🏠", link: "/" },
  });

  console.log("✅ Seed completo: admin@lacasastudio.com / admin123");
}

seed().catch(console.error).finally(() => prisma.$disconnect());
