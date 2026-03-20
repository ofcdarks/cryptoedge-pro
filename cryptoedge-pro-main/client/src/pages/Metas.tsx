// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { metaApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, PBar, SecTitle, C } from "../components/shared/UI";

export default function Metas() {
  const { channels } = useApp();
  const confirm = useConfirm();
  const [metas, setMetas] = useState([]);
  const [showF, setShowF] = useState(false);
  const [form, setForm] = useState({ title: "", channelId: "", items: [{ label: "", current: 0, target: 0, unit: "" }] });

  useEffect(() => { metaApi.list().then(setMetas).catch(() => {}); }, []);

  const addMetaItem = () => setForm(p => ({ ...p, items: [...p.items, { label: "", current: 0, target: 0, unit: "" }] }));
  const updateFormItem = (idx, field, val) => setForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [field]: val } : it) }));
  const removeFormItem = (idx) => setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const createMeta = async () => {
    if (!form.title.trim()) return;
    const validItems = form.items.filter(i => i.label.trim());
    if (validItems.length === 0) return alert("Adicione pelo menos um item");
    try {
      const meta = await metaApi.create({
        title: form.title,
        channelId: form.channelId ? Number(form.channelId) : null,
        items: validItems.map(i => ({ label: i.label, current: Number(i.current) || 0, target: Number(i.target) || 0, unit: i.unit })),
      });
      setMetas(p => [...p, meta]);
      setForm({ title: "", channelId: "", items: [{ label: "", current: 0, target: 0, unit: "" }] });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const updateProgress = async (itemId, current) => {
    try {
      await metaApi.updateItem(itemId, { current: Number(current) });
      setMetas(p => p.map(m => ({
        ...m,
        items: (m.items || []).map(it => it.id === itemId ? { ...it, current: Number(current) } : it),
      })));
    } catch {}
  };

  const delMeta = async (id) => {
    const ok = await confirm({ title: "Remover Meta", message: "Esta meta e todos os seus indicadores serão removidos. Deseja continuar?" });
    if (!ok) return;
    try { await metaApi.del(id); setMetas(p => p.filter(m => m.id !== id)); } catch {}
  };

  const now = new Date();
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <div className="page-enter">
      <Hdr title="Metas & OKRs" sub="Acompanhe e gerencie seus objetivos" action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Nova Meta"}</Btn>} />

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Metas & OKRs</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>{monthNames[now.getMonth()]} / {monthNames[(now.getMonth() + 1) % 12]} {now.getFullYear()}</div>

      {/* Create Form */}
      {showF && (
        <Card style={{ marginBottom: 20, borderColor: `${C.orange}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Nova Meta</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
            <div><Label t="Título da Meta" /><Input placeholder="Ex: Crescimento Q2" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label t="Canal (opcional)" /><Select value={form.channelId} onChange={e => setForm(p => ({ ...p, channelId: e.target.value }))}><option value="">Todos os Canais</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          </div>

          <SecTitle t="Itens da Meta" />
          {form.items.map((item, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 80px 32px", gap: 8, marginBottom: 8, alignItems: "end" }}>
              <div><Label t="Indicador" /><Input placeholder="Inscritos ganhos" value={item.label} onChange={e => updateFormItem(idx, "label", e.target.value)} /></div>
              <div><Label t="Atual" /><Input type="number" value={item.current} onChange={e => updateFormItem(idx, "current", e.target.value)} /></div>
              <div><Label t="Meta" /><Input type="number" value={item.target} onChange={e => updateFormItem(idx, "target", e.target.value)} /></div>
              <div><Label t="Unidade" /><Input placeholder="K" value={item.unit} onChange={e => updateFormItem(idx, "unit", e.target.value)} /></div>
              {form.items.length > 1 && (
                <Btn vr="subtle" onClick={() => removeFormItem(idx)} style={{ color: C.red, fontSize: 12, padding: "8px" }}>✕</Btn>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Btn vr="ghost" onClick={addMetaItem} style={{ fontSize: 12 }}>+ Adicionar Indicador</Btn>
            <div style={{ flex: 1 }} />
            <Btn onClick={createMeta}>Criar Meta</Btn>
          </div>
        </Card>
      )}

      {/* Metas Grid */}
      {metas.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nenhuma meta criada</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Defina objetivos para acompanhar o progresso dos seus canais</div>
          <Btn onClick={() => setShowF(true)}>+ Criar Primeira Meta</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {metas.map(m => {
            const ch = m.channel || (m.channelId ? channels.find(c => c.id === m.channelId) : null);
            const color = ch?.color || C.blue;
            const label = ch?.name || "Todos os Canais";
            return (
              <Card key={m.id} color={color}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color, marginTop: 3 }}>{label}</div>
                  </div>
                  <Btn vr="subtle" onClick={() => delMeta(m.id)} style={{ fontSize: 10, color: C.red, opacity: 0.6 }}>✕</Btn>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {(m.items || []).map(it => {
                    const pct = it.target > 0 ? Math.round((it.current / it.target) * 100) : 0;
                    return (
                      <div key={it.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                          <span style={{ fontSize: 13, color: C.muted }}>{it.label}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="number" value={it.current}
                              onChange={e => updateProgress(it.id, e.target.value)}
                              style={{ width: 60, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", color, fontSize: 12, fontFamily: "var(--mono)", fontWeight: 600, textAlign: "right", outline: "none" }} />
                            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.dim }}>/ {it.target} {it.unit}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1 }}><PBar current={it.current} target={it.target} color={color} /></div>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: pct >= 100 ? C.green : C.dim, fontWeight: 600 }}>{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
