import { Request } from "express";

export interface AuthRequest extends Request {
  userId: number;
  validated?: any;
  validatedQuery?: any;
}

export interface VideoData {
  title: string;
  channelId: number;
  status?: string;
  date?: string;
  priority?: "alta" | "média" | "baixa";
  duration?: string;
}

export interface ChannelData {
  name: string;
  color?: string;
  icon?: string;
  subs?: string;
}

export interface IdeaData {
  title: string;
  content?: string;
  imageUrl?: string;
  tags?: string;
  color?: string;
  pinned?: boolean;
  channelId?: number | null;
}

export interface BudgetData {
  category: string;
  desc: string;
  value: number;
  type?: "expense" | "income";
  month?: string;
  recurring?: boolean;
  notes?: string;
}

export interface MetaData {
  title: string;
  channelId?: number | null;
  items?: { label: string; current?: number; target?: number; unit?: string }[];
}

export interface AICallParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface NotificationType {
  id: number;
  type: string;
  message: string;
  read: boolean;
  link: string;
  userId: number;
  createdAt: Date;
}
