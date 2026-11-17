import { Router } from 'express';
import { z } from 'zod';
import { auth, adminOnly } from '../middleware/auth.js';
import { asyncHandler, ok, fail, HttpError } from '../utils/index.js';
import {
  createTemplate, getTemplate, getInventory, updateAntiAbuseRules,
} from '../services/templateService.js';
import { claim } from '../services/claimService.js';
import { batchClaim } from '../services/batchService.js';
import {
  redeem, refund, getCoupon, getCouponByCode, queryCoupons, queryLogs,
} from '../services/redemptionService.js';
import { manualTrigger } from '../jobs/expireScanner.js';

export const couponRouter = Router();

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, res: any): z.infer<T> | null {
  const r = schema.safeParse(data);
  if (!r.success) {
    fail(res, 400, '请求参数错误', 'BAD_REQUEST');
    return null;
  }
  return r.data;
}

// 接口 1：券模板创建
const createTplSchema = z.object({
  name: z.string().min(1).max(200),
  activityId: z.string().min(1),
  total: z.number().int().positive(),
  discount: z.number().int().nonnegative(),
  perUser: z.number().int().positive().optional(),
  startAt: z.number().int(),
  endAt: z.number().int(),
});
couponRouter.post('/templates', auth, adminOnly, asyncHandler(async (req, res) => {
  const b = parse(createTplSchema, req.body, res);
  if (!b) return;
  const tpl = createTemplate(b, req.user!.sub);
  ok(res, tpl, 201);
}));

// 接口 2：模板详情
couponRouter.get('/templates/:id', auth, asyncHandler(async (req, res) => {
  ok(res, getTemplate(req.params.id));
}));

// 接口 7：库存查询
couponRouter.get('/templates/:id/inventory', auth, asyncHandler(async (req, res) => {
  ok(res, getInventory(req.params.id));
}));

// 接口：配置防刷规则
const ruleSchema = z.object({
  perUser: z.number().int().positive().optional(),
  perDevice: z.number().int().positive().optional(),
  perIp: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});
couponRouter.put('/templates/:id/anti-abuse', auth, adminOnly, asyncHandler(async (req, res) => {
  const b = parse(ruleSchema, req.body, res);
  if (!b) return;
  ok(res, updateAntiAbuseRules(req.params.id, b));
}));

// 接口 3：领券（单张）
const claimSchema = z.object({
  templateId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  deviceId: z.string().optional(),
  ip: z.string().optional(),
});
couponRouter.post('/claims', auth, asyncHandler(async (req, res) => {
  const b = parse(claimSchema, req.body, res);
  if (!b) return;
  // userId 以登录态为准，防止伪造；ip 取请求来源（若未显式提供）
  const result = claim({
    templateId: b.templateId,
    userId: req.user!.sub,
    idempotencyKey: b.idempotencyKey,
    deviceId: b.deviceId,
    ip: b.ip ?? req.ip,
  });
  ok(res, result);
}));

// 接口 8：批量发放
const batchSchema = z.object({
  templateId: z.string().min(1),
  items: z.array(z.object({
    userId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    deviceId: z.string().optional(),
    ip: z.string().optional(),
  })).min(1).max(1000),
});
couponRouter.post('/claims/batch', auth, adminOnly, asyncHandler(async (req, res) => {
  const b = parse(batchSchema, req.body, res);
  if (!b) return;
  ok(res, batchClaim(b.templateId, b.items));
}));

// 接口 4：核销
const redeemSchema = z.object({
  code: z.string().min(1),
  orderNo: z.string().min(1),
});
couponRouter.post('/redemptions', auth, asyncHandler(async (req, res) => {
  const b = parse(redeemSchema, req.body, res);
  if (!b) return;
  ok(res, redeem({ code: b.code, userId: req.user!.sub, orderNo: b.orderNo }));
}));

// 接口 5：退券
const refundSchema = z.object({
  code: z.string().min(1),
  reason: z.string().optional(),
});
couponRouter.post('/refunds', auth, adminOnly, asyncHandler(async (req, res) => {
  const b = parse(refundSchema, req.body, res);
  if (!b) return;
  ok(res, refund({ code: b.code, reason: b.reason, operator: req.user!.username }));
}));

// 接口 6：券查询（按券码 / 用户 / 活动 / 状态）
couponRouter.get('/coupons', auth, asyncHandler(async (req, res) => {
  const q = {
    code: req.query.code as string | undefined,
    userId: req.query.userId as string | undefined,
    activityId: req.query.activityId as string | undefined,
    status: req.query.status as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };
  ok(res, queryCoupons(q));
}));

couponRouter.get('/coupons/by-code/:code', auth, asyncHandler(async (req, res) => {
  const c = getCouponByCode(req.params.code);
  if (!c) throw new HttpError(404, '优惠券不存在', 'COUPON_NOT_FOUND');
  ok(res, c);
}));

// 接口：日志检索（券码/用户/活动）
couponRouter.get('/logs', auth, asyncHandler(async (req, res) => {
  ok(res, queryLogs({
    code: req.query.code as string | undefined,
    userId: req.query.userId as string | undefined,
    activityId: req.query.activityId as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }));
}));

// 接口：过期扫描手动触发入口
couponRouter.post('/jobs/expire-scan', auth, adminOnly, asyncHandler(async (_req, res) => {
  ok(res, manualTrigger());
}));

// 接口：错误码表（便于前端对接）
couponRouter.get('/error-codes', auth, asyncHandler(async (_req, res) => {
  const { ERROR_CODES } = await import('../security/errors.js');
  ok(res, ERROR_CODES);
}));
