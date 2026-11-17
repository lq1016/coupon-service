import { getDb } from '../db/index.js';
import { newId, now, HttpError } from '../utils/index.js';

export interface ExpireResult {
  scanned: number;
  expired: number;
  templateIds: string[];
}

/**
 * 过期扫描：把已过活动结束时间、仍为 unused 的券实例置为 expired，
 * 并回补库存：claimed-1、expired+1（过期券不再占用可领取库存）。
 * 提供手动触发入口（接口）与定时自动触发。
 */
export function scanExpired(): ExpireResult {
  const db = getDb();
  const t = now();
  const tx = db.transaction((): ExpireResult => {
    const candidates = db
      .prepare(
        `SELECT ci.id, ci.template_id, ci.code, ci.user_id, ci.activity_id
         FROM coupon_instances ci
         JOIN coupon_templates t ON t.id = ci.template_id
         WHERE ci.status = 'unused' AND t.end_at < ?`,
      )
      .all(t) as any[];

    const templateIds = new Set<string>();
    for (const c of candidates) {
      db.prepare("UPDATE coupon_instances SET status='expired', expired_at=? WHERE id=? AND status='unused'").run(t, c.id);
      db.prepare(
        `UPDATE inventory SET claimed = MAX(claimed-1, 0), expired = expired+1 WHERE template_id = ?`,
      ).run(c.template_id);
      db.prepare(
        `INSERT INTO operation_logs (id, coupon_code, user_id, activity_id, action, detail, created_at)
         VALUES (?, ?, ?, ?, 'EXPIRE', ?, ?)`,
      ).run(newId('log_'), c.code, c.user_id, c.activity_id, 'scheduled scan', t);
      templateIds.add(c.template_id);
    }
    return { scanned: candidates.length, expired: candidates.length, templateIds: [...templateIds] };
  });
  return tx();
}

let timer: NodeJS.Timeout | null = null;

export function startExpireScanner(intervalMs: number): void {
  if (intervalMs <= 0 || timer) return;
  timer = setInterval(() => {
    try { scanExpired(); } catch { /* 扫描失败不影响服务 */ }
  }, intervalMs);
  timer.unref?.();
}

export function stopExpireScanner(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export function manualTrigger(): ExpireResult {
  try {
    return scanExpired();
  } catch (e) {
    throw new HttpError(500, '过期扫描失败', 'INTERNAL_ERROR');
  }
}
