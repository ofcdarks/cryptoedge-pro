import { Component, ReactNode } from "react";
import { C, Btn } from "./UI";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>💥</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Algo deu errado</h2>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
              {this.state.error?.message || "Erro inesperado na aplicação"}
            </p>
            <Btn onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = "/"; }}>
              Voltar ao início
            </Btn>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
