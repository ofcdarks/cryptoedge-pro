// @ts-nocheck
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { sceneApi, aiApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, C, ST } from "../components/shared/UI";

const TYPE_META = {
  hook: { l: "Hook", c: "#EF4444", i: "🎯" }, intro: { l: "Intro", c: "#A855F7", i: "🎬" },
  problem: { l: "Problema", c: "#F59E0B", i: "⚡" }, content: { l: "Conteúdo", c: "#3B82F6", i: "📹" },
  demo: { l: "Demo", c: "#06B6D4", i: "🖥️" }, broll: { l: "B-Roll", c: "#14B8A6", i: "🎞️" },
  reveal: { l: "Revelação", c: "#EC4899", i: "💎" }, transition: { l: "Transição", c: "#8B5CF6", i: "✨" },
  cta: { l: "CTA", c: "#F59E0B", i: "👆" }, outro: { l: "Outro", c: "#22C55E", i: "🔚" },
};

function EditModal({ scene, onClose, onSave }) {
  const [f, setF] = useState({ ...scene });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(scene.id, f); onClose(); } catch {} finally { setSaving(false); } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Editar Cena</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12 }}>
            <div><Label t="Tipo" /><Select value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>{Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
            <div><Label t="Título" /><Input value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label t="Duração" /><Input placeholder="0:00-0:30" value={f.duration} onChange={e => setF(p => ({ ...p, duration: e.target.value }))} /></div>
          </div>
          <div><Label t="Notas / Descrição da Cena" /><textarea value={f.notes || ""} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} style={{ width: "100%", minHeight: 80, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "var(--font)" }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label t="Câmera" /><Input value={f.camera || ""} onChange={e => setF(p => ({ ...p, camera: e.target.value }))} /></div>
            <div><Label t="Áudio" /><Input value={f.audio || ""} onChange={e => setF(p => ({ ...p, audio: e.target.value }))} /></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <Btn vr="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function Storyboard() {
  const { videos, channels } = useApp();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [selV, setSelV] = useState(videos[0]?.id || null);
  const [scenes, setScenes] = useState([]);
  const [editScene, setEditScene] = useState(null);
  const [showA, setShowA] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [ns, setNs] = useState({ type: "content", title: "", duration: "", notes: "", camera: "", audio: "" });

  useEffect(() => {
    if (!selV) return;
    sceneApi.listByVideo(selV).then(setScenes).catch(() => setScenes([]));
  }, [selV]);

  const vid = videos.find(v => v.id === selV);
  const ch = vid?.channel || channels.find(c => c.id === vid?.channelId);

  const addScene = async () => {
    if (!ns.title.trim()) return;
    const tm = TYPE_META[ns.type] || TYPE_META.content;
    try {
      const scene = await sceneApi.create({ ...ns, videoId: selV, color: tm.c });
      setScenes(p => [...p, scene]);
      setNs({ type: "content", title: "", duration: "", notes: "", camera: "", audio: "" });
      setShowA(false);
    } catch (err) { alert(err.message); }
  };

  const saveEdit = async (id, data) => {
    const tm = TYPE_META[data.type] || TYPE_META.content;
    await sceneApi.update(id, { ...data, color: tm.c });
    setScenes(p => p.map(s => s.id === id ? { ...s, ...data, color: tm.c } : s));
  };

  const delScene = async (id) => {
    const ok = await confirm({ title: "Remover Cena", message: "Esta cena será removida do storyboard." });
    if (!ok) return;
    try { await sceneApi.del(id); setScenes(p => p.filter(s => s.id !== id)); } catch {}
  };

  const generateWithAI = async () => {
    setAiLoading(true); setError("");
    try {
      const data = await aiApi.storyboard({ title: vid?.title || "Vídeo", duration: vid?.duration || "12:00", style: "viral com alta retenção" });
      if (data.error) { setError(data.error); return; }
      const newScenes = [];
      for (const s of (data.scenes || [])) {
        const saved = await sceneApi.create({ videoId: selV, type: s.type || "content", title: s.title, duration: s.duration || "", notes: s.notes || "", camera: s.camera || "", audio: s.audio || "", color: s.color || C.blue });
        newScenes.push(saved);
      }
      setScenes(prev => [...prev, ...newScenes]);
    } catch (err) { setError(err.message); }
    finally { setAiLoading(false); }
  };

  // Parse duration to get relative widths
  const parseDuration = (dur) => {
    if (!dur) return { start: 0, end: 0 };
    const parts = dur.split("-").map(t => {
      const p = t.trim().split(":").map(Number);
      return p.length === 2 ? p[0] * 60 + p[1] : p[0];
    });
    return { start: parts[0] || 0, end: parts[1] || parts[0] || 0 };
  };

  const totalDur = scenes.length > 0 ? Math.max(...scenes.map(s => parseDuration(s.duration).end), 1) : 720;

  return (
    <div className="page-enter">
      {editScene && <EditModal scene={editScene} onClose={() => setEditScene(null)} onSave={saveEdit} />}

      <Hdr title="Storyboard" sub="Timeline visual + geração com IA viral" action={
        <div style={{ display: "flex", gap: 8 }}>
          <Select style={{ width: 200 }} value={selV || ""} onChange={e => setSelV(Number(e.target.value))}>
            {videos.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </Select>
          <Btn vr="ghost" onClick={generateWithAI} disabled={aiLoading}>{aiLoading ? "⏳ Gerando..." : "✦ Gerar com IA"}</Btn>
          <Btn onClick={() => setShowA(!showA)}>{showA ? "✕" : "+ Cena"}</Btn>
        </div>
      } />

      {error && (
        <Card style={{ marginBottom: 12, borderColor: `${C.red}30`, padding: 14 }} color={C.red}>
          <div style={{ fontSize: 12, color: C.red }}>{error}</div>
          {error.includes("Configurações") && <Btn vr="ghost" onClick={() => nav("/settings")} style={{ marginTop: 8, fontSize: 11 }}>Configurações →</Btn>}
        </Card>
      )}

      {/* Video Info */}
      {vid && (
        <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16, padding: 16 }} color={ch?.color}>
          <Badge color={ch?.color} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{vid.title}</div><div style={{ fontSize: 12, color: ch?.color }}>{ch?.name}</div></div>
          <Badge text={ST[vid.status]?.l} color={ST[vid.status]?.c} v="tag" />
          <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600 }}>{scenes.length} cenas</div>
        </Card>
      )}

      {/* Add Scene */}
      {showA && (
        <Card style={{ marginBottom: 16, borderColor: `${C.green}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Nova Cena</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
            <div><Label t="Tipo" /><Select value={ns.type} onChange={e => setNs(p => ({ ...p, type: e.target.value }))}>{Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
            <div><Label t="Título" /><Input value={ns.title} onChange={e => setNs(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label t="Duração" /><Input placeholder="0:00-0:30" value={ns.duration} onChange={e => setNs(p => ({ ...p, duration: e.target.value }))} /></div>
            <div><Label t="Câmera" /><Input value={ns.camera} onChange={e => setNs(p => ({ ...p, camera: e.target.value }))} /></div>
            <div><Label t="Áudio" /><Input value={ns.audio} onChange={e => setNs(p => ({ ...p, audio: e.target.value }))} /></div>
            <Btn onClick={addScene} style={{ height: 38 }}>Criar</Btn>
          </div>
          <div style={{ marginTop: 10 }}><Label t="Notas" /><Input value={ns.notes} onChange={e => setNs(p => ({ ...p, notes: e.target.value }))} /></div>
        </Card>
      )}

      {/* ═══ VISUAL TIMELINE ═══ */}
      {scenes.length > 0 && (
        <Card style={{ marginBottom: 20, overflow: "hidden" }}>
          <SecTitle t="Timeline Visual" />

          {/* Time ruler */}
          <div style={{ display: "flex", marginBottom: 4, paddingLeft: 80 }}>
            {Array.from({ length: Math.ceil(totalDur / 60) + 1 }, (_, i) => (
              <div key={i} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 9, color: C.dim, minWidth: 40 }}>{i}:00</div>
            ))}
          </div>

          {/* Scenes Track */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div style={{ width: 80, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", flexShrink: 0 }}>Cenas</div>
              <div style={{ flex: 1, display: "flex", gap: 2, height: 40, background: "rgba(255,255,255,0.02)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
                {scenes.map((sc, i) => {
                  const d = parseDuration(sc.duration);
                  const tm = TYPE_META[sc.type] || TYPE_META.content;
                  const left = (d.start / totalDur) * 100;
                  const width = Math.max(((d.end - d.start) / totalDur) * 100, 3);
                  return (
                    <div key={sc.id} onClick={() => setEditScene(sc)}
                      style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%", background: `${tm.c}25`, borderLeft: `3px solid ${tm.c}`, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", padding: "0 6px", overflow: "hidden", transition: "all 0.2s", minWidth: 30 }}
                      onMouseEnter={e => e.currentTarget.style.background = `${tm.c}40`}
                      onMouseLeave={e => e.currentTarget.style.background = `${tm.c}25`}
                      title={`${sc.title} (${sc.duration})`}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: tm.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tm.i} {sc.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Camera Track */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div style={{ width: 80, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", flexShrink: 0 }}>📷 Câmera</div>
              <div style={{ flex: 1, display: "flex", gap: 2, height: 24, background: "rgba(255,255,255,0.02)", borderRadius: 4, position: "relative" }}>
                {scenes.filter(s => s.camera).map(sc => {
                  const d = parseDuration(sc.duration);
                  const left = (d.start / totalDur) * 100;
                  const width = Math.max(((d.end - d.start) / totalDur) * 100, 3);
                  return (
                    <div key={sc.id} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%", background: `${C.blue}15`, borderLeft: `2px solid ${C.blue}40`, borderRadius: 3, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
                      <span style={{ fontSize: 9, color: C.blue, whiteSpace: "nowrap" }}>{sc.camera}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audio Track */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 80, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", flexShrink: 0 }}>🎵 Áudio</div>
              <div style={{ flex: 1, display: "flex", gap: 2, height: 24, background: "rgba(255,255,255,0.02)", borderRadius: 4, position: "relative" }}>
                {scenes.filter(s => s.audio).map(sc => {
                  const d = parseDuration(sc.duration);
                  const left = (d.start / totalDur) * 100;
                  const width = Math.max(((d.end - d.start) / totalDur) * 100, 3);
                  return (
                    <div key={sc.id} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%", background: `${C.green}15`, borderLeft: `2px solid ${C.green}40`, borderRadius: 3, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
                      <span style={{ fontSize: 9, color: C.green, whiteSpace: "nowrap" }}>{sc.audio}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            {Object.entries(TYPE_META).map(([k, v]) => {
              const count = scenes.filter(s => s.type === k).length;
              if (!count) return null;
              return <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.muted }}><div style={{ width: 10, height: 10, borderRadius: 3, background: v.c }} />{v.i} {v.l} ({count})</div>;
            })}
          </div>
        </Card>
      )}

      {/* Scene Cards */}
      {scenes.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {scenes.map((sc, i) => {
            const tm = TYPE_META[sc.type] || TYPE_META.content;
            return (
              <Card key={sc.id} hov color={tm.c} onClick={() => setEditScene(sc)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: tm.c, background: `${tm.c}12`, border: `1px solid ${tm.c}25`, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{sc.title}</div>
                    <div style={{ fontSize: 10, color: tm.c, textTransform: "uppercase", fontWeight: 600 }}>{tm.i} {tm.l}</div>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted, background: "rgba(255,255,255,0.04)", padding: "4px 10px", borderRadius: 6 }}>{sc.duration}</span>
                </div>
                {sc.notes && <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: "0 0 10px" }}>{sc.notes}</p>}
                {sc.retention && <div style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, background: `${C.pink}10`, color: C.pink, marginBottom: 10, fontWeight: 600 }}>🧠 {sc.retention}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {sc.camera && <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: `${C.blue}10`, color: C.blue }}>📷 {sc.camera}</span>}
                  {sc.audio && <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: `${C.green}10`, color: C.green }}>🎵 {sc.audio}</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }} onClick={e => e.stopPropagation()}>
                  <Btn vr="subtle" onClick={() => setEditScene(sc)} style={{ fontSize: 10 }}>✎</Btn>
                  <Btn vr="subtle" onClick={() => delScene(sc.id)} style={{ fontSize: 10, color: C.red }}>✕</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nenhuma cena ainda</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Gere um storyboard viral com IA ou adicione cenas manualmente</div>
          <Btn onClick={generateWithAI} disabled={aiLoading}>{aiLoading ? "⏳ Gerando..." : "✦ Gerar Storyboard Viral com IA"}</Btn>
        </Card>
      )}
    </div>
  );
}
