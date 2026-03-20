import { Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { AuthRequest } from "../types";

export function validate(schema: ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      res.status(400).json({ error: "Dados inválidos", details: errors });
      return;
    }
    req.validated = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}
