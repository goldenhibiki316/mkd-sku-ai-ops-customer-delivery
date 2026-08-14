import { Link, useLocation } from "wouter";
import { ClipboardList, PieChart, ArrowRightLeft, Palette, Check, LogOut, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

const nav = [
  { href: "/", label: "运营工作台", icon: ClipboardList },
  { href: "/types", label: "SKU 分类分布", icon: PieChart },
  { href: "/transitions", label: "流转分析", icon: ArrowRightLeft },
];

// 主题定义 —— 通过给 <html> 加 class 切换 (CSS 定义在 index.css)
type ThemeKey = "warm" | "ocean" | "sage" | "graphite" | "sakura" | "dusk";

const themes: { key: ThemeKey; name: string; description: string; swatch: string[] }[] = [
  { key: "warm", name: "暖橙(默认)", description: "米色底 · 橙色主色", swatch: ["#FBF8F3", "#DC7A2E", "#3F3B34"] },
  { key: "ocean", name: "海蓝", description: "浅灰底 · 深蓝主色", swatch: ["#F5F7FA", "#1E5FA8", "#2A3542"] },
  { key: "sage", name: "青竹", description: "米绿底 · 森林绿", swatch: ["#F4F6F1", "#3F7A4A", "#2E3A2C"] },
  { key: "graphite", name: "石墨", description: "冷白底 · 石墨黑", swatch: ["#F8F8F9", "#2B2B30", "#4A4A50"] },
  { key: "sakura", name: "樱粉", description: "米粉底 · 樱花色", swatch: ["#FBF6F4", "#C55C7A", "#3B2E32"] },
  { key: "dusk", name: "暮色(深色)", description: "深色模式", swatch: ["#1E1D1B", "#E39463", "#E8E4DD"] },
];

const THEME_COOKIE = "mkd-theme";

function readTheme(): ThemeKey {
  try {
    const g = (window as any).__MKD_THEME__;
    if (g && themes.some((t) => t.key === g)) return g as ThemeKey;
  } catch {}
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("theme");
    if (q && themes.some((t) => t.key === q)) return q as ThemeKey;
  } catch {}
  try {
    const ls = localStorage.getItem(THEME_COOKIE);
    if (ls && themes.some((t) => t.key === ls)) return ls as ThemeKey;
  } catch {}
  try {
    const m = document.cookie.match(/(?:^|;\s*)mkd-theme=([^;]+)/);
    if (m && themes.some((t) => t.key === m[1])) return m[1] as ThemeKey;
  } catch {}
  return "warm";
}

function writeTheme(k: ThemeKey) {
  try {
    document.cookie = `${THEME_COOKIE}=${k}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch {}
  try { localStorage.setItem(THEME_COOKIE, k); } catch {}
  try { (window as any).__MKD_THEME__ = k; } catch {}
}

function applyTheme(k: ThemeKey) {
  const html = document.documentElement;
  themes.forEach((t) => html.classList.remove(`theme-${t.key}`));
  html.classList.add(`theme-${k}`);
  const body = document.body;
  if (body) {
    themes.forEach((t) => body.classList.remove(`theme-${t.key}`));
    body.classList.add(`theme-${k}`);
  }
}

function pageTitle(loc: string): string {
  if (loc === "/" || loc === "") return "运营工作台";
  if (loc === "/types") return "SKU 分类分布";
  if (loc === "/transitions") return "流转分析";
  return "库研";
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [theme, setTheme] = useState<ThemeKey>("warm");
  const { user, logout } = useAuth();

  useEffect(() => {
    const k = readTheme();
    setTheme(k);
    applyTheme(k);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [location, theme]);

  const switchTheme = (k: ThemeKey) => {
    setTheme(k);
    writeTheme(k);
    applyTheme(k);
  };

  const currentTheme = themes.find((t) => t.key === theme) || themes[0];
  const roleLabel = user?.role === "admin" ? "运营主管" : "运营人员";

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-5 py-6 border-b border-sidebar-border">
          <div className="text-base font-semibold">库研 SKU 运营</div>
          <div className="text-xs text-muted-foreground mt-1">智能诊断 · 每周更新</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((n) => {
            const active = location === n.href || (n.href === "/" && location === "");
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                data-testid={`nav-${n.href.replace(/\//g, "") || "home"}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        {/* v1.6 全局顶栏 —— 主题切换器 + 用户菜单 */}
        <header className="h-14 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-40 flex items-center justify-between px-6" data-testid="topbar">
          <div className="text-sm font-medium text-foreground/80">{pageTitle(location)}</div>
          <div className="flex items-center gap-2">
            {/* 主题切换 —— 全局可见 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                  data-testid="button-theme-switcher"
                  title="切换界面主题"
                >
                  <Palette className="w-4 h-4" />
                  <span className="hidden sm:inline">界面主题</span>
                  <div className="flex gap-0.5">
                    {currentTheme.swatch.map((c, i) => (
                      <span key={i} className="w-2 h-2 rounded-full border border-border/40" style={{ background: c }} />
                    ))}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground">选择一套喜欢的配色</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {themes.map((t) => (
                  <DropdownMenuItem
                    key={t.key}
                    onClick={() => switchTheme(t.key)}
                    className="flex items-center gap-3 cursor-pointer"
                    data-testid={`theme-${t.key}`}
                  >
                    <div className="flex gap-0.5 shrink-0">
                      {t.swatch.map((c, i) => (
                        <span key={i} className="w-3 h-3 rounded-full border border-border/60" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground">{t.description}</div>
                    </div>
                    {theme === t.key && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 用户菜单 */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                    data-testid="button-user-menu"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
                      {user.display_name.slice(0, 1)}
                    </div>
                    <div className="hidden sm:flex flex-col items-start leading-tight">
                      <span className="text-xs font-medium">{user.display_name}</span>
                      <span className="text-[10px] text-muted-foreground">{roleLabel}</span>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium">{user.display_name}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">@{user.username}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{roleLabel}</Badge>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {user.role === "admin" && (
                    <DropdownMenuItem asChild data-testid="menu-admin-users">
                      <Link href="/admin/users" className="cursor-pointer flex items-center gap-2">
                        <UserIcon className="w-4 h-4" />
                        <span>账号管理</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => logout()} className="cursor-pointer text-destructive focus:text-destructive" data-testid="menu-logout">
                    <LogOut className="w-4 h-4 mr-2" />
                    <span>退出登录</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
