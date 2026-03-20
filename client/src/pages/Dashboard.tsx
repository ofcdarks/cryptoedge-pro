// @ts-nocheck
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Card, Badge, Btn, Hdr, SecTitle, C, ST } from "../components/shared/UI";

export default function Dashboard() {
  const { channels, videos } = useApp();
  const nav = useNavigate();

  const sc = useMemo(() => {
    const c: Record<string, number> = {};
    Object.keys(ST).forEach(k => { c[k] = videos.filter(v => v.status === k).length; });
    return c;
  }, [videos]);

  const totalSubs = channels.reduce((a: number, ch: any) => a + (parseFloat(ch.subs) || 0), 0);
  const urgentVideos = videos.filter((v: any) => v.priority === "alta" && v.status !== "published").slice(0, 5);
  const recentVideos = [...videos].sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()).slice(0, 8);

  return (
    <div className="page-enter">
      <Hdr title="Dashboard" sub={`${channels.length} canais · ${videos.length} vídeos no sistema`}
        action={<Btn onClick={() => nav("/planner")}>+ Novo Vídeo</Btn>} />

      <div className="grid-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { l: "Total Inscritos", v: totalSubs > 0 ? `${totalSubs.toFixed(1)}K` : "0", c: C.blue, i: "👥" },
          { l: "Em Produção", v: videos.filter((v: any) => v.status !== "published").length, c: C.orange, i: "🎬", go: "/planner" },
          { l: "Publicados", v: sc.published || 0, c: C.green, i: "✅" },
          { l: "Canais Ativos", v: channels.length, c: C.purple, i: "📺" },
        ].map((s, i) => (
          <Card key={i} color={s.c} hov={!!s.go} onClick={s.go ? () => nav(s.go) : undefined}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 500 }}>{s.l}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700 }}>{s.v}</div>
              </div>
              <span style={{ fontSize: 24 }}>{s.i}</span>
            </div>
          </Card>
        ))}
      </div>

      <SecTitle t="Pipeline de Produção" />
      <div className="pipeline-row" style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {Object.entries(ST).map(([k, v]) => (
          <Card key={k} style={{ flex: 1, padding: "14px 10px", textAlign: "center", cursor: "pointer", minWidth: 0 }} onClick={() => nav("/planner")}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, color: v.c, marginBottom: 4 }}>{sc[k] || 0}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{v.l}</div>
          </Card>
        ))}
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div>
          <SecTitle t="Prioridade Alta" />
          <Card style={{ padding: 0 }}>
            {urgentVideos.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: C.dim }}>Nenhum vídeo urgente</div>
            ) : urgentVideos.map((v: any, i: number) => {
              const ch = v.channel || channels.find((c: any) => c.id === v.channelId);
              const st = ST[v.status];
              return (
                <div key={v.id} onClick={() => nav("/planner")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: i < urgentVideos.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
                  <span style={{ fontSize: 12 }}>🔴</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                    <div style={{ fontSize: 11, color: ch?.color }}>{ch?.name}</div>
                  </div>
                  <Badge text={st?.l} color={st?.c} v="tag" />
                </div>
              );
            })}
          </Card>
        </div>
        <div>
          <SecTitle t="Canais" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {channels.map((ch: any) => {
              const inProd = videos.filter((v: any) => (v.channelId || v.channel?.id) === ch.id && v.status !== "published").length;
              return (
                <Card key={ch.id} hov color={ch.color} onClick={() => nav("/planner")} style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${ch.color}12`, border: `1px solid ${ch.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Badge color={ch.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{ch.name}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: ch.color }}>{ch.subs} inscritos</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600 }}>{inProd}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>em produção</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      <SecTitle t="Atividade Recente" />
      <Card style={{ padding: 0, overflow: "auto" }}>
        {recentVideos.map((v: any, i: number) => {
          const ch = v.channel || channels.find((c: any) => c.id === v.channelId);
          const st = ST[v.status];
          return (
            <div key={v.id} onClick={() => nav("/planner")} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: i < recentVideos.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 2, minWidth: 0 }}>
                <Badge color={ch?.color} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                  <div style={{ fontSize: 11, color: ch?.color, marginTop: 1 }}>{ch?.name}</div>
                </div>
              </div>
              {st && <Badge text={`${st.i} ${st.l}`} color={st.c} v="tag" />}
              <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{v.priority === "alta" ? "🔴" : v.priority === "média" ? "🟡" : "🔵"} {v.priority}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.dim, textAlign: "right", flexShrink: 0 }}>{v.date}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
