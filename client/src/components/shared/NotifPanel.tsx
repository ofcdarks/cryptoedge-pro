import { useApp } from "../../context/AppContext";
import { notifApi } from "../../lib/api";
import { C, Btn } from "./UI";

const TYPE_ICONS: Record<string, string> = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

export default function NotifPanel({ onClose }: { onClose: () => void }) {
  const { notifs, refreshNotifs } = useApp();
  const markRead = async (id: number) => { try { await notifApi.markRead(id); refreshNotifs(); } catch {} };
  const markAllRead = async () => { try { await notifApi.markAllRead(); refreshNotifs(); } catch {} };
  const clearRead = async () => { try { await notifApi.clearRead(); refreshNotifs(); } catch {} };
  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };
  return (
    <div style={{ position: "absolute", top: 44, right: 0, width: 360, maxHeight: 480, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", zIndex: 999, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Notificações</span>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn vr="subtle" onClick={markAllRead} style={{ fontSize: 10 }}>Ler todas</Btn>
          <Btn vr="subtle" onClick={clearRead} style={{ fontSize: 10 }}>Limpar</Btn>
        </div>
      </div>
      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {notifs.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: C.dim, fontSize: 13 }}><div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>Nenhuma notificação</div>
        ) : notifs.map((n: any) => (
          <div key={n.id} onClick={() => !n.read && markRead(n.id)}
            style={{ display: "flex", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: n.read ? "transparent" : "rgba(239,68,68,0.03)" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[n.type] || "ℹ️"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.4, color: n.read ? C.muted : C.text }}>{n.message}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{timeAgo(n.createdAt)}</div>
            </div>
            {!n.read && <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0, marginTop: 4 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
