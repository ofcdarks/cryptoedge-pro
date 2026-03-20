import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { C } from "./UI";

interface ToastItem { id: number; message: string; type: string; removing: boolean; }
interface ToastAPI { success: (msg: string) => void; error: (msg: string) => void; warning: (msg: string) => void; info: (msg: string) => void; }

const ICONS: Record<string, string> = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
const COLORS: Record<string, string> = { success: C.green, error: C.red, warning: C.orange, info: C.blue };

const ToastContext = createContext<ToastAPI | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((message: string, type: string = "info", duration: number = 4000) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type, removing: false }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
    }, duration);
  }, []);

  const api: ToastAPI = {
    success: (m: string) => addToast(m, "success"),
    error: (m: string) => addToast(m, "error"),
    warning: (m: string) => addToast(m, "warning"),
    info: (m: string) => addToast(m, "info"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 18px", borderRadius: 12,
            background: C.bgCard, border: `1px solid ${COLORS[t.type] || C.blue}30`,
            boxShadow: `0 8px 30px rgba(0,0,0,0.4)`,
            animation: t.removing ? "toastOut 0.3s ease forwards" : "toastIn 0.3s ease",
            cursor: "pointer",
          }}
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
          >
            <span style={{ fontSize: 16 }}>{ICONS[t.type] || "ℹ️"}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text, flex: 1 }}>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastAPI | null => useContext(ToastContext);
