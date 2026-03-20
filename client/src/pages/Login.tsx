// @ts-nocheck
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { C, Btn, Input } from "../components/shared/UI";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isReg, setIsReg] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setErr("");
    setLoading(true);
    try {
      if (isReg) await register(form.email, form.name, form.password);
      else await login(form.email, form.password);
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <div style={{ width: 400, padding: 40, background: C.bgCard, borderRadius: 20, border: `1px solid ${C.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `linear-gradient(135deg, ${C.red}, ${C.orange})`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: "#fff", marginBottom: 16 }}>LC</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>LaCasaStudio</h1>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            {isReg ? "Crie sua conta" : "Entre na sua conta"}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {isReg && (
            <div>
              <label style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Nome</label>
              <Input placeholder="Seu nome" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} onKeyDown={onKeyDown} />
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
            <Input type="email" placeholder="email@exemplo.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} onKeyDown={onKeyDown} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Senha</label>
            <Input type="password" placeholder="••••••••" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} onKeyDown={onKeyDown} />
          </div>

          {err && <div style={{ fontSize: 12, color: C.red, padding: "8px 12px", background: `${C.red}10`, borderRadius: 8 }}>{err}</div>}

          <Btn onClick={handleSubmit} disabled={loading} style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 14, marginTop: 4 }}>
            {loading ? "Carregando..." : isReg ? "Criar Conta" : "Entrar"}
          </Btn>

          <div style={{ textAlign: "center", fontSize: 13, color: C.muted, marginTop: 4 }}>
            {isReg ? "Já tem conta?" : "Não tem conta?"}{" "}
            <span onClick={() => { setIsReg(!isReg); setErr(""); }} style={{ color: C.red, cursor: "pointer", fontWeight: 600 }}>
              {isReg ? "Entrar" : "Criar conta"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
