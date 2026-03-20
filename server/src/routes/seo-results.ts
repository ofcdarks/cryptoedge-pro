import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
const router = Router();
router.use(authenticate);

router.get("/video/:videoId", async (req: any, res: Response, next: NextFunction) => {
  try {
    const video = await prisma.video.findFirst({ where: { id: Number(req.params.videoId), userId: req.userId } });
    if (!video) return res.status(404).json({ error: "Vídeo não encontrado" });
    const results = await prisma.seoResult.findMany({ where: { videoId: video.id }, orderBy: { createdAt: "desc" } });
    res.json(results);
  } catch (err) { next(err); }
});

router.post("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const { videoId, titles, description, tags, score, tips } = req.body;
    if (!videoId) return res.status(400).json({ error: "videoId obrigatório" });
    const video = await prisma.video.findFirst({ where: { id: Number(videoId), userId: req.userId } });
    if (!video) return res.status(403).json({ error: "Acesso negado" });
    const result = await prisma.seoResult.create({
      data: { videoId: video.id, titles: titles || "", description: description || "", tags: tags || "", score: score || "", tips: tips || "" },
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const sr = await prisma.seoResult.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!sr || sr.video.userId !== req.userId) return res.status(404).json({ error: "Resultado não encontrado" });
    await prisma.seoResult.delete({ where: { id: sr.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
