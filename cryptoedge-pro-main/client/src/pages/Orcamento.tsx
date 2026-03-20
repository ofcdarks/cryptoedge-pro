// @ts-nocheck
import { useState, useEffect, useMemo } from "react";
import { useConfirm } from "../context/ConfirmContext";
import { budgetApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, PBar, C } from "../components/shared/UI";

const CATS = {
  equipamento: { l: "Equipamento", c: C.blue, i: "🎥" },
  software: { l: "Software", c: C.purple, i: "💻" },
  freelancer: { l: "Freelancer", c: C.orange, i: "👤" },
  marketing: { l: "Marketing", c: C.pink, i: "📢" },
  adsense: { l: "AdSense", c: C.green, i: "💰" },
  patrocinio: { l: "Patrocínio", c: C.teal, i: "🤝" },
  membros: { l: "Membros", c: C.cyan, i: "⭐" },
  afiliados: { l: "Afiliados", c: C.orange, i: "🔗" },
  outros: { l: "Outros", c: C.muted, i: "📦" },
};

function EditModal({ item, onClose, onSave }) {
  const [f, setF] = useState({ category: item.category, desc: item.desc, value: item.value, type: item.type, recurring: item.recurring || false, notes: item.notes || "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(item.id, f); onClose(); } catch {} finally { setSaving(false); } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Editar Lançamento</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label t="Tipo" /><Select value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}><option value="income">Receita</option><option value="expense">Gasto</option></Select></div>
            <div><Label t="Categoria" /><Select value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
          </div>
          <div><Label t="Descrição" /><Input value={f.desc} onChange={e => setF(p => ({ ...p, desc: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label t="Valor (R$)" /><Input type="number" value={f.value} onChange={e => setF(p => ({ ...p, value: e.target.value }))} /></div>
            <div><Label t="Notas" /><Input value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.muted }}>
            <input type="checkbox" checked={f.recurring} onChange={e => setF(p => ({ ...p, recurring: e.target.checked }))} /> 🔄 Recorrente (repete todo mês)
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <Btn vr="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function Orcamento() {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [showF, setShowF] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [viewMode, setViewMode] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState({ category: "outros", desc: "", value: "", type: "expense", recurring: false, notes: "" });

  useEffect(() => { budgetApi.list().then(setItems).catch(() => {}); }, []);

  const addItem = async () => {
    if (!form.desc.trim() || !form.value) return;
    try {
      const item = await budgetApi.create({ ...form, value: Number(form.value), month: selectedMonth });
      setItems(p => [item, ...p]);
      setForm({ category: "outros", desc: "", value: "", type: "expense", recurring: false, notes: "" });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const saveEdit = async (id, data) => {
    const updated = await budgetApi.update(id, data);
    setItems(p => p.map(i => i.id === id ? updated : i));
  };

  const delItem = async (id) => {
    const ok = await confirm({ title: "Remover Lançamento", message: "Este lançamento será removido." });
    if (!ok) return;
    try { await budgetApi.del(id); setItems(p => p.filter(i => i.id !== id)); } catch {}
  };

  // Filter by view mode
  const filtered = useMemo(() => {
    if (viewMode === "all") return items;
    if (viewMode === "month") return items.filter(i => i.month === selectedMonth || i.recurring);
    if (viewMode === "year") return items.filter(i => (i.month || "").startsWith(selectedMonth.slice(0, 4)) || i.recurring);
    return items;
  }, [items, viewMode, selectedMonth]);

  const expenses = filtered.filter(i => i.type === "expense").reduce((a, i) => a + i.value, 0);
  const income = filtered.filter(i => i.type === "income").reduce((a, i) => a + i.value, 0);
  const profit = income - expenses;
  const recurring = filtered.filter(i => i.recurring);
  const recurringTotal = recurring.reduce((a, i) => a + (i.type === "expense" ? -i.value : i.value), 0);

  // Category breakdown
  const catBreakdown = useMemo(() => {
    const map = {};
    filtered.forEach(i => {
      const key = i.category || "outros";
      if (!map[key]) map[key] = { income: 0, expense: 0 };
      if (i.type === "income") map[key].income += i.value;
      else map[key].expense += i.value;
    });
    return map;
  }, [filtered]);

  const months = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(); d.setMonth(d.getMonth() + i);
    months.push(d.toISOString().slice(0, 7));
  }
  const monthNames = { "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez" };

  return (
    <div className="page-enter">
      {editItem && <EditModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEdit} />}

      <Hdr title="Orçamento" sub="Controle financeiro completo dos seus canais"
        action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Novo Lançamento"}</Btn>} />

      {/* View Mode + Month Selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        {[{ v: "month", l: "Mensal" }, { v: "year", l: "Anual" }, { v: "all", l: "Tudo" }].map(m => (
          <Btn key={m.v} vr={viewMode === m.v ? "primary" : "ghost"} onClick={() => setViewMode(m.v)} style={{ padding: "7px 16px", fontSize: 12 }}>{m.l}</Btn>
        ))}
        <div style={{ flex: 1 }} />
        {viewMode !== "all" && (
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {months.map(m => (
              <Btn key={m} vr={selectedMonth === m ? "primary" : "ghost"} onClick={() => setSelectedMonth(m)}
                style={{ padding: "6px 12px", fontSize: 11, fontFamily: "var(--mono)", ...(selectedMonth === m ? {} : {}) }}>
                {monthNames[m.slice(5)] || m.slice(5)}/{m.slice(2, 4)}
              </Btn>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[
          { l: "Receita", v: income, c: C.green, i: "📈" },
          { l: "Gastos", v: expenses, c: C.red, i: "📉" },
          { l: "Lucro", v: profit, c: profit >= 0 ? C.green : C.red, i: profit >= 0 ? "✅" : "⚠️" },
          { l: "Recorrente", v: recurringTotal, c: recurringTotal >= 0 ? C.teal : C.orange, i: "🔄" },
        ].map(s => (
          <Card key={s.l} color={s.c}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{s.l}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, color: s.c }}>R$ {Math.abs(s.v).toLocaleString("pt-BR")}</div>
              </div>
              <span style={{ fontSize: 20 }}>{s.i}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Category Breakdown */}
      {Object.keys(catBreakdown).length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <SecTitle t="Por Categoria" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {Object.entries(catBreakdown).map(([k, v]) => {
              const cat = CATS[k] || CATS.outros;
              const total = v.income - v.expense;
              return (
                <div key={k} style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{cat.i}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: cat.c, marginBottom: 4 }}>{cat.l}</div>
                  {v.income > 0 && <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.green }}>+R$ {v.income.toLocaleString("pt-BR")}</div>}
                  {v.expense > 0 && <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.red }}>-R$ {v.expense.toLocaleString("pt-BR")}</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Add Form */}
      {showF && (
        <Card style={{ marginBottom: 16, borderColor: `${C.blue}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Novo Lançamento</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr 1fr", gap: 10, alignItems: "end", marginBottom: 10 }}>
            <div><Label t="Tipo" /><Select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}><option value="income">📈 Receita</option><option value="expense">📉 Gasto</option></Select></div>
            <div><Label t="Categoria" /><Select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
            <div><Label t="Descrição" /><Input placeholder="Adobe CC, Rode NT1..." value={form.desc} onChange={e => setForm(p => ({ ...p, desc: e.target.value }))} /></div>
            <div><Label t="Valor (R$)" /><Input type="number" placeholder="250" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} /></div>
          </div>
          <div style={{ display: "flex", alignItems: "end", gap: 12 }}>
            <div style={{ flex: 1 }}><Label t="Notas" /><Input placeholder="Observações..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: C.muted, padding: "8px 0" }}>
              <input type="checkbox" checked={form.recurring} onChange={e => setForm(p => ({ ...p, recurring: e.target.checked }))} /> 🔄 Recorrente
            </label>
            <Btn onClick={addItem} style={{ height: 38 }}>Criar</Btn>
          </div>
        </Card>
      )}

      {/* Items List */}
      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: C.dim }}>Nenhum lançamento para este período</div>
        ) : filtered.map((it, i) => {
          const cat = CATS[it.category] || CATS.outros;
          return (
            <div key={it.id} onClick={() => setEditItem(it)}
              style={{ display: "grid", gridTemplateColumns: "32px auto 1fr 120px 60px", gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = C.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 16 }}>{cat.i}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Badge text={cat.l} color={cat.c} v="tag" />
                {it.recurring && <Badge text="🔄" color={C.teal} v="tag" />}
              </div>
              <div>
                <div style={{ fontSize: 13, color: C.text }}>{it.desc}</div>
                {it.notes && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{it.notes}</div>}
              </div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600, textAlign: "right", color: it.type === "income" ? C.green : C.red }}>
                {it.type === "income" ? "+" : "-"}R$ {it.value?.toLocaleString("pt-BR")}
              </span>
              <div style={{ display: "flex", gap: 3 }} onClick={e => e.stopPropagation()}>
                <Btn vr="subtle" onClick={() => setEditItem(it)} style={{ fontSize: 10, padding: "4px 6px" }}>✎</Btn>
                <Btn vr="subtle" onClick={() => delItem(it.id)} style={{ fontSize: 10, color: C.red, padding: "4px 6px" }}>✕</Btn>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
