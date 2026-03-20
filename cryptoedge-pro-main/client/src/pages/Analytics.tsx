// @ts-nocheck
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { youtubeApi, settingsApi } from "../lib/api";
import { Card, Btn, Hdr, Label, Input, Badge, SecTitle, PBar, C, ST } from "../components/shared/UI";

export default function Analytics() {
  const { channels, videos } = useApp();
  const nav = useNavigate();
  const [ytChannelId, setYtChannelId] = useState("");
  const [ytData, setYtData] = useState(null);
  const [ytVideos, setYtVideos] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [hasYtKey, setHasYtKey] = useState(false);

  useEffect(() => {
    settingsApi.getRaw("youtube_api_key").then(s => { setHasYtKey(!!s.value); }).catch(() => {});
  }, []);

  // Internal stats from LaCasaStudio data
  const stats = useMemo(() => {
    const statusDist = {};
    Object.keys(ST).forEach(k => { statusDist[k] = videos.filter(v => v.status === k).length; });
    return { statusDist, total: videos.length };
  }, [videos]);

  const fetchYouTube = async () => {
    if (!ytChannelId.trim()) return;
    setLoading(true);
    setError("");
    setYtData(null);
    setYtVideos([]);
    setAnalysis(null);
    try {
      const data = await youtubeApi.channel(ytChannelId);
      if (data.error) { setError(data.error); return; }
      setYtData(data);
      // Fetch videos
      const vids = await youtubeApi.videos(data.id, 10);
      if (!vids.error) setYtVideos(Array.isArray(vids) ? vids : []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const runAnalysis = async () => {
    if (!ytData) return;
    setAnalyzing(true);
    try {
      const data = await youtubeApi.analyze({
        channelName: ytData.title,
        stats: ytData.stats,
        recentVideos: ytVideos.slice(0, 8),
      });
      if (data.error) { setError(data.error); return; }
      setAnalysis(data);
    } catch (err) { setError(err.message); }
    finally { setAnalyzing(false); }
  };

  return (
    <div className="page-enter">
      <Hdr title="Analytics" sub="Dados reais do YouTube + Análise com IA"
        action={<Badge text="YouTube + IA" color={C.red} v="tag" />} />

      {/* Internal Stats */}
      <SecTitle t="Visão Interna — Dados do LaCasaStudio" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { l: "Total Vídeos", v: stats.total, c: C.blue },
          { l: "Em Produção", v: videos.filter(v => v.status !== "published").length, c: C.orange },
          { l: "Publicados", v: stats.statusDist.published || 0, c: C.green },
          { l: "Alta Prioridade", v: videos.filter(v => v.priority === "alta").length, c: C.red },
        ].map((s, i) => (
          <Card key={i} color={s.c}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{s.l}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700 }}>{s.v}</div>
          </Card>
        ))}
      </div>

      {/* Status Bar */}
      {stats.total > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 4, height: 32, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
            {Object.entries(ST).map(([k, v]) => {
              const count = stats.statusDist[k] || 0;
              const pct = (count / stats.total) * 100;
              if (pct === 0) return null;
              return (
                <div key={k} style={{ flex: pct, background: v.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", minWidth: count > 0 ? 28 : 0 }} title={`${v.l}: ${count}`}>
                  {pct > 10 && count}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {Object.entries(ST).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.muted }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: v.c }} />
                {v.l}: <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: C.text }}>{stats.statusDist[k] || 0}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* YouTube Section */}
      <SecTitle t="YouTube — Dados Reais do Canal" />
      {!hasYtKey ? (
        <Card style={{ marginBottom: 24, borderColor: `${C.red}30` }} color={C.red}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>YouTube API não configurada</div>
              <div style={{ fontSize: 12, color: C.muted }}>Configure sua YouTube Data API Key nas configurações para ver dados reais</div>
            </div>
            <Btn onClick={() => nav("/settings")} style={{ fontSize: 12 }}>Ir para Configurações →</Btn>
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "end" }}>
              <div style={{ flex: 1 }}>
                <Label t="ID ou @ do Canal" />
                <Input placeholder="UCxxxxxxxx ou @handle" value={ytChannelId}
                  onChange={e => setYtChannelId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && fetchYouTube()} />
              </div>
              <Btn onClick={fetchYouTube} disabled={loading} style={{ height: 38 }}>
                {loading ? "⏳ Buscando..." : "Buscar Canal"}
              </Btn>
            </div>
          </Card>

          {error && (
            <Card style={{ marginBottom: 16, padding: 14, borderColor: `${C.red}30` }} color={C.red}>
              <div style={{ fontSize: 12, color: C.red }}>{error}</div>
            </Card>
          )}

          {/* Channel Data */}
          {ytData && (
            <>
              <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }} color={C.red}>
                {ytData.thumbnail && (
                  <img src={ytData.thumbnail} alt="" style={{ width: 64, height: 64, borderRadius: 14 }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{ytData.title}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.red }}>{ytData.customUrl}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, textAlign: "center" }}>
                  {[
                    { l: "Inscritos", v: ytData.stats.subscribers?.toLocaleString("pt-BR") },
                    { l: "Views", v: ytData.stats.views?.toLocaleString("pt-BR") },
                    { l: "Vídeos", v: ytData.stats.videos?.toLocaleString("pt-BR") },
                  ].map(s => (
                    <div key={s.l}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 700 }}>{s.v}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Recent Videos */}
              {ytVideos.length > 0 && (
                <>
                  <SecTitle t="Últimos Vídeos Publicados" />
                  <Card style={{ padding: 0, marginBottom: 16 }}>
                    {ytVideos.map((v, i) => (
                      <div key={v.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr repeat(3, 90px)", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: i < ytVideos.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        {v.thumbnail && (
                          <img src={v.thumbnail} alt="" style={{ width: 80, height: 45, borderRadius: 6, objectFit: "cover" }} />
                        )}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3 }}>{v.title}</div>
                          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.dim, marginTop: 3 }}>
                            {new Date(v.publishedAt).toLocaleDateString("pt-BR")}
                          </div>
                        </div>
                        {[
                          { l: "Views", v: v.stats.views?.toLocaleString("pt-BR"), c: C.blue },
                          { l: "Likes", v: v.stats.likes?.toLocaleString("pt-BR"), c: C.green },
                          { l: "Comments", v: v.stats.comments?.toLocaleString("pt-BR"), c: C.orange },
                        ].map(s => (
                          <div key={s.l} style={{ textAlign: "center" }}>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: s.c }}>{s.v}</div>
                            <div style={{ fontSize: 9, color: C.dim }}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </Card>
                </>
              )}

              {/* AI Analysis */}
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <Btn onClick={runAnalysis} disabled={analyzing}>
                  {analyzing ? "⏳ Analisando com IA..." : "✦ Analisar Canal com IA"}
                </Btn>
              </div>

              {analysis && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  {/* Summary */}
                  <Card color={C.blue} style={{ gridColumn: "1/-1" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <SecTitle t="Resumo da IA" />
                      {analysis.growthScore && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: C.muted }}>Score de Crescimento:</span>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: analysis.growthScore >= 70 ? C.green : analysis.growthScore >= 40 ? C.orange : C.red }}>{analysis.growthScore}/100</span>
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7 }}>{analysis.summary}</p>
                  </Card>

                  {/* Strengths */}
                  <Card color={C.green}>
                    <SecTitle t="Pontos Fortes" />
                    {(analysis.strengths || []).map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: i < analysis.strengths.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.green }}>✓</span>
                        <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{s}</span>
                      </div>
                    ))}
                  </Card>

                  {/* Improvements */}
                  <Card color={C.orange}>
                    <SecTitle t="Melhorias Sugeridas" />
                    {(analysis.improvements || []).map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: i < analysis.improvements.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.orange }}>→</span>
                        <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{s}</span>
                      </div>
                    ))}
                  </Card>

                  {/* Next Video Ideas */}
                  <Card color={C.purple}>
                    <SecTitle t="Próximos Vídeos Sugeridos pela IA" />
                    {(analysis.nextVideoIdeas || []).map((idea, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < analysis.nextVideoIdeas.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.purple, fontWeight: 700, width: 20 }}>{i + 1}.</span>
                        <span style={{ fontSize: 13, color: C.muted }}>{idea}</span>
                      </div>
                    ))}
                  </Card>

                  {/* Tips */}
                  <Card color={C.cyan}>
                    <SecTitle t="Dicas de Engajamento" />
                    {(analysis.engagementTips || []).map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: i < analysis.engagementTips.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.cyan }}>💡</span>
                        <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{tip}</span>
                      </div>
                    ))}
                    {analysis.bestPostingTime && (
                      <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: `${C.cyan}08`, border: `1px solid ${C.cyan}20` }}>
                        <div style={{ fontSize: 11, color: C.cyan, fontWeight: 600, marginBottom: 4 }}>Melhor horário para postar:</div>
                        <div style={{ fontSize: 13, color: C.text }}>{analysis.bestPostingTime}</div>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
