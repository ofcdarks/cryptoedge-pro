// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { scriptApi, aiApi } from "../lib/api";
import { Card, Btn, Hdr, SecTitle, Select, Badge, C } from "../components/shared/UI";

export default function Editor() {
  const { videos, channels } = useApp();
  const nav = useNavigate();
  const [selV, setSelV] = useState(videos[0]?.id);
  const [script, setScript] = useState("");
  const [scriptId, setScriptId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const vid = videos.find(v => v.id === selV);
  const ch = vid?.channel || channels.find(c => c.id === vid?.channelId);
  const wc = script.split(/\s+/).filter(Boolean).length;

  // Load script from DB
  const loadScripts = useCallback(async () => {
    if (!selV) return;
    try {
      const scripts = await scriptApi.listByVideo(selV);
      setVersions(scripts);
      if (scripts.length > 0) {
        setScript(scripts[0].content);
        setScriptId(scripts[0].id);
      } else {
        setScript("");
        setScriptId(null);
      }
    } catch {}
  }, [selV]);

  useEffect(() => { loadScripts(); }, [loadScripts]);

  // Auto-save
  const saveScript = async () => {
    if (!selV) return;
    setSaving(true);
    try {
      if (scriptId) {
        await scriptApi.update(scriptId, { content: script });
      } else {
        const s = await scriptApi.create({ videoId: selV, content: script });
        setScriptId(s.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadScripts();
    } catch {}
    finally { setSaving(false); }
  };

  const generateScript = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await aiApi.script({ title: vid?.title || "Vídeo", duration: vid?.duration || "10:00", style: "educativo viral", topic: vid?.title });
      if (data.error) { setError(data.error); return; }
      setScript(data.script);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const improveScript = async () => {
    if (!script.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await aiApi.script({ title: vid?.title || "Vídeo", duration: vid?.duration || "10:00", currentScript: script });
      if (data.error) { setError(data.error); return; }
      setScript(data.script);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const loadVersion = (v) => {
    setScript(v.content);
    setScriptId(v.id);
  };

  const newVersion = async () => {
    try {
      const s = await scriptApi.create({ videoId: selV, content: script });
      setScriptId(s.id);
      loadScripts();
    } catch {}
  };

  return (
    <div className="page-enter">
      <Hdr title="Editor de Roteiro" sub="Roteiros salvos automaticamente no banco — com IA viral" action={
        <div style={{ display: "flex", gap: 8 }}>
          <Select style={{ width: 200 }} value={selV || ""} onChange={e => setSelV(Number(e.target.value))}>
            {videos.map(v => { const vc = v.channel || channels.find(c => c.id === v.channelId); return <option key={v.id} value={v.id}>{vc?.name?.slice(0, 6)} — {v.title}</option>; })}
          </Select>
          <Btn onClick={saveScript} disabled={saving} vr={saved ? "ghost" : "primary"} style={{ fontSize: 12 }}>
            {saving ? "⏳ Salvando..." : saved ? "✓ Salvo!" : "💾 Salvar"}
          </Btn>
        </div>
      } />

      {error && (
        <Card style={{ marginBottom: 12, borderColor: `${C.red}30`, padding: 14 }} color={C.red}>
          <div style={{ fontSize: 12, color: C.red }}>{error}</div>
          {error.includes("Configurações") && <Btn vr="ghost" onClick={() => nav("/settings")} style={{ marginTop: 8, fontSize: 11 }}>Ir para Configurações →</Btn>}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* AI Buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={generateScript} disabled={loading} style={{ fontSize: 12 }}>
              {loading ? "⏳ Gerando..." : "✦ Gerar Roteiro Viral"}
            </Btn>
            {script.trim() && <Btn vr="ghost" onClick={improveScript} disabled={loading} style={{ fontSize: 12 }}>✦ Melhorar Retenção</Btn>}
            {script.trim() && scriptId && <Btn vr="ghost" onClick={newVersion} style={{ fontSize: 12 }}>📋 Salvar como Nova Versão</Btn>}
          </div>

          <Card style={{ padding: 0, flex: 1 }}>
            <textarea value={script} onChange={e => setScript(e.target.value)}
              placeholder="Escreva seu roteiro aqui ou gere com IA...&#10;&#10;Use # para marcar seções&#10;Use [B-ROLL], [ZOOM], [SFX], [MÚSICA], [TELA] para marcações"
              style={{ width: "100%", minHeight: 520, background: "transparent", border: "none", color: C.text, fontSize: 14, lineHeight: 1.8, padding: 24, outline: "none", resize: "vertical", fontFamily: "var(--font)" }} />
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <SecTitle t="Estatísticas" />
            {[
              { l: "Palavras", v: wc },
              { l: "Tempo estimado", v: `~${Math.ceil(wc / 150)} min` },
              { l: "Caracteres", v: script.length.toLocaleString() },
              { l: "Seções (#)", v: (script.match(/^#/gm) || []).length },
              { l: "Marcações", v: (script.match(/\[.+?\]/g) || []).length },
            ].map(s => (
              <div key={s.l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.muted }}>{s.l}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }}>{s.v}</span>
              </div>
            ))}
          </Card>

          <Card>
            <SecTitle t="Vídeo" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{vid?.title}</div>
            <div style={{ fontSize: 12, color: ch?.color }}>{ch?.name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.dim, marginTop: 6 }}>{vid?.duration} · {vid?.date}</div>
          </Card>

          {/* Version History */}
          <Card>
            <SecTitle t="Versões Salvas" />
            {versions.length === 0 ? (
              <div style={{ fontSize: 12, color: C.dim, textAlign: "center", padding: 12 }}>Nenhuma versão salva</div>
            ) : versions.map((v, i) => (
              <div key={v.id} onClick={() => loadVersion(v)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < versions.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = C.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: scriptId === v.id ? 700 : 400, color: scriptId === v.id ? C.text : C.muted }}>
                    Versão {versions.length - i}
                    {scriptId === v.id && <Badge text="atual" color={C.green} v="tag" />}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{new Date(v.updatedAt || v.createdAt).toLocaleString("pt-BR")}</div>
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{v.content?.split(/\s+/).length || 0}w</span>
              </div>
            ))}
          </Card>

          <Card>
            <SecTitle t="Marcações" />
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
              <div><span style={{ color: C.cyan, fontWeight: 600 }}>[B-ROLL]</span> — Corte para imagem/vídeo</div>
              <div><span style={{ color: C.orange, fontWeight: 600 }}>[ZOOM]</span> — Zoom in/out</div>
              <div><span style={{ color: C.pink, fontWeight: 600 }}>[SFX]</span> — Efeito sonoro</div>
              <div><span style={{ color: C.green, fontWeight: 600 }}>[MÚSICA]</span> — Trilha sonora</div>
              <div><span style={{ color: C.blue, fontWeight: 600 }}>[TELA]</span> — Screen recording</div>
              <div><span style={{ color: C.purple, fontWeight: 600 }}>[LOWER-THIRD]</span> — Texto na tela</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
