import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { authApi } from "../lib/api";
import type { User } from "../types";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("lc_token");
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(u => setUser(u as User))
      .catch(() => localStorage.removeItem("lc_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await authApi.login(email, password);
    localStorage.setItem("lc_token", token);
    setUser(u as User);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const { token, user: u } = await authApi.register(email, name, password);
    localStorage.setItem("lc_token", token);
    setUser(u as User);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("lc_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
