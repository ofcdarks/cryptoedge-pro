import { Router, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../db/prisma";
import { authenticate, signToken } from "../middleware/auth";
import { validate } from "../middleware/validate";
import NotifService from "../services/notifications";
import { AuthRequest } from "../types";

const router = Router();

const registerSchema = z.object({
  email: z.string().email("Email inválido"),
  name: z.string().min(2).max(100),
  password: z.string().min(6).max(128),
});

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1),
});

router.post("/register", validate(registerSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, name, password } = req.validated;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) { res.status(409).json({ error: "Email já cadastrado" }); return; }

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, password: hash, avatar: name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() },
    });
    const token = signToken({ id: user.id });
    await NotifService.create(user.id, "success", "Bem-vindo ao LaCasaStudio! 🏠", "/");
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) { next(err); }
});

router.post("/login", validate(loginSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.validated;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { res.status(401).json({ error: "Credenciais inválidas" }); return; }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { res.status(401).json({ error: "Credenciais inválidas" }); return; }

    const token = signToken({ id: user.id });
    NotifService.checkDeadlines(user.id).catch(() => {});
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) { next(err); }
});

router.get("/me", authenticate as any, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, avatar: true, role: true },
    });
    if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
    res.json(user);
  } catch (err) { next(err); }
});

export default router;
