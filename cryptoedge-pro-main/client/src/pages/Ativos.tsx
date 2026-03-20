// @ts-nocheck
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useConfirm } from "../context/ConfirmContext";
import { assetApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, C } from "../components/shared/UI";

const TYPES = {
  thumbnail: { l: "Thumbnails", c: "#F59E0B", i: "🖼️" },
  intro: { l: "Intros", c: "#A855F7", i: "🎬" },
  outro: { l: "Outros", c: "#22C55E", i: "🔚" },
  overlay: { l: "Overlays", c: "#06B6D4", i: "🔲" },
  audio: { l: "Áudio", c: "#EC4899", i: "🎵" },
  transition: { l: "Transições", c: "#3B82F6", i: "✨" },
  graphic: { l: "Gráficos", c: "#14B8A6", i: "📊" },
  font: { l: "Fontes", c: "#EF4444", i: "🔤" },
};

function EditModal({ asset, channels, onClose, onSave }) {
  const [f, setF] = useState({
    name: asset.name, type: asset.type, format: asset.format || "", size: asset.size || "",
    channelId: asset.channelId || asset.channel?.id || "",
    tags: Array.isArray(asset.tags) ? asset.tags.join(", ") : (asset.tags || ""),
    fileUrl: asset.fileUrl || "", notes: asset.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(asset.id, { ...f, channelId: f.channelId ? Number(f.channelId) : null, tags: f.tags.split(",").map(t => t.trim()).filter(Boolean) });
      onClose();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Editar Ativo</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div><Label t="Nome" /><Input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label t="Tipo" /><Select value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><Label t="Formato" /><Input value={f.format} onChange={e => setF(p => ({ ...p, format: e.target.value }))} /></div>
            <div><Label t="Tamanho" /><Input value={f.size} onChange={e => setF(p => ({ ...p, size: e.target.value }))} /></div>
            <div><Label t="Canal" /><Select value={f.channelId} onChange={e => setF(p => ({ ...p, channelId: e.target.value }))}><option value="">Global</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          </div>
          <div>
            <Label t="🔗 Link do Arquivo (Google Drive, Dropbox, URL direta)" />
            <Input placeholder="https://drive.google.com/file/d/..." value={f.fileUrl} onChange={e => setF(p => ({ ...p, fileUrl: e.target.value }))} />
          </div>
          <div><Label t="Tags" /><Input value={f.tags} onChange={e => setF(p => ({ ...p, tags: e.target.value }))} /></div>
          <div><Label t="Notas" /><Input value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <Btn vr="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function Ativos() {
  const { channels } = useApp();
  const confirm = useConfirm();
  const [assets, setAssets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [showF, setShowF] = useState(false);
  const [editAsset, setEditAsset] = useState(null);
  const [search, setSearch] = useState("");
  const [na, setNa] = useState({ name: "", type: "thumbnail", format: "", size: "", channelId: "", tags: "", fileUrl: "", notes: "" });

  useEffect(() => { assetApi.list().then(setAssets).catch(() => {}); }, []);

  const filtered = assets.filter(a => {
    const matchType = filter === "all" || a.type === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || a.name.toLowerCase().includes(q) ||
      (Array.isArray(a.tags) ? a.tags : []).some(t => t.toLowerCase().includes(q));
    return matchType && matchSearch;
  });

  const addA = async () => {
    if (!na.name.trim()) return;
    try {
      const asset = await assetApi.create({ ...na, channelId: na.channelId ? Number(na.channelId) : null, tags: na.tags.split(",").map(t => t.trim()).filter(Boolean) });
      setAssets(p => [asset, ...p]);
      setNa({ name: "", type: "thumbnail", format: "", size: "", channelId: "", tags: "", fileUrl: "", notes: "" });
      setShowF(false);
    } catch (err) { alert(err.message); }
  };

  const saveEdit = async (id, data) => {
    const updated = await assetApi.update(id, data);
    setAssets(p => p.map(a => a.id === id ? updated : a));
  };

  const delA = async (id) => {
    const ok = await confirm({ title: "Remover Ativo", message: "Este ativo será removido do banco. Deseja continuar?" });
    if (!ok) return;
    try { await assetApi.del(id); setAssets(p => p.filter(a => a.id !== id)); } catch {}
  };

  const typeCounts = {};
  Object.keys(TYPES).forEach(k => { typeCounts[k] = assets.filter(a => a.type === k).length; });

  return (
    <div className="page-enter">
      {editAsset && <EditModal asset={editAsset} channels={channels} onClose={() => setEditAsset(null)} onSave={saveEdit} />}

      <Hdr title="Banco de Ativos" sub={`${assets.length} recursos cadastrados`}
        action={<Btn onClick={() => setShowF(!showF)}>{showF ? "✕ Fechar" : "+ Novo Ativo"}</Btn>} />

      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", flexWrap: "wrap" }}>
        <Btn vr={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")} style={{ padding: "7px 14px", fontSize: 12 }}>Todos ({assets.length})</Btn>
        {Object.entries(TYPES).map(([k, v]) => {
          const c = typeCounts[k] || 0;
          if (c === 0 && filter !== k) return null;
          return <Btn key={k} vr={filter === k ? "primary" : "ghost"} onClick={() => setFilter(k)} style={{ padding: "7px 14px", fontSize: 12, ...(filter === k ? { background: v.c } : {}) }}>{v.i} {v.l} ({c})</Btn>;
        })}
      </div>

      <Input placeholder="🔍 Buscar por nome ou tag..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 400, marginBottom: 16 }} />

      {showF && (
        <Card style={{ marginBottom: 20, borderColor: `${C.cyan}30` }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Cadastrar Novo Ativo</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><Label t="Nome do Ativo" /><Input placeholder="Ex: Intro Tech Brasil v3" value={na.name} onChange={e => setNa(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label t="Tipo" /><Select value={na.type} onChange={e => setNa(p => ({ ...p, type: e.target.value }))}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}</Select></div>
            <div><Label t="Canal" /><Select value={na.channelId} onChange={e => setNa(p => ({ ...p, channelId: e.target.value }))}><option value="">Global</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, marginBottom: 12 }}>
            <div><Label t="Formato" /><Input placeholder="PSD, MP4..." value={na.format} onChange={e => setNa(p => ({ ...p, format: e.target.value }))} /></div>
            <div><Label t="Tamanho" /><Input placeholder="12 MB" value={na.size} onChange={e => setNa(p => ({ ...p, size: e.target.value }))} /></div>
            <div><Label t="Tags (vírgula)" /><Input placeholder="intro, clean, dark" value={na.tags} onChange={e => setNa(p => ({ ...p, tags: e.target.value }))} /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label t="🔗 Link do Arquivo (Google Drive, Dropbox, URL direta)" />
            <Input placeholder="https://drive.google.com/file/d/..." value={na.fileUrl} onChange={e => setNa(p => ({ ...p, fileUrl: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "end" }}>
            <div style={{ flex: 1 }}><Label t="Notas (opcional)" /><Input placeholder="Versão, observações..." value={na.notes} onChange={e => setNa(p => ({ ...p, notes: e.target.value }))} /></div>
            <Btn onClick={addA} style={{ height: 38 }}>Cadastrar</Btn>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{search ? `Nenhum resultado para "${search}"` : "Nenhum ativo cadastrado"}</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Cadastre seus recursos com links do Google Drive ou URLs diretas</div>
          <Btn onClick={() => setShowF(true)}>+ Cadastrar Primeiro Ativo</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {filtered.map(a => {
            const tp = TYPES[a.type] || { l: a.type, c: C.muted, i: "📁" };
            const ch = a.channel || channels.find(c => c.id === a.channelId);
            const tags = Array.isArray(a.tags) ? a.tags : (a.tags || "").split(",").filter(Boolean);
            return (
              <Card key={a.id} hov color={tp.c} onClick={() => setEditAsset(a)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: `${tp.c}15`, border: `1px solid ${tp.c}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{tp.i}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 2 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: ch?.color || C.muted }}>{ch?.name || "Global"} · <span style={{ color: tp.c }}>{tp.l}</span></div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  {a.format && <div style={{ padding: "5px 10px", borderRadius: 6, background: `${tp.c}12`, border: `1px solid ${tp.c}25`, fontSize: 12, fontWeight: 600, color: tp.c }}>{a.format}</div>}
                  {a.size && <div style={{ padding: "5px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", fontSize: 12, color: C.muted }}>{a.size}</div>}
                </div>

                {/* File Link */}
                {a.fileUrl && (
                  <div onClick={e => { e.stopPropagation(); window.open(a.fileUrl, "_blank"); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: `${C.blue}08`, border: `1px solid ${C.blue}20`, marginBottom: 10, cursor: "pointer", transition: "all 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.blue}15`}
                    onMouseLeave={e => e.currentTarget.style.background = `${C.blue}08`}>
                    <span style={{ fontSize: 14 }}>🔗</span>
                    <span style={{ fontSize: 12, color: C.blue, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.fileUrl.includes("drive.google") ? "Abrir no Google Drive" : a.fileUrl.includes("dropbox") ? "Abrir no Dropbox" : "Abrir Link"}
                    </span>
                    <span style={{ fontSize: 11, color: C.dim }}>↗</span>
                  </div>
                )}

                {/* Notes */}
                {a.notes && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{a.notes}</div>}

                {tags.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                    {tags.map((t, i) => <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, background: "rgba(255,255,255,0.05)", color: C.muted }}>#{t}</span>)}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{a.createdAt ? new Date(a.createdAt).toLocaleDateString("pt-BR") : ""}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Btn vr="subtle" onClick={() => setEditAsset(a)} style={{ fontSize: 10, padding: "4px 8px" }}>✎ Editar</Btn>
                    <Btn vr="subtle" onClick={() => delA(a.id)} style={{ fontSize: 10, color: C.red, padding: "4px 8px" }}>✕</Btn>
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
