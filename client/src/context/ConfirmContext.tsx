import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { C, Btn } from "../components/shared/UI";

interface ConfirmOptions {
  title?: string;
  message: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm: ConfirmFn = useCallback((opts) => {
    return new Promise<boolean>((resolve) => setState({ opts, resolve }));
  }, []);

  const close = (val: boolean) => {
    state?.resolve(val);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div onClick={() => close(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 380, background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`, padding: 28 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{state.opts.title || "Confirmar"}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>{state.opts.message}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn vr="ghost" onClick={() => close(false)}>Cancelar</Btn>
              <Btn onClick={() => close(true)}>Confirmar</Btn>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = (): ConfirmFn => useContext(ConfirmContext);
