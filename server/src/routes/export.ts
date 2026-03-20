import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/video/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const video = await prisma.video.findFirst({
      where: { id: Number(req.params.id), userId: req.userId },
      include: { channel: true, scenes: { orderBy: { order: "asc" } }, checklists: true, scripts: { orderBy: { version: "desc" } }, seoResults: true },
    });
    if (!video) { res.status(404).json({ error: "Vídeo não encontrado" }); return; }
    res.json(video);
  } catch (err) { next(err); }
});

router.get("/script/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const script = await prisma.script.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!script || script.video.userId !== req.userId) { res.status(404).json({ error: "Script não encontrado" }); return; }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"" + script.video.title + "-v" + script.version + ".txt\"");
    const text = "# " + script.video.title + "\n# Versão " + script.version + " — " + script.label + "\n# " + new Date(script.updatedAt).toLocaleDateString("pt-BR") + "\n\n" + script.content;
    res.send(text);
  } catch (err) { next(err); }
});

router.get("/videos-csv", async (req: any, res: Response, next: NextFunction) => {
  try {
    const videos = await prisma.video.findMany({
      where: { userId: req.userId },
      include: { channel: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const header = "ID,Título,Canal,Status,Prioridade,Data,Duração,Criado em\n";
    const rows = videos.map((v: any) =>
      v.id + ',"' + v.title + '","' + (v.channel?.name || "") + '",' + v.status + "," + v.priority + "," + v.date + "," + v.duration + "," + new Date(v.createdAt).toLocaleDateString("pt-BR")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=videos-lacasastudio.csv");
    res.send("\uFEFF" + header + rows);
  } catch (err) { next(err); }
});

router.get("/budget-csv", async (req: any, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.budgetItem.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
    const header = "ID,Categoria,Descrição,Valor,Tipo,Mês,Recorrente\n";
    const rows = items.map((i: any) =>
      i.id + ',"' + i.category + '","' + i.desc + '",' + i.value + "," + i.type + "," + i.month + "," + i.recurring
    ).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=orcamento-lacasastudio.csv");
    res.send("\uFEFF" + header + rows);
  } catch (err) { next(err); }
});

export default router;
