// v1.6 用户系统 —— session + auth 中间件 + 路由
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { pool, q } from "./db";

// ============================================================
// 类型
// ============================================================
export type AppUser = {
  id: string;
  username: string;
  role: "admin" | "operator";
  display_name: string;
};

declare module "express-session" {
  interface SessionData {
    user?: AppUser;
  }
}

// ============================================================
// Session middleware —— connect-pg-simple + business_ext.app_session
// ============================================================
export function createSessionMiddleware() {
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    schemaName: "business_ext",
    tableName: "app_session",
    createTableIfMissing: false, // 表已通过迁移创建
  });

  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET with at least 32 characters is required");
  }
  const secureCookie = ["1", "true", "yes"].includes(
    (process.env.COOKIE_SECURE || "").trim().toLowerCase(),
  );

  return session({
    store,
    secret,
    name: "mkd.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 天
    },
  });
}

// ============================================================
// 中间件:要求已登录
// ============================================================
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "未登录" });
  }
  next();
}

// 中间件:要求管理员
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) return res.status(401).json({ error: "未登录" });
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "仅运营主管可以执行此操作" });
  }
  next();
}

// ============================================================
// 路由
// ============================================================
export function registerAuthRoutes(app: Express) {
  // POST /api/auth/login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: "请填写账号和密码" });
      }
      const rows = await q<{
        id: string; username: string; password_hash: string;
        role: "admin" | "operator"; display_name: string; is_active: boolean;
      }>(
        `SELECT id, username, password_hash, role, display_name, is_active
           FROM business_ext.app_user_ext
          WHERE username = $1`,
        [String(username).trim()]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: "账号或密码错误" });
      }
      const u = rows[0];
      if (!u.is_active) {
        return res.status(403).json({ error: "该账号已停用" });
      }
      const ok = await bcrypt.compare(String(password), u.password_hash);
      if (!ok) {
        return res.status(401).json({ error: "账号或密码错误" });
      }

      req.session.user = {
        id: u.id,
        username: u.username,
        role: u.role,
        display_name: u.display_name,
      };

      // 更新 last_login_at(失败不阻塞登录)
      q(`UPDATE business_ext.app_user_ext SET last_login_at = now() WHERE id = $1`, [u.id])
        .catch((e) => console.error("[auth] last_login_at update failed:", e.message));

      res.json({ ok: true, user: req.session.user });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.clearCookie("mkd.sid");
      res.json({ ok: true });
    });
  });

  // GET /api/auth/me
  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.user) return res.json({ user: null });
    res.json({ user: req.session.user });
  });

  // GET /api/users —— 仅 admin,列出所有账号
  app.get("/api/users", requireAdmin, async (_req, res) => {
    try {
      const rows = await q(
        `SELECT id, username, role, display_name, is_active,
                created_at::text as created_at,
                last_login_at::text as last_login_at
           FROM business_ext.app_user_ext
           ORDER BY created_at DESC`
      );
      res.json({ users: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/users —— 仅 admin,创建新账号
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, display_name } = req.body || {};
      if (!username || !password || !role || !display_name) {
        return res.status(400).json({ error: "所有字段必填" });
      }
      if (!["admin", "operator"].includes(role)) {
        return res.status(400).json({ error: "角色必须是 admin 或 operator" });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: "密码至少 6 位" });
      }
      const hash = await bcrypt.hash(String(password), 10);
      const rows = await q<any>(
        `INSERT INTO business_ext.app_user_ext (username, password_hash, role, display_name, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, username, role, display_name, is_active, created_at::text as created_at`,
        [String(username).trim(), hash, role, String(display_name).trim()]
      );
      res.json({ ok: true, user: rows[0] });
    } catch (e: any) {
      if (String(e.message || "").includes("duplicate key")) {
        return res.status(409).json({ error: "该账号名已被占用" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/users/:id —— 仅 admin,改密码/停用
  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { password, is_active, display_name } = req.body || {};
      const sets: string[] = ["updated_at = now()"];
      const params: any[] = [];
      if (password !== undefined) {
        if (String(password).length < 6) {
          return res.status(400).json({ error: "密码至少 6 位" });
        }
        const hash = await bcrypt.hash(String(password), 10);
        params.push(hash); sets.push(`password_hash = $${params.length}`);
      }
      if (is_active !== undefined) {
        params.push(Boolean(is_active)); sets.push(`is_active = $${params.length}`);
      }
      if (display_name !== undefined) {
        params.push(String(display_name).trim()); sets.push(`display_name = $${params.length}`);
      }
      if (params.length === 0) {
        return res.status(400).json({ error: "无字段更新" });
      }
      params.push(id);
      const rows = await q<any>(
        `UPDATE business_ext.app_user_ext SET ${sets.join(", ")} WHERE id = $${params.length}::uuid
         RETURNING id, username, role, display_name, is_active`,
        params
      );
      if (rows.length === 0) return res.status(404).json({ error: "账号不存在" });
      res.json({ ok: true, user: rows[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
