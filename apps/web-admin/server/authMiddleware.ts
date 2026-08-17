import type { NextFunction, Request, Response } from 'express';

export type AppUser = {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  display_name: string;
};

declare module 'express-session' {
  interface SessionData {
    user?: AppUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) return res.status(401).json({ error: '未登录' });
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: '仅运营主管可以执行此操作' });
  }
  next();
}
