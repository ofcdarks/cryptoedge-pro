// @ts-nocheck
import { useApp } from "../context/AppContext";
import { Card, Badge, Hdr, Btn, C, ST } from "../components/shared/UI";
import { useState } from "react";

export default function Calendario() {
  const { videos, channels } = useApp();
  const [offset, setOffset] = useState(0);

  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const wk = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const todayDate = now.getDate();
  const isCurrentMonth = offset === 0;

  return (
    <div className="page-enter">
      <Hdr title="Calendário" sub="Visualize sua agenda de publicações" />

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <Btn vr="ghost" onClick={() => setOffset(p => p - 1)} style={{ fontSize: 14, padding: "6px 14px" }}>← Anterior</Btn>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{monthNames[month]} {year}</div>
          <Btn vr="ghost" onClick={() => setOffset(p => p + 1)} style={{ fontSize: 14, padding: "6px 14px" }}>Próximo →</Btn>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {wk.map(d => (
            <div key={d} style={{ fontSize: 10, color: C.dim, textAlign: "center", padding: 8, fontWeight: 700, textTransform: "uppercase" }}>{d}</div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const dv = videos.filter(v => v.date === ds);
            const isToday = isCurrentMonth && d === todayDate;
            return (
              <div key={d} style={{
                padding: 8, borderRadius: 8, minHeight: 80,
                background: isToday ? `${C.red}08` : dv.length > 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
                border: isToday ? `1px solid ${C.red}40` : `1px solid ${C.border}`,
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? C.red : C.muted, marginBottom: 4 }}>{d}</div>
                {dv.map(v => {
                  const vch = v.channel || channels.find(c => c.id === v.channelId);
                  const st = ST[v.status];
                  return (
                    <div key={v.id} style={{ fontSize: 9, padding: "3px 6px", borderRadius: 5, background: `${vch?.color || C.muted}15`, color: vch?.color, marginBottom: 3, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: `2px solid ${vch?.color || C.muted}` }}
                      title={`${v.title} — ${st?.l || v.status}`}>
                      {v.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
