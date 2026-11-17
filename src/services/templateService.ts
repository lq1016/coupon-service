import { getDb } from '../db/index.js';
import { newId, now, HttpError } from '../utils/index.js';
import type { ErrorCode } from '../security/errors.js';
import config from '../config/index.js';

export interface CreateTemplateInput {
  name: string;
  activityId: string;
  total: number;
  discount: number;
  perUser?: number;
  startAt: number;
  endAt: number;
}

/** 创建券模板 + 库存 + 默认防刷规则（同一事务） */
export function createTemplate(input: CreateTemplateInput, createdBy?: string): any {
  if (!Number.isInteger(input.total) || input.total <= 0) {
    throw new HttpError(400, '发放总量必须为正整数', 'TOTAL_INVALID');
  }
  if (input.endAt <= input.startAt) {
    throw new HttpError(400, '结束时间必须晚于开始时间', 'INVALID_DATE_RANGE');
  }
  const db = getDb();
  const id = newId('tpl_');
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO coupon_templates
        (id, name, activity_id, total, discount, per_user, start_at, end_at, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id, input.name, input.activityId, input.total, input.discount,
      input.perUser ?? 1, input.startAt, input.endAt, createdBy ?? null, now(),
    );
    db.prepare(`INSERT INTO inventory (template_id, total) VALUES (?, ?)`).run(id, input.total);
    db.prepare(
      `INSERT INTO anti_abuse_rules (id, template_id, per_user, per_device, per_ip, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('rule_'), id,
      config.antiAbuse.perUser, config.antiAbuse.perDevice, config.antiAbuse.perIp, now(),
    );
  });
  tx();
  return getTemplate(id);
}

export function getTemplate(id: string): any {
  const row = getDb().prepare('SELECT * FROM coupon_templates WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, '券模板不存在', 'TEMPLATE_NOT_FOUND' as ErrorCode);
  return row;
}

export function getInventory(templateId: string): any {
  const row = getDb().prepare('SELECT * FROM inventory WHERE template_id = ?').get(templateId) as any;
  if (!row) throw new HttpError(404, '券模板不存在', 'TEMPLATE_NOT_FOUND' as ErrorCode);
  return {
    ...row,
    remaining: row.total - row.claimed,
  };
}

export function updateAntiAbuseRules(
  templateId: string,
  rules: { perUser?: number; perDevice?: number; perIp?: number; enabled?: boolean },
): any {
  const db = getDb();
  getTemplate(templateId);
  const current = db.prepare('SELECT * FROM anti_abuse_rules WHERE template_id = ?').get(templateId) as any;
  if (!current) throw new HttpError(404, '防刷规则不存在', 'ANTI_ABUSE_RULE_NOT_FOUND' as ErrorCode);
  db.prepare(
    `UPDATE anti_abuse_rules SET per_user=?, per_device=?, per_ip=?, enabled=?, updated_at=? WHERE template_id=?`,
  ).run(
    rules.perUser ?? current.per_user,
    rules.perDevice ?? current.per_device,
    rules.perIp ?? current.per_ip,
    rules.enabled === undefined ? current.enabled : rules.enabled ? 1 : 0,
    now(),
    templateId,
  );
  return db.prepare('SELECT * FROM anti_abuse_rules WHERE template_id = ?').get(templateId);
}
