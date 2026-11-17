import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { verifyPassword } from '../security/password.js';
import { signToken } from '../security/jwt.js';
import { auth } from '../middleware/auth.js';
import { asyncHandler, ok, fail } from '../utils/index.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'TOO_MANY_ATTEMPTS', message: '登录尝试过多' } },
});

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return fail(res, 400, '请求参数错误', 'BAD_REQUEST');
  }
  const user = getDb().prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as any;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return fail(res, 401, '账号或密码错误', 'UNAUTHORIZED');
  }
  ok(res, { token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
}));

authRouter.get('/me', auth, (req, res) => {
  ok(res, req.user ?? null);
});
