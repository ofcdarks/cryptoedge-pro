import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import logger from "./services/logger";

import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import videoRoutes from "./routes/videos";
import sceneRoutes from "./routes/scenes";
import teamRoutes from "./routes/team";
import assetRoutes from "./routes/assets";
import metaRoutes from "./routes/metas";
import templateRoutes from "./routes/templates";
import budgetRoutes from "./routes/budget";
import notifRoutes from "./routes/notifications";
import checklistRoutes from "./routes/checklists";
import settingsRoutes from "./routes/settings";
import aiRoutes from "./routes/ai";
import youtubeRoutes from "./routes/youtube";
import scriptRoutes from "./routes/scripts";
import seoResultRoutes from "./routes/seo-results";
import ideaRoutes from "./routes/ideas";
import searchRoutes from "./routes/search";
import exportRoutes from "./routes/export";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_ORIGINS: string[] = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : [];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS[0] !== "*" ? ALLOWED_ORIGINS : true,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Muitas requisições de IA." } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Muitas tentativas." } });

app.use("/api/", globalLimiter);
app.use("/api/ai/", aiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/scenes", sceneRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/metas", metaRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/notifications", notifRoutes);
app.use("/api/checklists", checklistRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/youtube", youtubeRoutes);
app.use("/api/scripts", scriptRoutes);
app.use("/api/seo-results", seoResultRoutes);
app.use("/api/ideas", ideaRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/export", exportRoutes);

app.get("/api/health", (_: Request, res: Response) => {
  res.json({ status: "ok", version: "2.2.0", uptime: process.uptime() });
});

const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));
app.get("*", (req: Request, res: Response) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Route not found" });
  }
  res.sendFile(path.join(publicPath, "index.html"));
});

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error(err.message, { path: req.path, method: req.method });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info(`LaCasaStudio V2.2 running on http://0.0.0.0:${PORT}`);
});

export default app;
