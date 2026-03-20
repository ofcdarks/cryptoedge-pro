// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { ideaApi, aiApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, C } from "../components/shared/UI";

const COLORS = [
  { v: "#3B82F6", l: "Azul" }, { v: "#EF4444", l: "Vermelho" }, { v: "#22C55E", l: "Verde" },
  { v: "#A855F7", l: "Roxo" }, { v: "#F59E0B", l: "Amarelo" }, { v: "#EC4899", l: "Rosa" },
  { v: "#06B6D4", l: "Ciano" }, { v: "#14B8A6", l: "Teal" },
];

function EditModal({ idea, channels, onClose, onSave }) {
  const [f, setF] = useState({
    title: idea.title, content: idea.content || "", imageUrl: idea.imageUrl || "",
    tags: Array.isArray(idea.tags) ? idea.tags.join(", ") : (idea.tags || ""),
    color: idea.color || "#3B82F6", channelId: idea.channelId || idea.channel?.id || "",
    pinned: idea.pinned || false,
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(idea.id, { ...f, channelId: f.channelId ? Number(f.channelId) : null, tags: f.tags.split(",").map(t => t.trim()).filter(Boolean) });
      onClose();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 600, background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Editar Ideia</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><Label t="Título da Ideia" /><Input value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} /></div>
          <div>
            <Label t="Anotações / Descrição" />
            <textarea value={f.content} onChange={e => setF(p => ({ ...p, content: e.target.value }))}
              style={{ width: "100%", minHeight: 150, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "var(--font)", lineHeight: 1.6 }}
              placeholder="Descreva a ideia, referências, anotações..." />
          </div>
          <div><Label t="🔗 Link de Imagem / Print (URL)" /><Input placeholder="https://..." value={f.imageUrl} onChange={e => setF(p => ({ ...p, imageUrl: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label t="Canal" /><Select value={f.channelId} onChange={e => setF(p => ({ ...p, channelId: e.target.value }))}><option value="">Geral</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <div><Label t="Tags (vírgula)" /><Input value={f.tags} onChange={e => setF(p => ({ ...p, tags: e.target.value }))} /></div>
          </div>
          <div>
            <Label t="Cor" />
            <div style={{ display: "flex", gap: 6 }}>
              {COLORS.map(c => (
                <div key={c.v} onClick={() => setF(p => ({ ...p, color: c.v }))}
                  style={{ width: 32, height: 32, borderRadius: 8, background: c.v, cursor: "pointer", border: f.color === c.v ? "3px solid #fff" : "3px solid transparent", transition: "all 0.15s" }} />
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.muted }}>
            <input type="checkbox" checked={f.pinned} onChange={e => setF(p => ({ ...p, pinned: e.target.checked }))} /> 📌 Fixar no topo
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

export default function Ideas() {
  const { channels } = useApp();
  const confirm = useConfirm();
  const [ideas, setIdeas] = useState([]);
  const [showF, setShowF] = useState(false);
  const [editIdea, setEditIdea] = useState(null);
  const [search, setSearch] = useState("");
  const [analyzing, setAnalyzing] = useState(null);
  const [analysis, setAnalysis] = useState({});
  const [ni, setNi] = useState({ title: "", content: "", imageUrl: "", tags: "", color: "#3B82F6", channelId: "", pinned: false });

  useEffect(() => { ideaApi.list().then(setIdeas).catch(() => {}); }, []);

  const filtered = ideas.filter(i => {
    const q = search.toLowerCase();
    if (!q) return true;
    return i.title.toLowerCase().includes(q) || (i.content || "").toLowerCase().includes(q) ||
      (Array.isArray(i.tags) ? i.tags : []).some(t => t.toLowerCase().includes(q));
  });

  const addIdea = async () => {
    if (!ni.title.trim()) return;
    try {
      const idea = await ideaApi.create({ ...ni, channelId: ni.channelId ? Number(ni.channelId) : null, tags: ni.tags.split(",").map(t => t.trim()).filter(Boolean) });
      setIdeas(p => [idea, ...p]);
      setNi({ title: "", content: "", imageUrl: "", tags: "", color: "#3B82F6", channelId: "", pinned: false });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const saveEdit = async (id, data) => {
    const updated = await ideaApi.update(id, data);
    setIdeas(p => p.map(i => i.id === id ? updated : i));
  };

  const togglePin = async (id, pinned) => {
    try {
      const updated = await ideaApi.update(id, { pinned: !pinned });
      setIdeas(p => p.map(i => i.id === id ? updated : i));
    } catch {}
  };

  const delIdea = async (id) => {
    const ok = await confirm({ title: "Remover Ideia", message: "Esta ideia e todas as suas anotações serão removidas." });
    if (!ok) return;
    try { await ideaApi.del(id); setIdeas(p => p.filter(i => i.id !== id)); } catch {}
  };

  const analyzeWithAI = async (idea) => {
    setAnalyzing(idea.id);
    try {
      const ch = idea.channel || channels.find(c => c.id === idea.channelId);
      const data = await aiApi.analyzeIdea({ idea: idea.title + (idea.content ? ". " + idea.content : ""), channelName: ch?.name, niche: ch?.name });
      setAnalysis(p => ({ ...p, [idea.id]: data }));
    } catch (err) { alert(err.message); }
    finally { setAnalyzing(null); }
  };

  return (
    <div className="page-enter">
      {editIdea && <EditModal idea={editIdea} channels={channels} onClose={() => setEditIdea(null)} onSave={saveEdit} />}

      <Hdr title="Banco de Ideias" sub={`${ideas.length} ideias salvas — cole prints, anote referências, analise com IA`}
        action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Nova Ideia"}</Btn>} />

      <Input placeholder="🔍 Buscar ideias..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 400, marginBottom: 16 }} />

      {showF && (
        <Card style={{ marginBottom: 20, borderColor: `${C.blue}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Nova Ideia</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div><Label t="Título / Tema" /><Input placeholder="Ex: Vídeo sobre como ganhar dinheiro dormindo" value={ni.title} onChange={e => setNi(p => ({ ...p, title: e.target.value }))} /></div>
              <div><Label t="Canal" /><Select value={ni.channelId} onChange={e => setNi(p => ({ ...p, channelId: e.target.value }))}><option value="">Geral</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            </div>
            <div>
              <Label t="Anotações" />
              <textarea value={ni.content} onChange={e => setNi(p => ({ ...p, content: e.target.value }))}
                style={{ width: "100%", minHeight: 100, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "var(--font)" }}
                placeholder="Referências, links, observações, estratégia..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><Label t="🔗 URL de Print / Imagem" /><Input placeholder="https://..." value={ni.imageUrl} onChange={e => setNi(p => ({ ...p, imageUrl: e.target.value }))} /></div>
              <div><Label t="Tags (vírgula)" /><Input placeholder="modelar, trending, tutorial" value={ni.tags} onChange={e => setNi(p => ({ ...p, tags: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", alignItems: "end", gap: 12 }}>
              <div>
                <Label t="Cor" />
                <div style={{ display: "flex", gap: 5 }}>
                  {COLORS.map(c => <div key={c.v} onClick={() => setNi(p => ({ ...p, color: c.v }))} style={{ width: 28, height: 28, borderRadius: 7, background: c.v, cursor: "pointer", border: ni.color === c.v ? "3px solid #fff" : "3px solid transparent" }} />)}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <Btn onClick={addIdea} style={{ height: 38 }}>Salvar Ideia</Btn>
            </div>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💡</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{search ? `Nenhum resultado para "${search}"` : "Nenhuma ideia salva"}</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Cole prints de canais que vai modelar, anote referências e analise com IA</div>
          <Btn onClick={() => setShowF(true)}>+ Primeira Ideia</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
          {filtered.map(idea => {
            const ch = idea.channel || channels.find(c => c.id === idea.channelId);
            const tags = Array.isArray(idea.tags) ? idea.tags : [];
            const ai = analysis[idea.id];

            return (
              <Card key={idea.id} color={idea.color} style={{ ...(idea.pinned ? { borderColor: `${idea.color}40`, boxShadow: `0 0 20px ${idea.color}10` } : {}) }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                  {idea.pinned && <span style={{ fontSize: 14 }}>📌</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, marginBottom: 4 }}>{idea.title}</div>
                    <div style={{ fontSize: 12, color: ch?.color || C.muted }}>{ch?.name || "Geral"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    <Btn vr="subtle" onClick={() => togglePin(idea.id, idea.pinned)} style={{ fontSize: 11, padding: "4px 6px" }}>{idea.pinned ? "📌" : "📍"}</Btn>
                    <Btn vr="subtle" onClick={() => setEditIdea(idea)} style={{ fontSize: 11, padding: "4px 6px" }}>✎</Btn>
                  </div>
                </div>

                {/* Image */}
                {idea.imageUrl && (
                  <div style={{ marginBottom: 12, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
                    <img src={idea.imageUrl} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
                      onError={e => { e.target.style.display = "none"; }} />
                  </div>
                )}

                {/* Content */}
                {idea.content && (
                  <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "hidden", position: "relative" }}>
                    {idea.content}
                    {idea.content.length > 200 && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, background: `linear-gradient(transparent, ${C.bgCard})` }} />}
                  </div>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
                    {tags.map((t, i) => <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, background: `${idea.color}12`, color: idea.color, fontWeight: 500 }}>#{t}</span>)}
                  </div>
                )}

                {/* AI Analysis */}
                {ai && (
                  <div style={{ padding: 12, borderRadius: 10, background: `${C.purple}08`, border: `1px solid ${C.purple}20`, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.purple }}>✦ ANÁLISE IA</span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700, color: ai.viralScore >= 70 ? C.green : ai.viralScore >= 40 ? C.orange : C.red }}>{ai.viralScore}/100</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>{ai.analysis}</div>
                    {ai.bestTitle && <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", color: C.text, fontWeight: 600, marginBottom: 6 }}>💎 {ai.bestTitle}</div>}
                    {ai.estimatedViews && <div style={{ fontSize: 11, color: C.dim }}>Views estimados: {ai.estimatedViews}</div>}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{idea.createdAt ? new Date(idea.createdAt).toLocaleDateString("pt-BR") : ""}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Btn vr="ghost" onClick={() => analyzeWithAI(idea)} disabled={analyzing === idea.id} style={{ fontSize: 10, padding: "5px 10px" }}>
                      {analyzing === idea.id ? "⏳..." : "✦ Analisar IA"}
                    </Btn>
                    <Btn vr="subtle" onClick={() => delIdea(idea.id)} style={{ fontSize: 10, color: C.red }}>✕</Btn>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
