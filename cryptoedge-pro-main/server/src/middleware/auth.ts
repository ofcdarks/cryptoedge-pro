import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "../types";

const JWT_SECRET: string = process.env.JWT_SECRET || "";
if (!JWT_SECRET || JWT_SECRET.includes("change") || JWT_SECRET.length < 32) {
  console.error("\n❌ FATAL: JWT_SECRET must be set in .env with at least 32 chars.\n");
  process.exit(1);
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token não fornecido" });
    return;
  }
  try {
    const decoded = jwt.verify(header.split(" ")[1], JWT_SECRET) as { id: number };
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function signToken(payload: { id: number }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export { JWT_SECRET };
