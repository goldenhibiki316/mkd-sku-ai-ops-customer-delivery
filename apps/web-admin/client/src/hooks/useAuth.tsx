// v1.6 用户系统 —— 认证 Context + hook
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type AppUser = {
  id: string;
  username: string;
  role: "admin" | "operator";
  display_name: string;
};

type AuthContextValue = {
  user: AppUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  async function refresh() {
    try {
      const r = await apiRequest("GET", "/api/auth/me");
      const data = await r.json();
      setUser(data.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function login(username: string, password: string) {
    try {
      const r = await apiRequest("POST", "/api/auth/login", { username, password });
      const data = await r.json();
      if (!r.ok) return { ok: false, error: data.error || "登录失败" };
      setUser(data.user);
      queryClient.invalidateQueries();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "网络错误" };
    }
  }

  async function logout() {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    setUser(null);
    queryClient.clear();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
