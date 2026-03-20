import prisma from "../db/prisma";

const NotifService = {
  async create(userId: number, type: string, message: string, link: string = "") {
    return prisma.notification.create({ data: { userId, type, message, link } });
  },

  async videoCreated(userId: number, videoTitle: string) {
    return this.create(userId, "success", `Vídeo "${videoTitle}" criado com sucesso`, "/planner");
  },

  async videoStatusChanged(userId: number, videoTitle: string, newStatus: string) {
    const statusLabels: Record<string, string> = {
      idea: "Ideia", script: "Roteiro", filming: "Gravação",
      editing: "Edição", review: "Revisão", scheduled: "Agendado", published: "Publicado",
    };
    const label = statusLabels[newStatus] || newStatus;
    return this.create(userId, "info", `"${videoTitle}" movido para ${label}`, "/planner");
  },

  async videoPublished(userId: number, videoTitle: string) {
    return this.create(userId, "success", `🎉 "${videoTitle}" foi publicado!`, "/planner");
  },

  async deadlineApproaching(userId: number, videoTitle: string, date: string) {
    return this.create(userId, "warning", `⏰ "${videoTitle}" tem deadline em ${date}`, "/planner");
  },

  async metaAchieved(userId: number, metaTitle: string) {
    return this.create(userId, "success", `🎯 Meta "${metaTitle}" atingida!`, "/metas");
  },

  async aiGenerated(userId: number, type: string) {
    const labels: Record<string, string> = { seo: "SEO", script: "Roteiro", storyboard: "Storyboard", titles: "Títulos" };
    return this.create(userId, "info", `IA gerou ${labels[type] || type} com sucesso`, "/seo");
  },

  async channelCreated(userId: number, channelName: string) {
    return this.create(userId, "success", `Canal "${channelName}" adicionado`, "/");
  },

  async checkDeadlines(userId: number): Promise<void> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const videos = await prisma.video.findMany({
      where: { userId, date: tomorrowStr, status: { not: "published" } },
    });

    for (const v of videos) {
      const existing = await prisma.notification.findFirst({
        where: { userId, message: { contains: v.title }, createdAt: { gte: new Date(Date.now() - 86400000) } },
      });
      if (!existing) {
        await this.deadlineApproaching(userId, v.title, v.date);
      }
    }
  },
};

export default NotifService;
