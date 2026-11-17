import { getDb } from '../db/index.js';
import { newId, now, HttpError } from '../utils/index.js';
import type { ErrorCode } from '../security/errors.js';

function err(status: number, message: string, code: ErrorCode): never {
  throw new HttpError(status, message, code);
}

const REFUND_WINDOW_MS = 7 * 24 * 3600 * 1000; // 退券窗口：核销后 7 天

/**
 * 核销：unused -> used，幂等由 coupon_instances 上 UNIQUE(order_no 关联) 与状态检查共同保证。
 * 同一订单号重复核销返回冲突（ORDER_ALREADY_USED）。
 */
export function redeem(input: { code: string; userId: string; orderNo: string }): any {
  const db = getDb();
  const tx = db.transaction(() => {
    const inst = db.prepare('SELECT * FROM coupon_instances WHERE code = ?').get(input.code) as any;
    if (!inst) err(404, '优惠券不存在', 'COUPON_NOT_FOUND');
    if (inst.status === 'used') err(409, '优惠券已核销', 'COUPON_ALREADY_USED');
    if (inst.status === 'refunded') err(409, '优惠券已退货退款', 'COUPON_REFUNDED');
    if (inst.status === 'expired') err(409, '优惠券已过期', 'COUPON_EXPIRED');
    if (inst.status !== 'unused') err(409, '优惠券不是未使用状态，无法核销', 'COUPON_NOT_UNUSED');
    const t = now();
    if (inst.claimed_at && t < inst.claimed_at) err(400, '请求参数错误', 'BAD_REQUEST');

    const dupOrder = db.prepare('SELECT 1 FROM redemption_records WHERE order_no = ?').get(input.orderNo);
    if (dupOrder) err(409, '该订单号已使用过优惠券', 'ORDER_ALREADY_USED');

    const upd = db
      .prepare("UPDATE coupon_instances SET status='used', used_at=?, order_no=? WHERE id=? AND status='unused'")
      .run(t, input.orderNo, inst.id);
    if (upd.changes !== 1) err(409, '优惠券不是未使用状态，无法核销', 'COUPON_NOT_UNUSED');

    db.prepare(
      `INSERT INTO redemption_records
        (id, instance_id, template_id, user_id, activity_id, order_no, redeemed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'success')`,
    ).run(newId('rede_'), inst.id, inst.template_id, input.userId, inst.activity_id, input.orderNo, t);
    db.prepare('UPDATE inventory SET redeemed = redeemed + 1 WHERE template_id = ?').run(inst.template_id);
    db.prepare(
      `INSERT INTO operation_logs (id, coupon_code, user_id, activity_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, 'REDEEM', ?, ?)`,
    ).run(newId('log_'), inst.code, input.userId, inst.activity_id, JSON.stringify({ orderNo: input.orderNo }), t);
    return getCoupon(inst.id);
  });
  return tx();
}

/**
 * 退券：used -> refunded。回补规则：
 *   - 库存 claimed-1、refunded+1（券实例不再占用库存，但保留已发放历史）
 *   - redeemed-1（撤销核销计数）
 *   - 记录 refund_records，原核销记录标记 refunded
 *   - 核销超过 REFUND_WINDOW_MS 不允许退
 */
export function refund(input: { code: string; operator?: string; reason?: string }): any {
  const db = getDb();
  const tx = db.transaction(() => {
    const inst = db.prepare('SELECT * FROM coupon_instances WHERE code = ?').get(input.code) as any;
    if (!inst) err(404, '优惠券不存在', 'COUPON_NOT_FOUND');
    if (inst.status === 'refunded') err(409, '已退券，请勿重复操作', 'REFUND_ALREADY_DONE');
    if (inst.status !== 'used') err(409, '当前状态不允许退券', 'REFUND_NOT_ALLOWED');
    const redemption = db
      .prepare("SELECT * FROM redemption_records WHERE instance_id = ? AND status='success'")
      .get(inst.id) as any;
    if (!redemption) err(404, '核销记录不存在', 'REDEMPTION_NOT_FOUND');
    const t = now();
    if (t - redemption.redeemed_at > REFUND_WINDOW_MS) err(409, '超过退券时间窗口', 'REFUND_WINDOW_CLOSED');

    const upd = db
      .prepare("UPDATE coupon_instances SET status='refunded', refunded_at=? WHERE id=? AND status='used'")
      .run(t, inst.id);
    if (upd.changes !== 1) err(409, '当前状态不允许退券', 'REFUND_NOT_ALLOWED');
    db.prepare("UPDATE redemption_records SET status='refunded' WHERE id = ?").run(redemption.id);
    db.prepare(
      `UPDATE inventory SET claimed = MAX(claimed-1, 0), refunded = refunded+1,
       redeemed = MAX(redeemed-1, 0) WHERE template_id = ?`,
    ).run(inst.template_id);
    db.prepare(
      `INSERT INTO refund_records (id, instance_id, redemption_id, reason, operator, refunded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId('refund_'), inst.id, redemption.id, input.reason ?? null, input.operator ?? null, t);
    db.prepare(
      `INSERT INTO operation_logs (id, coupon_code, user_id, activity_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, 'REFUND', ?, ?)`,
    ).run(newId('log_'), inst.code, inst.user_id, inst.activity_id, JSON.stringify({ reason: input.reason }), t);
    return getCoupon(inst.id);
  });
  return tx();
}

export function getCoupon(id: string): any {
  return getDb().prepare('SELECT * FROM coupon_instances WHERE id = ?').get(id);
}

export function getCouponByCode(code: string): any {
  return getDb().prepare('SELECT * FROM coupon_instances WHERE code = ?').get(code);
}

export interface CouponQuery {
  code?: string;
  userId?: string;
  activityId?: string;
  status?: string;
  limit?: number;
}

export function queryCoupons(q: CouponQuery): any[] {
  const where: string[] = [];
  const args: any[] = [];
  if (q.code) { where.push('code = ?'); args.push(q.code); }
  if (q.userId) { where.push('user_id = ?'); args.push(q.userId); }
  if (q.activityId) { where.push('activity_id = ?'); args.push(q.activityId); }
  if (q.status) { where.push('status = ?'); args.push(q.status); }
  const limit = Math.min(q.limit ?? 100, 500);
  return getDb()
    .prepare(`SELECT * FROM coupon_instances ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY claimed_at DESC LIMIT ?`)
    .all(...args, limit) as any[];
}

export function queryLogs(q: { code?: string; userId?: string; activityId?: string; limit?: number }): any[] {
  const where: string[] = [];
  const args: any[] = [];
  if (q.code) { where.push('coupon_code = ?'); args.push(q.code); }
  if (q.userId) { where.push('user_id = ?'); args.push(q.userId); }
  if (q.activityId) { where.push('activity_id = ?'); args.push(q.activityId); }
  const limit = Math.min(q.limit ?? 100, 500);
  return getDb()
    .prepare(`SELECT * FROM operation_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, limit) as any[];
}
