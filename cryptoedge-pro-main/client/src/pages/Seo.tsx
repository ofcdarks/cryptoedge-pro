// @ts-nocheck
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { aiApi, seoResultApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Select, Badge, SecTitle, PBar, C } from "../components/shared/UI";

export default function Seo() {
  const { videos, channels } = useApp();
  const nav = useNavigate();
  const [selV, setSelV] = useState(videos[0]?.id);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  const vid = videos.find(v => v.id === selV);
  const ch = vid?.channel || channels.find(c => c.id === vid?.channelId);

  useEffect(() => {
    if (!selV) return;
    seoResultApi.listByVideo(selV).then(setHistory).catch(() => setHistory([]));
  }, [selV]);

  const generate = async () => {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const data = await aiApi.seo({ title: vid?.title || "", topic: topic || vid?.title || "", channelName: ch?.name || "" });
      if (data.error) { setError(data.error); return; }
      setResults(data);
      // Save to DB
      await seoResultApi.create({ videoId: selV, titles: data.titles, description: data.description || data.desc, tags: data.tags, score: data.score, tips: data.tips });
      seoResultApi.listByVideo(selV).then(setHistory).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const loadHistory = (h) => {
    setResults({ titles: h.titles, description: h.description, tags: h.tags, score: h.score, tips: h.tips });
  };

  return (
    <div className="page-enter">
      <Hdr title="Gerador SEO + IA" sub="Otimização viral — títulos e resultados salvos automaticamente" />

      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Gerar SEO Viral</div>
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 12, alignItems: "end" }}>
          <div><Label t="Vídeo" /><Select value={selV || ""} onChange={e => setSelV(Number(e.target.value))}>{videos.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</Select></div>
          <div><Label t="Tópico / Palavras-chave" /><Input placeholder="Ex: React hooks, investimentos..." value={topic} onChange={e => setTopic(e.target.value)} /></div>
          <Btn onClick={generate} disabled={loading} style={{ height: 38 }}>{loading ? "⏳ Gerando..." : "✦ Gerar SEO Viral"}</Btn>
        </div>
      </Card>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: `${C.red}30`, padding: 14 }} color={C.red}>
          <div style={{ fontSize: 13, color: C.red }}>{error}</div>
          {error.includes("Configurações") && <Btn vr="ghost" onClick={() => nav("/settings")} style={{ marginTop: 8, fontSize: 12 }}>Ir para Configurações →</Btn>}
        </Card>
      )}

      {results && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <Card color={C.orange}>
            <SecTitle t="Títulos Virais (IA)" />
            {(results.titles || []).map((t, i) => (
              <div key={i} style={{ padding: "10px 12px", background: i === 0 ? `${C.orange}08` : "transparent", borderRadius: 8, marginBottom: 4, border: i === 0 ? `1px solid ${C.orange}20` : "1px solid transparent" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.dim, marginRight: 8 }}>{i + 1}.</span>
                <span style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? C.text : C.muted }}>{t}</span>
                {i === 0 && <Badge text="Mais viral" color={C.green} v="tag" />}
              </div>
            ))}
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {results.score && (
              <Card color={C.green}>
                <SecTitle t="Score Viral" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[{ l: "SEO", v: results.score.seo, c: C.green }, { l: "CTR", v: results.score.ctr, c: C.orange }, { l: "Alcance", v: results.score.reach, c: C.blue }].map(s => (
                    <div key={s.l} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700, color: s.c }}>{s.v}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 4, marginBottom: 8 }}>{s.l}</div>
                      <PBar current={s.v} target={100} color={s.c} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <Card color={C.purple}><SecTitle t="Tags" /><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(results.tags || []).map((tag, i) => <Badge key={i} text={tag} color={i < 3 ? C.purple : C.muted} v="tag" />)}</div></Card>
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <Card color={C.blue}><SecTitle t="Descrição Otimizada" /><div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, whiteSpace: "pre-wrap", background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>{results.description || results.desc || ""}</div></Card>
          </div>
          {results.tips && <div style={{ gridColumn: "1/-1" }}><Card color={C.teal}><SecTitle t="Dicas da IA para Viralizar" /><div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>{results.tips}</div></Card></div>}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <>
          <SecTitle t="Histórico de SEO Salvo" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {history.map((h, i) => (
              <Card key={h.id} hov onClick={() => loadHistory(h)} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Versão {history.length - i}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim }}>{new Date(h.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                {h.titles?.length > 0 && <div style={{ fontSize: 12, color: C.orange, fontWeight: 600, marginBottom: 4 }}>{h.titles[0]}</div>}
                {h.score && <div style={{ display: "flex", gap: 8 }}>
                  <Badge text={`SEO ${h.score.seo}`} color={C.green} v="tag" />
                  <Badge text={`CTR ${h.score.ctr}`} color={C.orange} v="tag" />
                </div>}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
