// @ts-nocheck
import { useState, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { videoApi } from "../lib/api";
import { Card, Badge, Btn, Hdr, Label, Input, Select, C, ST, STATUS_KEYS } from "../components/shared/UI";

function EditModal({ video, channels, onClose, onSave }) {
  const [form, setForm] = useState({
    title: video.title, channelId: video.channelId || video.channel?.id,
    date: video.date, priority: video.priority, duration: video.duration, status: video.status,
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(video.id, form); onClose(); } catch {} finally { setSaving(false); }
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: "95vw", background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Editar Vídeo</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><Label t="Título" /><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label t="Canal" /><Select value={form.channelId} onChange={e => setForm(p => ({ ...p, channelId: Number(e.target.value) }))}>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <div><Label t="Status" /><Select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><Label t="Data" /><Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div><Label t="Prioridade" /><Select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}><option value="alta">Alta</option><option value="média">Média</option><option value="baixa">Baixa</option></Select></div>
            <div><Label t="Duração" /><Input value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))} /></div>
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

export default function Planner() {
  const { channels, videos, refreshVideos, selChannel, setSelChannel } = useApp();
  const confirmDel = useConfirm();
  const [showF, setShowF] = useState(false);
  const [editVideo, setEditVideo] = useState(null);
  const [nv, setNv] = useState({ title: "", channelId: "", date: "", priority: "média", duration: "" });
  const [fs, setFs] = useState("all");
  const dragItem = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const filtered = videos.filter(v => {
    const chId = v.channelId || v.channel?.id;
    return (selChannel ? chId === selChannel : true) && (fs === "all" || v.status === fs);
  });

  const addVideo = async () => {
    if (!nv.title.trim() || !nv.channelId) return;
    try { await videoApi.create(nv); refreshVideos(); setNv({ title: "", channelId: "", date: "", priority: "média", duration: "" }); setShowF(false); } catch (err) { alert(err.message); }
  };

  const moveStatus = async (id, dir) => {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    const idx = STATUS_KEYS.indexOf(v.status) + dir;
    if (idx < 0 || idx >= STATUS_KEYS.length) return;
    try { await videoApi.update(id, { status: STATUS_KEYS[idx] }); refreshVideos(); } catch {}
  };

  const saveEdit = async (id, data) => {
    await videoApi.update(id, data);
    refreshVideos();
  };

  const delVideo = async (id) => {
    const ok = await confirmDel({ title: "Remover Vídeo", message: "Tem certeza que deseja remover este vídeo? Esta ação não pode ser desfeita." });
    if (!ok) return;
    try { await videoApi.del(id); refreshVideos(); } catch {}
  };

  // Drag & Drop
  const onDragStart = (e, videoId) => {
    dragItem.current = videoId;
    e.dataTransfer.effectAllowed = "move";
    e.target.style.opacity = "0.4";
  };

  const onDragEnd = (e) => {
    e.target.style.opacity = "1";
    dragItem.current = null;
    setDragOver(null);
  };

  const onDragOverCol = (e, statusKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(statusKey);
  };

  const onDragLeaveCol = () => {
    setDragOver(null);
  };

  const onDropCol = async (e, statusKey) => {
    e.preventDefault();
    setDragOver(null);
    const videoId = dragItem.current;
    if (!videoId) return;
    const v = videos.find(x => x.id === videoId);
    if (!v || v.status === statusKey) return;
    try {
      await videoApi.update(videoId, { status: statusKey });
      refreshVideos();
    } catch {}
  };

  return (
    <div className="page-enter">
      {editVideo && <EditModal video={editVideo} channels={channels} onClose={() => setEditVideo(null)} onSave={saveEdit} />}

      <Hdr title="Planner Kanban" sub="Arraste os cards entre colunas para mudar o status"
        action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Novo Vídeo"}</Btn>} />

      {/* Filters */}
      <div className="filters-row" style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <Btn vr={!selChannel ? "primary" : "ghost"} onClick={() => setSelChannel(null)} style={{ padding: "7px 14px", fontSize: 12 }}>Todos</Btn>
        {channels.map(ch => (
          <Btn key={ch.id} vr={selChannel === ch.id ? "primary" : "ghost"} onClick={() => setSelChannel(ch.id)}
            style={{ padding: "7px 14px", fontSize: 12, ...(selChannel === ch.id ? { background: ch.color } : {}) }}>
            <Badge color={ch.color} /> {ch.name}
          </Btn>
        ))}
        <div style={{ flex: 1 }} />
        <Select style={{ width: 140 }} value={fs} onChange={e => setFs(e.target.value)}>
          <option value="all">Todos status</option>
          {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </Select>
      </div>

      {/* Add Form */}
      {showF && (
        <Card style={{ marginBottom: 18, borderColor: `${C.red}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Novo Vídeo</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
            <div><Label t="Título" /><Input placeholder="Nome..." value={nv.title} onChange={e => setNv(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label t="Canal" /><Select value={nv.channelId} onChange={e => setNv(p => ({ ...p, channelId: Number(e.target.value) }))}><option value="">Selecione</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <div><Label t="Data" /><Input type="date" value={nv.date} onChange={e => setNv(p => ({ ...p, date: e.target.value }))} /></div>
            <div><Label t="Prioridade" /><Select value={nv.priority} onChange={e => setNv(p => ({ ...p, priority: e.target.value }))}><option value="alta">Alta</option><option value="média">Média</option><option value="baixa">Baixa</option></Select></div>
            <div><Label t="Duração" /><Input placeholder="12:00" value={nv.duration} onChange={e => setNv(p => ({ ...p, duration: e.target.value }))} /></div>
            <Btn onClick={addVideo} style={{ height: 38 }}>Criar</Btn>
          </div>
        </Card>
      )}

      {/* Kanban Board */}
      <div className="grid-kanban" style={{ display: "grid", gridTemplateColumns: `repeat(${STATUS_KEYS.length}, minmax(155px, 1fr))`, gap: 10, overflowX: "auto" }}>
        {Object.entries(ST).map(([sk, sv]) => {
          const col = filtered.filter(v => v.status === sk);
          const isOver = dragOver === sk;
          return (
            <div key={sk}
              onDragOver={e => onDragOverCol(e, sk)}
              onDragLeave={onDragLeaveCol}
              onDrop={e => onDropCol(e, sk)}
              style={{
                background: isOver ? `${sv.c}08` : "rgba(255,255,255,0.015)",
                borderRadius: 12, padding: 10,
                border: `2px ${isOver ? "dashed" : "solid"} ${isOver ? sv.c + "50" : C.border}`,
                minHeight: 260, transition: "all 0.2s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, padding: "0 4px" }}>
                <span style={{ fontSize: 12 }}>{sv.i}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: sv.c }}>{sv.l}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim, marginLeft: "auto" }}>{col.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 40 }}>
                {col.map(v => {
                  const vch = v.channel || channels.find(c => c.id === v.channelId);
                  return (
                    <div key={v.id}
                      draggable
                      onDragStart={e => onDragStart(e, v.id)}
                      onDragEnd={onDragEnd}
                      style={{
                        background: C.bgCard, borderRadius: 10, padding: 12,
                        borderLeft: `3px solid ${vch?.color || C.dim}`,
                        border: `1px solid ${C.border}`, borderLeftWidth: 3,
                        borderLeftColor: vch?.color || C.dim,
                        cursor: "grab", transition: "transform 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                      <div onClick={() => setEditVideo(v)} style={{ cursor: "pointer" }}>
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, lineHeight: 1.3 }}>{v.title}</div>
                        <div style={{ fontSize: 10, color: vch?.color, marginBottom: 4 }}>{vch?.name}</div>
                        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                          {v.priority && <Badge text={v.priority} color={v.priority === "alta" ? C.red : v.priority === "média" ? C.orange : C.blue} v="tag" />}
                          {v.duration && <Badge text={v.duration} color={C.dim} v="tag" />}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{v.date}</span>
                        <div style={{ display: "flex", gap: 3 }}>
                          <Btn vr="subtle" onClick={() => moveStatus(v.id, -1)} style={{ fontSize: 9, padding: "3px 6px" }}>◀</Btn>
                          <Btn vr="subtle" onClick={() => moveStatus(v.id, 1)} style={{ fontSize: 9, padding: "3px 6px" }}>▶</Btn>
                          <Btn vr="subtle" onClick={() => setEditVideo(v)} style={{ fontSize: 9, padding: "3px 6px" }}>✎</Btn>
                          <Btn vr="subtle" onClick={() => delVideo(v.id)} style={{ fontSize: 9, padding: "3px 6px", color: C.red }}>✕</Btn>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {col.length === 0 && isOver && (
                  <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: sv.c, opacity: 0.6, border: `1px dashed ${sv.c}30`, borderRadius: 8 }}>
                    Soltar aqui
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
