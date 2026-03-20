import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { channelApi, videoApi, notifApi } from "../lib/api";
import type { Channel, Video, Notification } from "../types";

interface AppContextType {
  channels: Channel[];
  videos: Video[];
  notifs: Notification[];
  selChannel: number | null;
  loading: boolean;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
  setNotifs: React.Dispatch<React.SetStateAction<Notification[]>>;
  setSelChannel: React.Dispatch<React.SetStateAction<number | null>>;
  refreshChannels: () => Promise<void>;
  refreshVideos: () => Promise<void>;
  refreshNotifs: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [selChannel, setSelChannel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [ch, vd, nf] = await Promise.all([channelApi.list(), videoApi.list(), notifApi.list()]);
      setChannels(ch);
      setVideos(vd);
      setNotifs(nf);
    } catch (err) { console.error("Fetch error:", err); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshChannels = useCallback(async () => { try { setChannels(await channelApi.list()); } catch {} }, []);
  const refreshVideos = useCallback(async () => { try { setVideos(await videoApi.list()); } catch {} }, []);
  const refreshNotifs = useCallback(async () => { try { setNotifs(await notifApi.list()); } catch {} }, []);

  return (
    <AppContext.Provider value={{
      channels, videos, notifs, selChannel, loading,
      setChannels, setVideos, setNotifs, setSelChannel,
      refreshChannels, refreshVideos, refreshNotifs, fetchAll,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = (): AppContextType => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};
