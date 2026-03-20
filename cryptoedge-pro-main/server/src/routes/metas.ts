import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import NotifService from "../services/notifications";

const router = Router();
router.use(authenticate);

const metaSchema = z.object({
  title: z.string().min(1).max(200),
  channelId: z.number().int().positive().nullable().optional(),
  items: z.array(z.object({
    label: z.string().min(1),
    current: z.number().optional(),
    target: z.number().optional(),
    unit: z.string().optional(),
  })).optional(),
});

router.get("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const metas = await prisma.meta.findMany({
      where: { userId: req.userId },
      include: { items: true, channel: { select: { id: true, name: true, color: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(metas);
  } catch (err) { next(err); }
});

router.post("/", validate(metaSchema), async (req: any, res: Response, next: NextFunction) => {
  try {
    const { title, channelId, items } = req.validated;
    const meta = await prisma.meta.create({
      data: {
        title, userId: req.userId, channelId: channelId || null,
        items: items ? { create: items } : undefined,
      },
      include: { items: true },
    });
    res.status(201).json(meta);
  } catch (err) { next(err); }
});

router.put("/item/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.metaItem.findUnique({ where: { id: Number(req.params.id) }, include: { meta: true } });
    if (!item || item.meta.userId !== req.userId) return res.status(404).json({ error: "Item não encontrado" });

    const { current, target } = req.body;
    const updated = await prisma.metaItem.update({
      where: { id: item.id },
      data: { ...(current !== undefined && { current }), ...(target !== undefined && { target }) },
    });

    // Check if meta achieved
    if (current !== undefined && target && current >= target) {
      await NotifService.metaAchieved(item.meta.userId, `${item.meta.title}: ${item.label}`);
    }

    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const meta = await prisma.meta.findFirst({ where: { id: Number(req.params.id), userId: req.userId } });
    if (!meta) return res.status(404).json({ error: "Meta não encontrada" });
    await prisma.meta.delete({ where: { id: meta.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
