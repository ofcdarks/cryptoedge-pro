import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
const router = Router();
router.use(authenticate);

async function ownsVideo(userId, videoId) {
  return prisma.video.findFirst({ where: { id: Number(videoId), userId } });
}

router.get("/video/:videoId", async (req: any, res: Response, next: NextFunction) => {
  try {
    const video = await ownsVideo(req.userId, req.params.videoId);
    if (!video) return res.status(404).json({ error: "Vídeo não encontrado" });
    const scenes = await prisma.scene.findMany({ where: { videoId: video.id }, orderBy: { order: "asc" } });
    res.json(scenes);
  } catch (err) { next(err); }
});

router.post("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const { title, videoId, type, duration, notes, camera, audio, color, order } = req.body;
    if (!title || !videoId) return res.status(400).json({ error: "Título e vídeo obrigatórios" });
    const video = await ownsVideo(req.userId, videoId);
    if (!video) return res.status(403).json({ error: "Acesso negado" });
    const scene = await prisma.scene.create({ data: { title, videoId: video.id, type, duration, notes, camera, audio, color, order: order || 0 } });
    res.status(201).json(scene);
  } catch (err) { next(err); }
});

router.put("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const scene = await prisma.scene.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!scene || scene.video.userId !== req.userId) return res.status(404).json({ error: "Cena não encontrada" });
    const { title, type, duration, notes, camera, audio, color, order } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (type !== undefined) data.type = type;
    if (duration !== undefined) data.duration = duration;
    if (notes !== undefined) data.notes = notes;
    if (camera !== undefined) data.camera = camera;
    if (audio !== undefined) data.audio = audio;
    if (color !== undefined) data.color = color;
    if (order !== undefined) data.order = order;
    const updated = await prisma.scene.update({ where: { id: scene.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

router.put("/reorder/:videoId", async (req: any, res: Response, next: NextFunction) => {
  try {
    const video = await ownsVideo(req.userId, req.params.videoId);
    if (!video) return res.status(403).json({ error: "Acesso negado" });
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds obrigatório" });
    await Promise.all(orderedIds.map((id, i) => prisma.scene.update({ where: { id }, data: { order: i } })));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const scene = await prisma.scene.findUnique({ where: { id: Number(req.params.id) }, include: { video: true } });
    if (!scene || scene.video.userId !== req.userId) return res.status(404).json({ error: "Cena não encontrada" });
    await prisma.scene.delete({ where: { id: scene.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
