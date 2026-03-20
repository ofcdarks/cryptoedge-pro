export interface User {
  id: number;
  name: string;
  email: string;
  avatar: string;
  role?: string;
}

export interface Channel {
  id: number;
  name: string;
  color: string;
  icon: string;
  subs: string;
  videoCount: number;
  views: string;
  growth: string;
  _count?: { videos: number };
}

export interface Video {
  id: number;
  title: string;
  status: string;
  date: string;
  priority: string;
  duration: string;
  channelId: number;
  channel?: { id: number; name: string; color: string; icon?: string };
  scenes?: Scene[];
  checklists?: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Scene {
  id: number;
  type: string;
  title: string;
  duration: string;
  notes: string;
  camera: string;
  audio: string;
  color: string;
  order: number;
  videoId: number;
}

export interface ChecklistItem {
  id: number;
  label: string;
  done: boolean;
  videoId: number;
}

export interface Notification {
  id: number;
  type: string;
  message: string;
  read: boolean;
  link: string;
  createdAt: string;
}

export interface Idea {
  id: number;
  title: string;
  content: string;
  imageUrl: string;
  tags: string;
  color: string;
  pinned: boolean;
  channelId?: number;
  channel?: { id: number; name: string; color: string };
  createdAt: string;
}

export interface Asset {
  id: number;
  name: string;
  type: string;
  format: string;
  size: string;
  tags: string;
  fileUrl: string;
  notes: string;
  channelId?: number;
  channel?: { id: number; name: string; color: string };
  createdAt: string;
}

export interface Meta {
  id: number;
  title: string;
  channelId?: number;
  channel?: { id: number; name: string; color: string };
  items: MetaItem[];
}

export interface MetaItem {
  id: number;
  label: string;
  current: number;
  target: number;
  unit: string;
}

export interface BudgetItem {
  id: number;
  category: string;
  desc: string;
  value: number;
  type: string;
  month: string;
  recurring: boolean;
  notes: string;
}

export interface Template {
  id: number;
  name: string;
  desc: string;
  episodes: number;
  structure: string;
  color: string;
  tags: string;
  channelId?: number;
  channel?: { id: number; name: string; color: string };
}

export interface Script {
  id: number;
  content: string;
  version: number;
  label: string;
  videoId: number;
  video?: { id: number; title: string };
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: number;
  name: string;
  role: string;
  email: string;
  avatar: string;
  status: string;
  tasks: number;
  channels?: Channel[];
}

export interface SearchResults {
  videos: Video[];
  ideas: Idea[];
  assets: Asset[];
  scripts: Script[];
}

export type StatusKey = "idea" | "script" | "filming" | "editing" | "review" | "scheduled" | "published";
