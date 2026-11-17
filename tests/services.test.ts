import { describe, it, expect, beforeEach } from 'vitest';
import './setup.js';
import { getDb } from '../src/db/index.js';
import { createTemplate, getTemplate, getInventory, updateAntiAbuseRules } from '../src/services/templateService.js';
import { claim } from '../src/services/claimService.js';
import { batchClaim } from '../src/services/batchService.js';
import {
  redeem, refund, getCoupon, getCouponByCode, queryCoupons, queryLogs,
} from '../src/services/redemptionService.js';
import { scanExpired } from '../src/jobs/expireScanner.js';
import { newId, sha256, generateCode, HttpError, now } from '../src/utils/index.js';

function makeTpl(overrides: any = {}) {
  return createTemplate({
    name: '测试券', activityId: 'act-' + newId(''), total: 5, discount: 100,
    perUser: 3, startAt: now() - 1000, endAt: now() + 3600_000, ...overrides,
  }, 'admin');
}
function claimOne(tplId: string, i: number, more: any = {}) {
  return claim({ templateId: tplId, userId: `u${i}`, idempotencyKey: newId('k_'), deviceId: `d${i}`, ip: `1.1.1.${i}`, ...more });
}
function code(c: any): HttpError | any { return c; }

describe('工具函数', () => {
  it('newId 带前缀且唯一', () => {
    expect(newId('x_')).toMatch(/^x_/);
    expect(newId()).not.toBe(newId());
  });
  it('sha256 生成 64 位十六进制', () => {
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('abc')).toBe(sha256('abc'));
  });
  it('generateCode 格式为 XXX-XXX-XXX 且无易混淆字符', () => {
    const c = generateCode();
    expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(c).not.toMatch(/[ILO01]/);
  });
  it('HttpError 携带 status/code', () => {
    const e = new HttpError(409, 'x', 'Y');
    expect(e.status).toBe(409);
    expect(e.code).toBe('Y');
  });
});

describe('券模板与库存', () => {
  it('创建模板并生成库存与默认规则', () => {
    const tpl = makeTpl({ total: 7 });
    expect(tpl.id).toMatch(/^tpl_/);
    const inv = getInventory(tpl.id);
    expect(inv.total).toBe(7);
    expect(inv.claimed).toBe(0);
    expect(inv.remaining).toBe(7);
    const rule = getDb().prepare('SELECT * FROM anti_abuse_rules WHERE template_id=?').get(tpl.id) as any;
    expect(rule).toBeTruthy();
  });
  it('总量非法抛错', () => {
    expect(() => makeTpl({ total: 0 })).toThrow();
    expect(() => makeTpl({ total: -1 })).toThrow();
  });
  it('时间范围非法抛错', () => {
    expect(() => makeTpl({ startAt: 1000, endAt: 500 })).toThrow();
  });
  it('模板不存在抛错', () => {
    expect(() => getTemplate('nope')).toThrow();
    expect(() => getInventory('nope')).toThrow();
  });
  it('更新防刷规则', () => {
    const tpl = makeTpl();
    const r = updateAntiAbuseRules(tpl.id, { perUser: 9, perDevice: 8, perIp: 7, enabled: false });
    expect(r.per_user).toBe(9);
    expect(r.per_device).toBe(8);
    expect(r.enabled).toBe(0);
    const r2 = updateAntiAbuseRules(tpl.id, {});
    expect(r2.per_user).toBe(9);
  });
  it('更新不存在模板的规则抛错', () => {
    expect(() => updateAntiAbuseRules('nope', {})).toThrow();
  });
});

describe('领券：防超发', () => {
  it('库存耗尽后拒绝，恰好发完', () => {
    const tpl = makeTpl({ total: 3, perUser: 10 });
    getDb().prepare('UPDATE anti_abuse_rules SET enabled=0 WHERE template_id=?').run(tpl.id);
    const okCount = [0, 1, 2].map(i => claimOne(tpl.id, i)).filter(Boolean).length;
    expect(okCount).toBe(3);
    expect(() => claimOne(tpl.id, 3)).toThrow(/库存不足/);
    expect(getInventory(tpl.id).claimed).toBe(3);
  });
  it('券码唯一', () => {
    const tpl = makeTpl({ total: 20, perUser: 30 });
    getDb().prepare('UPDATE anti_abuse_rules SET enabled=0 WHERE template_id=?').run(tpl.id);
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add(claimOne(tpl.id, i).code);
    expect(codes.size).toBe(20);
  });
});

describe('领券：幂等', () => {
  it('同一幂等键重复 3 次只成功 1 次且返回同一结果', () => {
    const tpl = makeTpl();
    const input = { templateId: tpl.id, userId: 'same', idempotencyKey: 'fixed-key', deviceId: 'dev', ip: '9.9.9.9' };
    const r1 = claim(input);
    const r2 = claim(input);
    const r3 = claim(input);
    expect(r2.code).toBe(r1.code);
    expect(r3.code).toBe(r1.code);
    expect(r2.replay).toBe(true);
    expect(r3.replay).toBe(true);
    expect(getInventory(tpl.id).claimed).toBe(1);
  });
  it('缺少幂等键抛错', () => {
    const tpl = makeTpl();
    expect(() => claim({ templateId: tpl.id, userId: 'u', idempotencyKey: '' })).toThrow();
  });
});

describe('领券：防刷与业务限领', () => {
  it('业务 per_user 超限返回 CLAIM_PER_USER_EXCEEDED', () => {
    const tpl = makeTpl({ total: 10, perUser: 2 });
    getDb().prepare('UPDATE anti_abuse_rules SET enabled=0 WHERE template_id=?').run(tpl.id);
    claim({ templateId: tpl.id, userId: 'u', idempotencyKey: newId('k'), deviceId: 'd1', ip: '1.1.1.1' });
    claim({ templateId: tpl.id, userId: 'u', idempotencyKey: newId('k'), deviceId: 'd2', ip: '2.2.2.2' });
    try {
      claim({ templateId: tpl.id, userId: 'u', idempotencyKey: newId('k'), deviceId: 'd3', ip: '3.3.3.3' });
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.code).toBe('CLAIM_PER_USER_EXCEEDED');
    }
  });
  it('设备超限返回 CLAIM_LIMIT_DEVICE', () => {
    const tpl = makeTpl({ total: 10, perUser: 10 });
    updateAntiAbuseRules(tpl.id, { perDevice: 1, perUser: 10, perIp: 10 });
    claim({ templateId: tpl.id, userId: 'a', idempotencyKey: newId('k'), deviceId: 'SAME', ip: '1.1.1.1' });
    try {
      claim({ templateId: tpl.id, userId: 'b', idempotencyKey: newId('k'), deviceId: 'SAME', ip: '2.2.2.2' });
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.code).toBe('CLAIM_LIMIT_DEVICE');
    }
  });
  it('IP 超限返回 CLAIM_LIMIT_IP', () => {
    const tpl = makeTpl({ total: 10, perUser: 10 });
    updateAntiAbuseRules(tpl.id, { perDevice: 10, perUser: 10, perIp: 1 });
    claim({ templateId: tpl.id, userId: 'a', idempotencyKey: newId('k'), deviceId: 'd1', ip: 'SAMEIP' });
    try {
      claim({ templateId: tpl.id, userId: 'b', idempotencyKey: newId('k'), deviceId: 'd2', ip: 'SAMEIP' });
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.code).toBe('CLAIM_LIMIT_IP');
    }
  });
  it('用户频控超限返回 CLAIM_LIMIT_USER', () => {
    const tpl = makeTpl({ total: 10, perUser: 10 });
    updateAntiAbuseRules(tpl.id, { perUser: 1, perDevice: 10, perIp: 10 });
    claim({ templateId: tpl.id, userId: 'u', idempotencyKey: newId('k'), deviceId: 'd1', ip: '1.1.1.1' });
    try {
      claim({ templateId: tpl.id, userId: 'u', idempotencyKey: newId('k'), deviceId: 'd2', ip: '2.2.2.2' });
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.code).toBe('CLAIM_LIMIT_USER');
    }
  });
  it('活动未开始/已结束/暂停拒绝', () => {
    const future = makeTpl({ startAt: now() + 100000, endAt: now() + 200000 });
    expect(() => claim({ templateId: future.id, userId: 'u', idempotencyKey: newId('k') })).toThrow(/尚未开始/);
    const past = makeTpl({ startAt: now() - 200000, endAt: now() - 100000 });
    expect(() => claim({ templateId: past.id, userId: 'u', idempotencyKey: newId('k') })).toThrow(/结束/);
    const paused = makeTpl();
    getDb().prepare("UPDATE coupon_templates SET status='paused' WHERE id=?").run(paused.id);
    expect(() => claim({ templateId: paused.id, userId: 'u', idempotencyKey: newId('k') })).toThrow(/暂停/);
    const ended = makeTpl();
    getDb().prepare("UPDATE coupon_templates SET status='ended' WHERE id=?").run(ended.id);
    expect(() => claim({ templateId: ended.id, userId: 'u', idempotencyKey: newId('k') })).toThrow(/结束/);
  });
});

describe('核销与退券', () => {
  it('核销 unused->used，重复订单拒绝', () => {
    const tpl = makeTpl();
    const c = claimOne(tpl.id, 0);
    expect(redeem({ code: c.code, userId: 'u', orderNo: 'O1' }).status).toBe('used');
    try {
      redeem({ code: c.code, userId: 'u', orderNo: 'O1' });
      expect.fail('should throw');
    } catch (e: any) {
      expect(['COUPON_ALREADY_USED', 'ORDER_ALREADY_USED']).toContain(e.code);
    }
  });
  it('核销不存在的券 / 已过期 / 已退款拒绝', () => {
    expect(() => redeem({ code: 'nope', userId: 'u', orderNo: 'O' })).toThrow();
    const tpl = makeTpl();
    const c1 = claimOne(tpl.id, 0);
    getDb().prepare("UPDATE coupon_instances SET status='expired' WHERE id=?").run(c1.instanceId);
    expect(() => redeem({ code: c1.code, userId: 'u', orderNo: 'O2' })).toThrow(/过期/);
    const c2 = claimOne(tpl.id, 1);
    getDb().prepare("UPDATE coupon_instances SET status='refunded' WHERE id=?").run(c2.instanceId);
    expect(() => redeem({ code: c2.code, userId: 'u', orderNo: 'O3' })).toThrow();
  });
  it('used->非used 状态不能重复退券', () => {
    const tpl = makeTpl();
    const c = claimOne(tpl.id, 0);
    expect(() => refund({ code: c.code })).toThrow(/不允许退券/);
  });
  it('退券回补库存：claimed-1 redeemed-1 refunded+1', () => {
    const tpl = makeTpl();
    const c = claimOne(tpl.id, 0);
    redeem({ code: c.code, userId: 'u', orderNo: 'O-R' });
    expect(getInventory(tpl.id).redeemed).toBe(1);
    const r = refund({ code: c.code, operator: 'admin' });
    expect(r.status).toBe('refunded');
    const inv = getInventory(tpl.id);
    expect(inv.claimed).toBe(0);
    expect(inv.redeemed).toBe(0);
    expect(inv.refunded).toBe(1);
    expect(() => refund({ code: c.code })).toThrow(/已退券/);
  });
  it('退券不存在的券抛错', () => {
    expect(() => refund({ code: 'nope' })).toThrow();
  });
  it('券查询与券码查询', () => {
    const tpl = makeTpl();
    const c = claimOne(tpl.id, 0);
    expect(getCoupon(c.instanceId)).toBeTruthy();
    expect(getCouponByCode(c.code).id).toBe(c.instanceId);
    expect(getCouponByCode('nope')).toBeUndefined();
    expect(queryCoupons({ code: c.code }).length).toBe(1);
    expect(queryCoupons({ activityId: tpl.activity_id }).length).toBeGreaterThanOrEqual(1);
    expect(queryCoupons({ userId: 'u0' }).length).toBeGreaterThanOrEqual(1);
    expect(queryCoupons({ status: 'unused' }).length).toBeGreaterThanOrEqual(1);
    expect(queryCoupons({ limit: 2 }).length).toBeLessThanOrEqual(2);
  });
  it('日志检索按券码/用户/活动', () => {
    const tpl = makeTpl();
    const c = claimOne(tpl.id, 0);
    expect(queryLogs({ code: c.code }).length).toBeGreaterThanOrEqual(1);
    expect(queryLogs({ userId: 'u0' }).length).toBeGreaterThanOrEqual(1);
    expect(queryLogs({ activityId: tpl.activity_id }).length).toBeGreaterThanOrEqual(1);
    expect(queryLogs({}).length).toBeGreaterThanOrEqual(1);
  });
});

describe('过期扫描', () => {
  it('扫描过期券并回补库存', () => {
    // 模板已结束，无法再领券；直接插入一张 unused 券并增加库存计数
    const tpl = makeTpl({ startAt: now() - 100000, endAt: now() - 1000 });
    const cid = newId('cpn_');
    const code = generateCode();
    const db = getDb();
    db.prepare(`INSERT INTO coupon_instances (id,code,template_id,activity_id,user_id,status,claimed_at)
      VALUES (?,?,?,?,?,'unused',?)`).run(cid, code, tpl.id, tpl.activity_id, 'u0', now() - 50000);
    db.prepare('UPDATE inventory SET claimed=1 WHERE template_id=?').run(tpl.id);
    expect(getInventory(tpl.id).claimed).toBe(1);
    const r = scanExpired();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(getCoupon(cid).status).toBe('expired');
    expect(getInventory(tpl.id).claimed).toBe(0);
    expect(getInventory(tpl.id).expired).toBe(1);
    // 再扫一次无新增（幂等）
    const r2 = scanExpired();
    expect(r2.expired).toBeLessThanOrEqual(r.expired);
  });
});

describe('批量发放', () => {
  it('批量成功与部分失败汇总', () => {
    const tpl = makeTpl({ total: 2, perUser: 10 });
    getDb().prepare('UPDATE anti_abuse_rules SET enabled=0 WHERE template_id=?').run(tpl.id);
    const r = batchClaim(tpl.id, [
      { userId: 'b0', idempotencyKey: newId('k') },
      { userId: 'b1', idempotencyKey: newId('k') },
      { userId: 'b2', idempotencyKey: newId('k') },
    ]);
    expect(r.total).toBe(3);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results[2].error).toBe('INSUFFICIENT_STOCK');
  });
  it('空批量与超限批量抛错', () => {
    const tpl = makeTpl();
    expect(() => batchClaim(tpl.id, [])).toThrow();
    expect(() => batchClaim(tpl.id, Array.from({ length: 1001 }, (_, i) => ({ userId: String(i), idempotencyKey: newId('k') })))).toThrow();
  });
});
