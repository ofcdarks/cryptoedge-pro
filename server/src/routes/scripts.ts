import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

router.get("/video/:videoId", async (req: any, res: Response, next: NextFunction) => {
  try {
    const video = await prisma.video.findFirst({ where: { id: Number(req.params.videoId), userId: req.userId } });
    if (!video) return res.status(404).json({ error: "Vídeo não encontrado" });
    const scripts = await prisma.script.findMany({
      where: { videoId: video.id },
      orderBy: { version: "desc" },
    });
    res.json(scripts);
  } catch (err) { next(err); }
});

router.post("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const { content, videoId, label } = req.body;
    if (!videoId) return res.status(400).json({ error: "videoId obrigatório" });
    const video = await prisma.video.findFirst({ where: { id: Number(videoId), userId: req.userId } });
    if (!video) return res.status(403).json({ error: "Vídeo não pertence a este usuário" });

    // Auto-increment version
    const latest = await prisma.script.findFirst({
      where: { videoId: video.id }, orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version || 0) + 1;

    const script = await prisma.script.create({
      data: { content: content || "", videoId: video.id, version: nextVersion, label: label || `v${nextVersion}` },
    });
    res.status(201).json(script);
  } catch (err) { next(err); }
});

router.put("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const script = await prisma.script.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!script || script.video.userId !== req.userId) return res.status(404).json({ error: "Script não encontrado" });
    const { content, label } = req.body;
    const updated = await prisma.script.update({
      where: { id: script.id },
      data: { ...(content !== undefined && { content }), ...(label !== undefined && { label }) },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const script = await prisma.script.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!script || script.video.userId !== req.userId) return res.status(404).json({ error: "Script não encontrado" });
    await prisma.script.delete({ where: { id: script.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
