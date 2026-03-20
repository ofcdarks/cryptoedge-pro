// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { checklistApi } from "../lib/api";
import { Card, Btn, Hdr, SecTitle, PBar, Select, Input, C } from "../components/shared/UI";

export default function Checklist() {
  const { videos, channels } = useApp();
  const [selV, setSelV] = useState(videos[0]?.id);
  const [items, setItems] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const vid = videos.find(v => v.id === selV);
  const ch = vid?.channel || channels.find(c => c.id === vid?.channelId);

  useEffect(() => {
    if (!selV) return;
    checklistApi.listByVideo(selV).then(setItems).catch(() => setItems([]));
  }, [selV]);

  const toggle = async (item) => {
    try {
      await checklistApi.update(item.id, { done: !item.done });
      setItems(p => p.map(i => i.id === item.id ? { ...i, done: !i.done } : i));
    } catch {}
  };

  const addItem = async () => {
    if (!newLabel.trim() || !selV) return;
    try {
      const item = await checklistApi.create({ label: newLabel.trim(), videoId: selV });
      setItems(p => [...p, item]);
      setNewLabel("");
    } catch (err) { alert(err.message); }
  };

  const delItem = async (id) => {
    try {
      await checklistApi.del(id);
      setItems(p => p.filter(i => i.id !== id));
    } catch {}
  };

  const done = items.filter(i => i.done).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;

  // Default checklist template
  const addDefaults = async () => {
    const defaults = [
      "Thumbnail criada", "Título otimizado SEO", "Descrição completa",
      "Tags adicionadas", "End screen configurado", "Cards inseridos",
      "Legendas revisadas", "Comunidade avisada", "Agendamento definido",
    ];
    for (const label of defaults) {
      try {
        const item = await checklistApi.create({ label, videoId: selV });
        setItems(p => [...p, item]);
      } catch {}
    }
  };

  return (
    <div className="page-enter">
      <Hdr title="Checklist de Publicação" sub="Garanta que tudo está pronto antes de publicar" action={
        <Select style={{ width: 220 }} value={selV || ""} onChange={e => setSelV(Number(e.target.value))}>
          {videos.map(v => {
            const vc = v.channel || channels.find(c => c.id === v.channelId);
            return <option key={v.id} value={v.id}>{vc?.name?.slice(0, 8)} — {v.title}</option>;
          })}
        </Select>
      } />

      {/* Video Info */}
      {vid && (
        <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 14, padding: 16 }} color={ch?.color}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{vid.title}</div>
            <div style={{ fontSize: 12, color: ch?.color }}>{ch?.name} · {vid.date}</div>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: pct === 100 ? C.green : C.muted, fontWeight: 700 }}>
            {pct}% completo
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        {/* Checklist */}
        <Card>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Nenhum item no checklist</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Adicione itens ou use o template padrão</div>
              <Btn onClick={addDefaults}>Usar Template Padrão</Btn>
            </div>
          ) : (
            items.map((it, i) => (
              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div onClick={() => toggle(it)} style={{
                  width: 24, height: 24, borderRadius: 7, cursor: "pointer",
                  border: `2px solid ${it.done ? C.green : C.border}`,
                  background: it.done ? `${C.green}20` : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: C.green, transition: "all 0.2s", flexShrink: 0,
                }}>{it.done && "✓"}</div>
                <span style={{ flex: 1, fontSize: 14, color: it.done ? C.muted : C.text, textDecoration: it.done ? "line-through" : "none", transition: "all 0.2s", cursor: "pointer" }}
                  onClick={() => toggle(it)}>{it.label}</span>
                <Btn vr="subtle" onClick={() => delItem(it.id)} style={{ fontSize: 10, color: C.red, opacity: 0.5, padding: "4px 8px" }}>✕</Btn>
              </div>
            ))
          )}

          {/* Add new item */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <Input placeholder="Novo item do checklist..." value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              style={{ flex: 1 }} />
            <Btn onClick={addItem} style={{ flexShrink: 0 }}>+ Adicionar</Btn>
          </div>
        </Card>

        {/* Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <SecTitle t="Progresso" />
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 48, fontWeight: 700, color: pct === 100 ? C.green : C.text }}>
                {done}<span style={{ fontSize: 20, color: C.muted }}>/{items.length}</span>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>itens completos</div>
            </div>
            <PBar current={done} target={items.length || 1} color={pct === 100 ? C.green : C.blue} h={10} />
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: pct === 100 ? C.green : C.muted, textAlign: "center", marginTop: 10, fontWeight: 600 }}>
              {pct === 100 ? "✓ Pronto para publicar!" : `${pct}%`}
            </div>
          </Card>

          <Card>
            <SecTitle t="Ações Rápidas" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn vr="ghost" onClick={() => setItems(p => p.map(i => ({ ...i, done: false })))} style={{ width: "100%", justifyContent: "center", fontSize: 12 }}>
                Desmarcar Todos
              </Btn>
              <Btn vr="ghost" onClick={addDefaults} style={{ width: "100%", justifyContent: "center", fontSize: 12 }}>
                + Itens do Template Padrão
              </Btn>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
