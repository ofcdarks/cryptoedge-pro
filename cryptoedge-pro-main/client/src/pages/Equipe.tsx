// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { teamApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, C } from "../components/shared/UI";

const ROLES = { admin: { l: "Admin", c: "#EF4444" }, editor: { l: "Editor", c: "#3B82F6" }, designer: { l: "Designer", c: "#A855F7" }, roteirista: { l: "Roteirista", c: "#22C55E" }, camera: { l: "Câmera", c: "#F59E0B" } };
const STC = { online: "#22C55E", away: "#F59E0B", offline: "rgba(255,255,255,0.22)" };

export default function Equipe() {
  const { channels } = useApp();
  const confirm = useConfirm();
  const [team, setTeam] = useState([]);
  const [showF, setShowF] = useState(false);
  const [nm, setNm] = useState({ name: "", role: "editor", email: "" });
  const [editId, setEditId] = useState(null);

  useEffect(() => { teamApi.list().then(setTeam).catch(() => {}); }, []);

  const addM = async () => {
    if (!nm.name.trim()) return;
    try {
      const m = await teamApi.create(nm);
      setTeam(p => [...p, m]);
      setNm({ name: "", role: "editor", email: "" });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const updateStatus = async (id, status) => {
    try {
      await teamApi.update(id, { status });
      setTeam(p => p.map(m => m.id === id ? { ...m, status } : m));
    } catch {}
  };

  const delM = async (id) => {
    const ok = await confirm({ title: "Remover Membro", message: "Este membro será removido da equipe. Deseja continuar?" });
    if (!ok) return;
    try { await teamApi.del(id); setTeam(p => p.filter(m => m.id !== id)); } catch {}
  };

  return (
    <div className="page-enter">
      <Hdr title="Equipe" sub="Gerencie editores, designers e colaboradores" action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Novo Membro"}</Btn>} />

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {Object.entries(ROLES).map(([k, v]) => {
          const c = team.filter(m => m.role === k).length;
          return (
            <Card key={k} style={{ flex: 1, padding: "14px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, color: v.c }}>{c}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{v.l}{c !== 1 ? "s" : ""}</div>
            </Card>
          );
        })}
      </div>

      {showF && (
        <Card style={{ marginBottom: 20, borderColor: `${C.blue}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Novo Membro</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
            <div><Label t="Nome Completo" /><Input value={nm.name} onChange={e => setNm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label t="Função" /><Select value={nm.role} onChange={e => setNm(p => ({ ...p, role: e.target.value }))}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select></div>
            <div><Label t="Email" /><Input value={nm.email} onChange={e => setNm(p => ({ ...p, email: e.target.value }))} /></div>
            <Btn onClick={addM} style={{ height: 38 }}>Adicionar</Btn>
          </div>
        </Card>
      )}

      {team.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nenhum membro na equipe</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Adicione seus editores, designers e colaboradores</div>
          <Btn onClick={() => setShowF(true)}>+ Adicionar Primeiro Membro</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {team.map(m => {
            const rl = ROLES[m.role] || { l: m.role, c: C.muted };
            const chs = m.channels || [];
            return (
              <Card key={m.id} hov color={rl.c}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  <div style={{ position: "relative" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: `${rl.c}15`, border: `2px solid ${rl.c}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: rl.c }}>{m.avatar}</div>
                    <div style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: STC[m.status] || STC.offline, border: `2px solid ${C.bgCard}` }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: rl.c }}>{rl.l}</div>
                  </div>
                  <Select value={m.status || "offline"} onChange={e => updateStatus(m.id, e.target.value)}
                    style={{ width: 100, padding: "4px 8px", fontSize: 11 }}>
                    <option value="online">Online</option>
                    <option value="away">Ausente</option>
                    <option value="offline">Offline</option>
                  </Select>
                </div>

                {m.email && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{m.email}</div>}

                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Canais atribuídos</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted }}>{m.tasks || 0} tarefas</span>
                </div>

                {chs.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {chs.map(c => (
                      <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "4px 10px", borderRadius: 6, background: `${c.color}10`, color: c.color, fontWeight: 600 }}>
                        <Badge color={c.color} /> {c.name}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Btn vr="subtle" onClick={() => delM(m.id)} style={{ fontSize: 10, color: C.red }}>Remover</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
