import { Router, Response, NextFunction } from "express";
import prisma from "../db/prisma";
import { authenticate } from "../middleware/auth";
import cache from "../services/cache";
import { AuthRequest } from "../types";

const router = Router();
router.use(authenticate as any);

const YT_API = "https://www.googleapis.com/youtube/v3";

async function getYtKey(): Promise<string> {
  const cached = cache.get<string>("yt_key");
  if (cached) return cached;
  const s = await prisma.setting.findUnique({ where: { key: "youtube_api_key" } });
  const key = s?.value || "";
  if (key) cache.set("yt_key", key, 60000);
  return key;
}

async function getAiKey(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: "laozhang_api_key" } });
  return s?.value || "";
}

async function getModel(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: "ai_model" } });
  return s?.value || "claude-sonnet-4-6";
}

router.get("/channel/:channelId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const key = await getYtKey();
    if (!key) { res.status(400).json({ error: "Configure sua YouTube API Key nas Configurações" }); return; }

    const { channelId } = req.params;
    const url = channelId.startsWith("UC")
      ? `${YT_API}/channels?part=statistics,snippet,contentDetails&id=${channelId}&key=${key}`
      : `${YT_API}/channels?part=statistics,snippet,contentDetails&forHandle=${channelId}&key=${key}`;

    const resp = await fetch(url);
    if (!resp.ok) { const err = await resp.text(); res.status(resp.status).json({ error: `YouTube API: ${err}` }); return; }
    const data = await resp.json();
    if (!data.items?.length) { res.status(404).json({ error: "Canal não encontrado" }); return; }

    const ch = data.items[0];
    res.json({
      id: ch.id, title: ch.snippet.title, description: ch.snippet.description,
      thumbnail: ch.snippet.thumbnails?.medium?.url, customUrl: ch.snippet.customUrl,
      publishedAt: ch.snippet.publishedAt,
      stats: { subscribers: Number(ch.statistics.subscriberCount), views: Number(ch.statistics.viewCount), videos: Number(ch.statistics.videoCount) },
      uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads,
    });
  } catch (err) { next(err); }
});

router.get("/videos/:channelId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const key = await getYtKey();
    if (!key) { res.status(400).json({ error: "Configure sua YouTube API Key nas Configurações" }); return; }

    const { channelId } = req.params;
    const max = req.query.max || 10;

    const chResp = await fetch(`${YT_API}/channels?part=contentDetails&id=${channelId}&key=${key}`);
    const chData = await chResp.json();
    const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) { res.status(404).json({ error: "Playlist de uploads não encontrada" }); return; }

    const plResp = await fetch(`${YT_API}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=${max}&key=${key}`);
    const plData = await plResp.json();
    const videoIds = (plData.items || []).map((i: any) => i.contentDetails.videoId).join(",");
    if (!videoIds) { res.json([]); return; }

    const vResp = await fetch(`${YT_API}/videos?part=statistics,snippet,contentDetails&id=${videoIds}&key=${key}`);
    const vData = await vResp.json();

    const videos = (vData.items || []).map((v: any) => ({
      id: v.id, title: v.snippet.title, thumbnail: v.snippet.thumbnails?.medium?.url,
      publishedAt: v.snippet.publishedAt, duration: v.contentDetails.duration,
      stats: { views: Number(v.statistics.viewCount || 0), likes: Number(v.statistics.likeCount || 0), comments: Number(v.statistics.commentCount || 0) },
    }));
    res.json(videos);
  } catch (err) { next(err); }
});

router.post("/analyze", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const aiKey = await getAiKey();
    if (!aiKey) { res.status(400).json({ error: "Configure sua API Key nas Configurações" }); return; }
    const model = await getModel();
    const { channelName, stats, recentVideos } = req.body;

    const system = `Você é um consultor de YouTube especialista em crescimento de canais. Responda em JSON válido sem markdown.`;
    const prompt = `Analise este canal: ${channelName}\nInscritos: ${stats?.subscribers || "N/A"}\nViews: ${stats?.views || "N/A"}\nVídeos: ${stats?.videos || "N/A"}\n\nÚltimos vídeos:\n${(recentVideos || []).map((v: any) => `- "${v.title}" — ${v.stats?.views} views`).join("\n")}\n\nJSON: {"summary":"","strengths":["","",""],"improvements":["","",""],"nextVideoIdeas":["","","","",""],"bestPostingTime":"","engagementTips":["","",""],"growthScore":75}`;

    const resp = await fetch("https://api.laozhang.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: 0.7, max_tokens: 2000 }),
    });

    if (!resp.ok) throw new Error(`AI API error: ${resp.status}`);
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    try {
      res.json(JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()));
    } catch {
      res.status(500).json({ error: "IA retornou formato inválido", raw });
    }
  } catch (err) { next(err); }
});

export default router;
