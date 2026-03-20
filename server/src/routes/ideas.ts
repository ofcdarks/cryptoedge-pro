import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();
router.use(authenticate);

const ideaSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().optional(),
  imageUrl: z.string().optional(),
  tags: z.string().optional(),
  color: z.string().optional(),
  pinned: z.boolean().optional(),
  channelId: z.number().int().positive().nullable().optional(),
});

router.get("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const ideas = await prisma.idea.findMany({
      where: { userId: req.userId },
      include: { channel: { select: { id: true, name: true, color: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });
    res.json(ideas);
  } catch (err) { next(err); }
});

router.post("/", validate(ideaSchema), async (req: any, res: Response, next: NextFunction) => {
  try {
    const idea = await prisma.idea.create({
      data: { ...req.validated, userId: req.userId },
      include: { channel: { select: { id: true, name: true, color: true } } },
    });
    res.status(201).json(idea);
  } catch (err) { next(err); }
});

router.put("/:id", validate(ideaSchema.partial()), async (req: any, res: Response, next: NextFunction) => {
  try {
    const idea = await prisma.idea.findFirst({ where: { id: Number(req.params.id), userId: req.userId } });
    if (!idea) return res.status(404).json({ error: "Ideia não encontrada" });
    const updated = await prisma.idea.update({
      where: { id: idea.id }, data: req.validated,
      include: { channel: { select: { id: true, name: true, color: true } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const idea = await prisma.idea.findFirst({ where: { id: Number(req.params.id), userId: req.userId } });
    if (!idea) return res.status(404).json({ error: "Ideia não encontrada" });
    await prisma.idea.delete({ where: { id: idea.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
