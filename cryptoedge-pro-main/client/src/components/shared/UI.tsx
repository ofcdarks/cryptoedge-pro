import { useState, ReactNode, CSSProperties } from "react";

export const C = {
  bg: "#0B0C14", bgCard: "#111219", bgSidebar: "#0E0F17", bgHover: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.06)", borderH: "rgba(255,255,255,0.12)",
  text: "#E2E0EC", muted: "rgba(255,255,255,0.42)", dim: "rgba(255,255,255,0.22)",
  red: "#EF4444", green: "#22C55E", blue: "#3B82F6", purple: "#A855F7",
  orange: "#F59E0B", pink: "#EC4899", cyan: "#06B6D4", teal: "#14B8A6",
};

export const ST: Record<string, { l: string; c: string; i: string }> = {
  idea: { l: "Ideia", c: C.orange, i: "💡" },
  script: { l: "Roteiro", c: C.purple, i: "📝" },
  filming: { l: "Gravação", c: C.cyan, i: "🎥" },
  editing: { l: "Edição", c: C.red, i: "✂️" },
  review: { l: "Revisão", c: C.teal, i: "🔍" },
  scheduled: { l: "Agendado", c: C.blue, i: "📅" },
  published: { l: "Publicado", c: C.green, i: "✅" },
};

export const STATUS_KEYS = Object.keys(ST);

interface PBarProps { current: number; target: number; color: string; h?: number; }
export function PBar({ current, target, color, h = 6 }: PBarProps) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return (
    <div style={{ width: "100%", height: h, borderRadius: h, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: h, background: color, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)", boxShadow: `0 0 12px ${color}40` }} />
    </div>
  );
}

interface BadgeProps { text?: string; color?: string; v?: string; }
export function Badge({ text, color = C.red, v = "dot" }: BadgeProps) {
  if (v === "count") return <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "#fff", background: color, borderRadius: 10, padding: "2px 7px", lineHeight: "16px" }}>{text}</span>;
  if (v === "tag") return <span style={{ fontSize: 10, fontWeight: 600, color, background: `${color}18`, borderRadius: 6, padding: "3px 8px" }}>{text}</span>;
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
}

interface CardProps { children: ReactNode; style?: CSSProperties; color?: string; onClick?: () => void; hov?: boolean; }
export function Card({ children, style: s = {}, color, onClick, hov = false }: CardProps) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => hov && setH(true)}
      onMouseLeave={() => hov && setH(false)}
      style={{
        background: C.bgCard, borderRadius: 14, border: `1px solid ${C.border}`, padding: 22,
        position: "relative", overflow: "hidden", transition: "all 0.25s ease",
        ...(hov && h ? { borderColor: C.borderH, transform: "translateY(-1px)", boxShadow: "0 8px 30px rgba(0,0,0,0.3)" } : {}),
        ...(onClick ? { cursor: "pointer" } : {}), ...s,
      }}>
      {color && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.7 }} />}
      {children}
    </div>
  );
}

interface BtnProps { children: ReactNode; onClick?: () => void; vr?: string; style?: CSSProperties; disabled?: boolean; }
export function Btn({ children, onClick, vr = "primary", style: s = {}, disabled = false }: BtnProps) {
  const [h, setH] = useState(false);
  const base: CSSProperties = {
    border: "none", cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: 12.5, borderRadius: 8,
    display: "inline-flex", alignItems: "center", gap: 6,
    transition: "all 0.2s", padding: "9px 18px",
    opacity: disabled ? 0.5 : 1, ...s,
  };
  const vs: Record<string, CSSProperties> = {
    primary: { background: C.red, color: "#fff", boxShadow: h && !disabled ? `0 4px 20px ${C.red}40` : "none" },
    ghost: { background: "rgba(255,255,255,0.05)", color: C.muted, border: `1px solid ${C.border}` },
    subtle: { background: "transparent", color: C.muted, padding: "6px 10px" },
  };
  return (
    <button onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ ...base, ...(vs[vr] || vs.primary) }}>{children}</button>
  );
}

interface HdrProps { title: string; sub?: string; action?: ReactNode; }
export function Hdr({ title, sub, action }: HdrProps) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>{title}</h1>
        {sub && <p style={{ fontSize: 13, color: C.muted, margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Label({ t }: { t: string }) {
  return <div style={{ fontSize: 10, color: C.dim, marginBottom: 5, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>{t}</div>;
}

export function SecTitle({ t }: { t: string }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>{t}</div>;
}

export function Input(props: any) {
  return <input {...props} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none", width: "100%", ...props.style }} />;
}

export function Select({ children, ...props }: any) {
  return <select {...props} style={{ background: "#1a1b25", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none", width: "100%", appearance: "none" as const, cursor: "pointer", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23666' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 30, ...props.style }}>{children}</select>;
}

export function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.red, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function Empty({ icon = "📭", title = "Nada aqui ainda", sub = "" }) {
  return (
    <div style={{ textAlign: "center", padding: 48, color: C.dim }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  );
}
