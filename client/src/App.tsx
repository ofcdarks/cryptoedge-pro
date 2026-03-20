import { useState, ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Spinner, C } from "./components/shared/UI";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import Sidebar from "./components/shared/Sidebar";
import TopBar from "./components/shared/TopBar";
import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Planner from "./pages/Planner";
import Storyboard from "./pages/Storyboard";
import Editor from "./pages/Editor";
import Checklist from "./pages/Checklist";
import Seo from "./pages/Seo";
import Metas from "./pages/Metas";
import Templates from "./pages/Templates";
import Calendario from "./pages/Calendario";
import Analytics from "./pages/Analytics";
import Orcamento from "./pages/Orcamento";
import Ativos from "./pages/Ativos";
import Equipe from "./pages/Equipe";
import Settings from "./pages/Settings";
import Ideas from "./pages/Ideas";

function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content" style={{ marginLeft: 220, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column", transition: "margin 0.2s" }}>
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <div className="page-padding" style={{ padding: "24px 32px", flex: 1, background: `radial-gradient(ellipse at 30% 0%, rgba(239,68,68,0.03) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(59,130,246,0.02) 0%, transparent 60%)` }}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}><Spinner /></div>;
  if (!user) return <Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<Layout><Dashboard /></Layout>} />
      <Route path="/planner" element={<Layout><Planner /></Layout>} />
      <Route path="/storyboard" element={<Layout><Storyboard /></Layout>} />
      <Route path="/editor" element={<Layout><Editor /></Layout>} />
      <Route path="/checklist" element={<Layout><Checklist /></Layout>} />
      <Route path="/seo" element={<Layout><Seo /></Layout>} />
      <Route path="/metas" element={<Layout><Metas /></Layout>} />
      <Route path="/templates" element={<Layout><Templates /></Layout>} />
      <Route path="/calendario" element={<Layout><Calendario /></Layout>} />
      <Route path="/analytics" element={<Layout><Analytics /></Layout>} />
      <Route path="/orcamento" element={<Layout><Orcamento /></Layout>} />
      <Route path="/ativos" element={<Layout><Ativos /></Layout>} />
      <Route path="/equipe" element={<Layout><Equipe /></Layout>} />
      <Route path="/settings" element={<Layout><Settings /></Layout>} />
      <Route path="/ideas" element={<Layout><Ideas /></Layout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
