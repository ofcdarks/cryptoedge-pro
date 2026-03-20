// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { templateApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, C } from "../components/shared/UI";

export default function Templates() {
  const { channels } = useApp();
  const confirm = useConfirm();
  const [tpls, setTpls] = useState([]);
  const [showF, setShowF] = useState(false);
  const [nt, setNt] = useState({ name: "", desc: "", channelId: "", structure: "" });

  useEffect(() => { templateApi.list().then(setTpls).catch(() => {}); }, []);

  const addT = async () => {
    if (!nt.name.trim()) return;
    try {
      const tpl = await templateApi.create({
        ...nt, channelId: nt.channelId ? Number(nt.channelId) : null,
        structure: nt.structure.split(",").map(s => s.trim()).filter(Boolean),
      });
      setTpls(p => [tpl, ...p]);
      setNt({ name: "", desc: "", channelId: "", structure: "" });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const delT = async (id) => {
    const ok = await confirm({ title: "Remover Template", message: "Este template será removido permanentemente. Deseja continuar?" });
    if (!ok) return;
    try { await templateApi.del(id); setTpls(p => p.filter(t => t.id !== id)); } catch {}
  };

  return (
    <div className="page-enter">
      <Hdr title="Templates de Série" sub="Crie estruturas reutilizáveis para seus vídeos" action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Novo Template"}</Btn>} />

      {showF && (
        <Card style={{ marginBottom: 20, borderColor: `${C.purple}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Novo Template</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 10 }}>
            <div><Label t="Nome" /><Input placeholder="Ex: Tutorial Semanal" value={nt.name} onChange={e => setNt(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label t="Canal" /><Select value={nt.channelId} onChange={e => setNt(p => ({ ...p, channelId: e.target.value }))}><option value="">Global</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <Btn onClick={addT} style={{ height: 38 }}>Criar</Btn>
          </div>
          <div style={{ marginBottom: 10 }}><Label t="Descrição" /><Input placeholder="Para que serve este template..." value={nt.desc} onChange={e => setNt(p => ({ ...p, desc: e.target.value }))} /></div>
          <div><Label t="Estrutura (separada por vírgula)" /><Input placeholder="Intro (15s), Conteúdo (5min), CTA (15s), Outro (15s)" value={nt.structure} onChange={e => setNt(p => ({ ...p, structure: e.target.value }))} /></div>
        </Card>
      )}

      {tpls.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◆</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nenhum template criado</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Templates facilitam manter consistência entre episódios</div>
          <Btn onClick={() => setShowF(true)}>+ Criar Primeiro Template</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {tpls.map(t => {
            const ch = t.channel || channels.find(c => c.id === t.channelId);
            const structure = Array.isArray(t.structure) ? t.structure : (t.structure || "").split("|").filter(Boolean);
            return (
              <Card key={t.id} hov color={t.color || ch?.color || C.blue}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: `${t.color || C.blue}12`, border: `1px solid ${t.color || C.blue}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>◆</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: ch?.color || C.muted }}>{ch?.name || "Global"}</div>
                  </div>
                  <Btn vr="subtle" onClick={() => delT(t.id)} style={{ fontSize: 10, color: C.red, opacity: 0.5 }}>✕</Btn>
                </div>
                {t.desc && <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: "0 0 14px" }}>{t.desc}</p>}
                {structure.length > 0 && (
                  <>
                    <SecTitle t="Estrutura" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {structure.map((step, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8, borderLeft: `3px solid ${(t.color || C.blue)}40` }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: t.color || C.blue, fontWeight: 700, width: 18 }}>{i + 1}</span>
                          <span style={{ fontSize: 12.5, color: C.muted }}>{step}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
