import express from 'express';
import helmet from 'helmet';
import { migrate } from './db/migrate.js';
import { authRouter } from './routes/auth.js';
import { couponRouter } from './routes/coupons.js';
import { demoRouter } from './routes/demo.js';
import { HttpError } from './utils/index.js';

export function createApp(): express.Express {
  migrate();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));

  // 健康检查无需鉴权
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'ok', service: 'coupon-service', time: Date.now() } });
  });

  app.use('/api/auth', authRouter);

  // 保护其余 /api 路由（/api/auth/* 已在上面处理）
  app.use('/api', (req, res, next) => {
    const h = req.header('authorization') ?? '';
    if (!h.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未登录或 token 无效' } });
      return;
    }
    next();
  });
  app.use('/api', couponRouter);

  // 单页 UI demo（浏览器访问 /demo）
  app.use('/demo', demoRouter);

  // 根路径重定向到 demo
  app.get('/', (_req, res) => res.redirect('/demo'));

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
      return;
    }
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: '资源已存在' } });
      return;
    }
    console.error(err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: '服务内部错误' } });
  });
  return app;
}
