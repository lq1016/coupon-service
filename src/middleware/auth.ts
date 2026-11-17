import type { RequestHandler } from 'express';
import { verifyToken, type JwtPayload } from '../security/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const auth: RequestHandler = (req, res, next) => {
  const h = req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未登录或 token 无效' } });
    return;
  }
  req.user = payload;
  next();
};

export const adminOnly: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } });
    return;
  }
  next();
};
