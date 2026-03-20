import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useApp } from "../../context/AppContext";
import { C, Badge } from "./UI";
import NotifPanel from "./NotifPanel";
import SearchOverlay from "./SearchOverlay";

export default function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const { notifs } = useApp();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const unread = notifs.filter((n: any) => !n.read).length;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); }
      if (e.key === "Escape") { setShowSearch(false); setShowNotifs(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header style={{ height: 54, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 12, background: C.bg, position: "sticky", top: 0, zIndex: 50 }}>
        <button className="mobile-menu-btn" onClick={onMenuClick}
          style={{ display: "none", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.text, cursor: "pointer", fontSize: 18, flexShrink: 0 }}>☰</button>
        <div onClick={() => setShowSearch(true)}
          style={{ flex: 1, maxWidth: 400, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, cursor: "pointer", color: C.dim, fontSize: 13 }}>
          <span>⌘K</span><span>Buscar vídeos, ideias, roteiros...</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowNotifs(!showNotifs)} style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
            <span style={{ fontSize: 14 }}>🔔</span>
            {unread > 0 && <div style={{ position: "absolute", top: -4, right: -4 }}><Badge text={String(unread)} color={C.red} v="count" /></div>}
          </div>
          {showNotifs && <NotifPanel onClose={() => setShowNotifs(false)} />}
        </div>
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowUser(!showUser)} style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg, ${C.red}, ${C.orange})`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontWeight: 700, fontSize: 11, color: "#fff" }}>{user?.avatar || "?"}</div>
          {showUser && (
            <div style={{ position: "absolute", top: 44, right: 0, width: 200, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 8, zIndex: 999 }}>
              <div style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ padding: "4px 12px", fontSize: 11, color: C.muted, marginBottom: 8 }}>{user?.email}</div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                <div onClick={() => { logout(); setShowUser(false); }} style={{ padding: "8px 12px", fontSize: 12, color: C.red, cursor: "pointer", borderRadius: 6 }}>Sair da conta</div>
              </div>
            </div>
          )}
        </div>
      </header>
      {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
    </>
  );
}
