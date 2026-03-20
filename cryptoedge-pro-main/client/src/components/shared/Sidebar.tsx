import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useApp } from "../../context/AppContext";
import { channelApi } from "../../lib/api";
import { useToast } from "./Toast";
import { Badge, C } from "./UI";
import type { Channel } from "../../types";

function SItem({ icon, label, path, badge, bc, onClick: extraClick }: { icon: string; label: string; path: string; badge?: number | string | null; bc?: string; onClick?: () => void }) {
  const [h, setH] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const active = loc.pathname === path;
  return (
    <div onClick={() => { nav(path); extraClick?.(); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: active ? 600 : 450, color: active ? C.red : h ? C.text : C.muted, background: active ? `${C.red}15` : h ? C.bgHover : "transparent", transition: "all 0.2s", userSelect: "none" }}>
      <span style={{ fontSize: 14, width: 18, textAlign: "center", opacity: active ? 1 : 0.6 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && <Badge text={String(badge)} color={bc || C.red} v="count" />}
    </div>
  );
}

function Sec({ title }: { title: string }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 14px 6px" }}>{title}</div>;
}

function ChDot({ ch, active, onClick }: { ch: { name: string; color: string; _count?: { videos: number }; videoCount?: number }; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: active ? 700 : 450, color: active ? C.text : C.muted, background: active ? "rgba(255,255,255,0.06)" : h ? C.bgHover : "transparent", transition: "all 0.2s" }}>
      <Badge color={ch.color} />
      <span style={{ flex: 1 }}>{ch.name}</span>
      {(ch._count?.videos || ch.videoCount || 0) > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.dim }}>{ch._count?.videos || ch.videoCount}</span>}
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { channels, videos, selChannel, setSelChannel, refreshChannels } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const pending = videos.filter(v => v.status !== "published").length;
  const closeMobile = () => { if (onClose) onClose(); };

  const addChannel = async () => {
    const name = prompt("Nome do novo canal:");
    if (!name) return;
    const colors = [C.red, C.purple, C.green, C.blue, C.orange, C.pink];
    try {
      await channelApi.create({ name, color: colors[Math.floor(Math.random() * colors.length)] });
      refreshChannels();
      toast?.success(`Canal "${name}" criado!`);
    } catch (err: any) { toast?.error(err.message); }
  };

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? "show" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? "open" : ""}`}
        style={{ width: 220, minWidth: 220, background: C.bgSidebar, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, overflowY: "auto", zIndex: 100, transition: "transform 0.2s ease" }}>
        <div style={{ padding: "20px 16px 8px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.red}, ${C.orange})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "#fff", flexShrink: 0 }}>LC</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>LaCasaStudio</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: C.dim }}>V2.3 · YOUTUBE OS</div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "4px 8px" }}>
          <Sec title="Produção" />
          <SItem icon="▣" label="Dashboard" path="/" onClick={closeMobile} />
          <SItem icon="▦" label="Planner Kanban" path="/planner" badge={pending} onClick={closeMobile} />
          <SItem icon="▤" label="Storyboard" path="/storyboard" onClick={closeMobile} />
          <SItem icon="¶" label="Editor de Roteiro" path="/editor" onClick={closeMobile} />
          <SItem icon="✓" label="Checklist Pub." path="/checklist" onClick={closeMobile} />
          <Sec title="Estratégia" />
          <SItem icon="💡" label="Banco de Ideias" path="/ideas" onClick={closeMobile} />
          <SItem icon="✦" label="Gerador SEO + IA" path="/seo" onClick={closeMobile} />
          <SItem icon="◎" label="Metas & OKRs" path="/metas" onClick={closeMobile} />
          <SItem icon="◆" label="Templates de Série" path="/templates" onClick={closeMobile} />
          <Sec title="Gestão" />
          <SItem icon="▥" label="Calendário" path="/calendario" onClick={closeMobile} />
          <SItem icon="▲" label="Analytics" path="/analytics" onClick={closeMobile} />
          <SItem icon="$" label="Orçamento" path="/orcamento" onClick={closeMobile} />
          <SItem icon="◉" label="Banco de Ativos" path="/ativos" onClick={closeMobile} />
          <SItem icon="◑" label="Equipe" path="/equipe" onClick={closeMobile} />
          <SItem icon="⚙" label="Configurações" path="/settings" onClick={closeMobile} />
          <Sec title="Canais" />
          {channels.map((ch: any) => (
            <ChDot key={ch.id} ch={ch} active={selChannel === ch.id && loc.pathname === "/planner"}
              onClick={() => { setSelChannel(selChannel === ch.id ? null : ch.id); nav("/planner"); closeMobile(); }} />
          ))}
          <ChDot ch={{ name: "Todos os canais", color: C.dim }} active={!selChannel && loc.pathname === "/planner"}
            onClick={() => { setSelChannel(null); nav("/planner"); closeMobile(); }} />
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
          <div onClick={addChannel} style={{ fontSize: 12, color: C.muted, cursor: "pointer", padding: "6px 0" }}>+ Novo canal</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim, marginTop: 6 }}>© LaCasaStudio V2.3</div>
        </div>
      </aside>
    </>
  );
}
