import { getDb } from '../db/index.js';
import { newId, now, sha256, generateCode, HttpError } from '../utils/index.js';
import { getTemplate } from './templateService.js';
import type { ErrorCode } from '../security/errors.js';

export interface ClaimInput {
  templateId: string;
  userId: string;
  idempotencyKey: string;
  deviceId?: string;
  ip?: string;
}

export interface ClaimResult {
  instanceId: string;
  code: string;
  templateId: string;
  activityId: string;
  status: string;
  claimedAt: number;
  replay?: boolean;
}

function err(status: number, message: string, code: ErrorCode): never {
  throw new HttpError(status, message, code);
}

/**
 * 领券主流程（防超发/幂等/防刷）。
 *
 * 防超发：better-sqlite3 为单连接同步执行，事件循环上一次只跑一个事务；
 *   库存扣减用条件原子更新 `SET claimed=claimed+1 WHERE claimed<total`，
 *   changes()===0 即库存耗尽，天然不会超卖（单进程内严格串行）。
 * 幂等：先查 idempotency_records 命中即返回首次结果；claim_records 的唯一键作第二道防线。
 * 防刷：从 anti_abuse_rules 读取 per_user/per_device/per_ip 限额，超限返回明确错误码。
 */
export function claim(input: ClaimInput): ClaimResult {
  const db = getDb();
  const requestHash = sha256(JSON.stringify([input.templateId, input.userId, input.idempotencyKey]));

  const tx = db.transaction((): ClaimResult => {
    // 1) 幂等命中：直接返回首次结果
    const cached = db
      .prepare('SELECT response_json FROM idempotency_records WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as any;
    if (cached) {
      return { ...(JSON.parse(cached.response_json) as ClaimResult), replay: true };
    }
    if (!input.idempotencyKey) err(400, '缺少幂等键', 'MISSING_IDEMPOTENCY_KEY');

    // 2) 模板与活动时间窗校验
    const tpl = getTemplate(input.templateId);
    const t = now();
    if (tpl.status === 'paused') err(409, '活动已暂停', 'TEMPLATE_PAUSED');
    if (tpl.status === 'ended') err(409, '活动已结束', 'TEMPLATE_ENDED');
    if (t < tpl.start_at) err(409, '活动尚未开始', 'TEMPLATE_NOT_STARTED');
    if (t > tpl.end_at) err(409, '活动已结束', 'TEMPLATE_ENDED');

    // 3) 业务限领（per_user，始终生效）+ 防刷频控（受 enabled 开关控制）
    const uCount = (db
      .prepare('SELECT COUNT(*) AS n FROM claim_records WHERE template_id=? AND user_id=?')
      .get(input.templateId, input.userId) as any).n;
    if (uCount >= tpl.per_user) err(409, '超过该模板的单人领取上限', 'CLAIM_PER_USER_EXCEEDED');

    const rule = db.prepare('SELECT * FROM anti_abuse_rules WHERE template_id = ?').get(input.templateId) as any;
    if (rule?.enabled) {
      if (uCount >= rule.per_user) err(429, '超过单用户限领数量', 'CLAIM_LIMIT_USER');
      if (input.deviceId) {
        const dCount = (db
          .prepare('SELECT COUNT(*) AS n FROM claim_records WHERE template_id=? AND device_id=?')
          .get(input.templateId, input.deviceId) as any).n;
        if (dCount >= rule.per_device) err(429, '超过单设备限领数量', 'CLAIM_LIMIT_DEVICE');
      }
      if (input.ip) {
        const ipCount = (db
          .prepare('SELECT COUNT(*) AS n FROM claim_records WHERE template_id=? AND ip=?')
          .get(input.templateId, input.ip) as any).n;
        if (ipCount >= rule.per_ip) err(429, '超过单 IP 限领数量', 'CLAIM_LIMIT_IP');
      }
    }

    // 4) 原子扣库存（防超发核心）
    const invResult = db
      .prepare('UPDATE inventory SET claimed = claimed + 1 WHERE template_id = ? AND claimed < total')
      .run(input.templateId);
    if (invResult.changes !== 1) err(409, '库存不足', 'INSUFFICIENT_STOCK');

    // 5) 生成券实例（code 唯一，冲突时重试）
    let code = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = generateCode();
      const exists = db.prepare('SELECT 1 FROM coupon_instances WHERE code = ?').get(candidate);
      if (!exists) { code = candidate; break; }
    }
    if (!code) err(500, '券码生成失败', 'INTERNAL_ERROR');

    const instanceId = newId('cpn_');
    db.prepare(
      `INSERT INTO coupon_instances
        (id, code, template_id, activity_id, user_id, status, idempotency_key, device_id, ip, claimed_at)
       VALUES (?, ?, ?, ?, ?, 'unused', ?, ?, ?, ?)`,
    ).run(
      instanceId, code, input.templateId, tpl.activity_id, input.userId,
      input.idempotencyKey, input.deviceId ?? null, input.ip ?? null, t,
    );
    db.prepare(
      `INSERT INTO claim_records
        (id, template_id, user_id, instance_id, idempotency_key, device_id, ip, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('claim_'), input.templateId, input.userId, instanceId,
      input.idempotencyKey, input.deviceId ?? null, input.ip ?? null, t,
    );

    const result: ClaimResult = {
      instanceId, code, templateId: input.templateId, activityId: tpl.activity_id,
      status: 'unused', claimedAt: t,
    };
    db.prepare(
      `INSERT INTO idempotency_records (idempotency_key, operation, request_hash, response_json, created_at)
       VALUES (?, 'claim', ?, ?, ?)`,
    ).run(input.idempotencyKey, requestHash, JSON.stringify(result), t);
    db.prepare(
      `INSERT INTO operation_logs (id, coupon_code, user_id, activity_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, 'CLAIM', ?, ?)`,
    ).run(newId('log_'), code, input.userId, tpl.activity_id, JSON.stringify({ deviceId: input.deviceId, ip: input.ip }), t);
    return result;
  });

  return tx();
}
