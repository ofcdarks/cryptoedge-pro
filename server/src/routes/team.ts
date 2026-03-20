import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
const router = Router();
router.use(authenticate);

router.get("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.teamMember.findMany({
      include: { channels: { select: { id: true, name: true, color: true } } },
    });
    res.json(members);
  } catch (err) { next(err); }
});

router.post("/", async (req: any, res: Response, next: NextFunction) => {
  try {
    const { name, role, email, avatar, channelIds } = req.body;
    if (!name) return res.status(400).json({ error: "Nome obrigatório" });
    const member = await prisma.teamMember.create({
      data: { name, role, email, avatar, channels: channelIds ? { connect: channelIds.map(id => ({ id })) } : undefined },
      include: { channels: true },
    });
    res.status(201).json(member);
  } catch (err) { next(err); }
});

router.put("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    const { name, role, email, avatar, status, tasks } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (email !== undefined) data.email = email;
    if (avatar !== undefined) data.avatar = avatar;
    if (status !== undefined) data.status = status;
    if (tasks !== undefined) data.tasks = tasks;
    const updated = await prisma.teamMember.update({ where: { id: Number(req.params.id) }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: any, res: Response, next: NextFunction) => {
  try {
    await prisma.teamMember.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
