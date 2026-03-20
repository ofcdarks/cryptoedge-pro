import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

router.get("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ videos: [], ideas: [], assets: [], scripts: [] });

    const [videos, ideas, assets, scripts] = await Promise.all([
      prisma.video.findMany({
        where: { userId: req.userId, title: { contains: q } },
        include: { channel: { select: { id: true, name: true, color: true } } },
        take: 10,
      }),
      prisma.idea.findMany({
        where: { userId: req.userId, OR: [{ title: { contains: q } }, { content: { contains: q } }, { tags: { contains: q } }] },
        take: 10,
      }),
      prisma.asset.findMany({
        where: { userId: req.userId, OR: [{ name: { contains: q } }, { tags: { contains: q } }] },
        take: 10,
      }),
      prisma.script.findMany({
        where: { video: { userId: req.userId }, content: { contains: q } },
        include: { video: { select: { id: true, title: true } } },
        take: 10,
      }),
    ]);

    res.json({ videos, ideas, assets, scripts });
  } catch (err) { next(err); }
});

export default router;
