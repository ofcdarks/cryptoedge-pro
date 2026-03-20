import type { Video, Channel, Idea, Asset, Meta, Template, BudgetItem, TeamMember, Script, SearchResults, Notification, Scene, ChecklistItem } from "../types";

const BASE = "/api";

function getToken(): string | null { return localStorage.getItem("lc_token"); }

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body instanceof FormData) delete headers["Content-Type"];

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401) {
    localStorage.removeItem("lc_token");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro na requisição");
  return data as T;
}

const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: any) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export const authApi = {
  login: (email: string, password: string) => api.post<{ token: string; user: { id: number; name: string; email: string; avatar: string } }>("/auth/login", { email, password }),
  register: (email: string, name: string, password: string) => api.post<{ token: string; user: { id: number; name: string; email: string; avatar: string } }>("/auth/register", { email, name, password }),
  me: () => api.get<{ id: number; name: string; email: string; avatar: string; role: string }>("/auth/me"),
};

export const channelApi = {
  list: () => api.get<Channel[]>("/channels"),
  create: (data: Partial<Channel>) => api.post<Channel>("/channels", data),
  update: (id: number, data: Partial<Channel>) => api.put<Channel>(`/channels/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/channels/${id}`),
};

export const videoApi = {
  list: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get<Video[]>(`/videos${q ? `?${q}` : ""}`);
  },
  get: (id: number) => api.get<Video>(`/videos/${id}`),
  create: (data: Partial<Video>) => api.post<Video>("/videos", data),
  update: (id: number, data: Partial<Video>) => api.put<Video>(`/videos/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/videos/${id}`),
};

export const sceneApi = {
  listByVideo: (videoId: number) => api.get<Scene[]>(`/scenes/video/${videoId}`),
  create: (data: Partial<Scene>) => api.post<Scene>("/scenes", data),
  update: (id: number, data: Partial<Scene>) => api.put<Scene>(`/scenes/${id}`, data),
  reorder: (videoId: number, orderedIds: number[]) => api.put<{ ok: boolean }>(`/scenes/reorder/${videoId}`, { orderedIds }),
  del: (id: number) => api.del<{ ok: boolean }>(`/scenes/${id}`),
};

export const teamApi = {
  list: () => api.get<TeamMember[]>("/team"),
  create: (data: Partial<TeamMember>) => api.post<TeamMember>("/team", data),
  update: (id: number, data: Partial<TeamMember>) => api.put<TeamMember>(`/team/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/team/${id}`),
};

export const assetApi = {
  list: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get<Asset[]>(`/assets${q ? `?${q}` : ""}`);
  },
  create: (data: Partial<Asset>) => api.post<Asset>("/assets", data),
  upload: (formData: FormData): Promise<Asset> => {
    const token = getToken();
    return fetch(`${BASE}/assets/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro no upload");
      return data;
    });
  },
  update: (id: number, data: Partial<Asset>) => api.put<Asset>(`/assets/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/assets/${id}`),
};

export const metaApi = {
  list: () => api.get<Meta[]>("/metas"),
  create: (data: any) => api.post<Meta>("/metas", data),
  updateItem: (id: number, data: Partial<{ current: number; target: number }>) => api.put<any>(`/metas/item/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/metas/${id}`),
};

export const templateApi = {
  list: () => api.get<Template[]>("/templates"),
  create: (data: Partial<Template>) => api.post<Template>("/templates", data),
  del: (id: number) => api.del<{ ok: boolean }>(`/templates/${id}`),
};

export const budgetApi = {
  list: () => api.get<BudgetItem[]>("/budget"),
  create: (data: Partial<BudgetItem>) => api.post<BudgetItem>("/budget", data),
  update: (id: number, data: Partial<BudgetItem>) => api.put<BudgetItem>(`/budget/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/budget/${id}`),
};

export const notifApi = {
  list: () => api.get<Notification[]>("/notifications"),
  markRead: (id: number) => api.put<{ ok: boolean }>(`/notifications/${id}/read`),
  markAllRead: () => api.put<{ ok: boolean }>("/notifications/read-all"),
  clearRead: () => api.del<{ ok: boolean }>("/notifications/clear"),
};

export const checklistApi = {
  listByVideo: (videoId: number) => api.get<ChecklistItem[]>(`/checklists/video/${videoId}`),
  create: (data: Partial<ChecklistItem & { videoId: number }>) => api.post<ChecklistItem>("/checklists", data),
  update: (id: number, data: Partial<ChecklistItem>) => api.put<ChecklistItem>(`/checklists/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/checklists/${id}`),
};

export const settingsApi = {
  get: () => api.get<Record<string, string>>("/settings"),
  getRaw: (key: string) => api.get<{ key: string; value: string }>(`/settings/raw/${key}`),
  save: (data: Record<string, string>) => api.put<{ ok: boolean }>("/settings", data),
};

export const aiApi = {
  seo: (data: { title: string; topic?: string; channelName?: string }) => api.post<any>("/ai/seo", data),
  script: (data: any) => api.post<{ script: string }>("/ai/script", data),
  storyboard: (data: any) => api.post<{ scenes: any[] }>("/ai/storyboard", data),
  titles: (data: { topic: string; channelName?: string }) => api.post<{ titles: string[] }>("/ai/titles", data),
  analyzeIdea: (data: any) => api.post<any>("/ai/analyze-idea", data),
};

export const youtubeApi = {
  channel: (channelId: string) => api.get<any>(`/youtube/channel/${channelId}`),
  videos: (channelId: string, max = 10) => api.get<any[]>(`/youtube/videos/${channelId}?max=${max}`),
  analyze: (data: any) => api.post<any>("/youtube/analyze", data),
};

export const scriptApi = {
  listByVideo: (videoId: number) => api.get<Script[]>(`/scripts/video/${videoId}`),
  create: (data: { content?: string; videoId: number; label?: string }) => api.post<Script>("/scripts", data),
  update: (id: number, data: Partial<Script>) => api.put<Script>(`/scripts/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/scripts/${id}`),
};

export const seoResultApi = {
  listByVideo: (videoId: number) => api.get<any[]>(`/seo-results/video/${videoId}`),
  create: (data: any) => api.post<any>("/seo-results", data),
  del: (id: number) => api.del<{ ok: boolean }>(`/seo-results/${id}`),
};

export const ideaApi = {
  list: () => api.get<Idea[]>("/ideas"),
  create: (data: Partial<Idea>) => api.post<Idea>("/ideas", data),
  update: (id: number, data: Partial<Idea>) => api.put<Idea>(`/ideas/${id}`, data),
  del: (id: number) => api.del<{ ok: boolean }>(`/ideas/${id}`),
};

export const searchApi = {
  search: (q: string) => api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
};

export const exportApi = {
  videoCsv: () => `${BASE}/export/videos-csv`,
  budgetCsv: () => `${BASE}/export/budget-csv`,
  scriptTxt: (id: number) => `${BASE}/export/script/${id}`,
};

export default api;
