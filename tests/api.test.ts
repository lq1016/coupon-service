import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { hashPassword } from '../src/security/password.js';
import { signToken } from '../src/security/jwt.js';
import { newId, now } from '../src/utils/index.js';

const app = createApp();
let userToken = '';
let adminToken = '';
let templateId = '';

beforeAll(() => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO users (id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)')
    .run(newId('u_'), 'apiuser', hashPassword('Pass@123'), 'user', now());
  db.prepare('INSERT OR REPLACE INTO users (id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)')
    .run(newId('u_'), 'apiadmin', hashPassword('Admin@123'), 'admin', now());
  const u = signToken({ id: 'u1', username: 'apiuser', role: 'user' });
  const a = signToken({ id: 'a1', username: 'apiadmin', role: 'admin' });
  userToken = u; adminToken = a;

  // 造一个模板供接口测试
  templateId = newId('tpl_');
  const t = now();
  db.prepare(`INSERT INTO coupon_templates (id,name,activity_id,total,discount,per_user,start_at,end_at,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,'active',?)`).run(templateId, 'API券', 'api-act', 20, 100, 10, t - 1000, t + 3600000, t);
  db.prepare('INSERT INTO inventory (template_id,total) VALUES (?,?)').run(templateId, 20);
  db.prepare('INSERT INTO anti_abuse_rules (id,template_id,per_user,per_device,per_ip,enabled,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('rule_'), templateId, 10, 10, 10, 1, t);
});

const auth = (t = userToken) => ({ Authorization: `Bearer ${t}` });

describe('鉴权与健康检查', () => {
  it('健康检查无需鉴权', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ok');
  });
  it('登录成功返回 token', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'apiuser', password: 'Pass@123' });
    expect(r.status).toBe(200);
    expect(r.body.data.token).toBeTruthy();
  });
  it('错误密码登录失败', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'apiuser', password: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
  it('参数缺失登录返回 400', async () => {
    const r = await request(app).post('/api/auth/login').send({});
    expect(r.status).toBe(400);
  });
  it('/api/auth/me 返回当前用户', async () => {
    const r = await request(app).get('/api/auth/me').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.username).toBe('apiuser');
  });
  it('无 token 访问业务接口 401', async () => {
    const r = await request(app).get('/api/coupons');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
  it('伪造 token 401', async () => {
    const r = await request(app).get('/api/coupons').set({ Authorization: 'Bearer fake.token.x' });
    expect(r.status).toBe(401);
  });
});

describe('模板与库存接口', () => {
  it('管理员创建模板', async () => {
    const r = await request(app).post('/api/templates').set(auth(adminToken)).send({
      name: '新券', activityId: 'act-new', total: 10, discount: 50, startAt: now() - 1000, endAt: now() + 100000,
    });
    expect(r.status).toBe(201);
    expect(r.body.data.id).toMatch(/^tpl_/);
  });
  it('普通用户创建模板 403', async () => {
    const r = await request(app).post('/api/templates').set(auth()).send({
      name: 'x', activityId: 'y', total: 10, discount: 1, startAt: now(), endAt: now() + 1000,
    });
    expect(r.status).toBe(403);
  });
  it('参数非法 400', async () => {
    const r = await request(app).post('/api/templates').set(auth(adminToken)).send({ name: 'x' });
    expect(r.status).toBe(400);
  });
  it('模板详情与库存查询', async () => {
    expect((await request(app).get(`/api/templates/${templateId}`).set(auth())).status).toBe(200);
    const inv = await request(app).get(`/api/templates/${templateId}/inventory`).set(auth());
    expect(inv.status).toBe(200);
    expect(inv.body.data.remaining).toBeGreaterThanOrEqual(0);
  });
  it('不存在的模板 404', async () => {
    const r = await request(app).get('/api/templates/nope').set(auth());
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });
  it('配置防刷规则', async () => {
    const r = await request(app).put(`/api/templates/${templateId}/anti-abuse`).set(auth(adminToken))
      .send({ perUser: 8, perDevice: 8, perIp: 8, enabled: true });
    expect(r.status).toBe(200);
    expect(r.body.data.per_user).toBe(8);
  });
  it('普通用户配置防刷 403', async () => {
    const r = await request(app).put(`/api/templates/${templateId}/anti-abuse`).set(auth()).send({ perUser: 1 });
    expect(r.status).toBe(403);
  });
});

describe('领券/核销/退券接口', () => {
  let code = '';
  it('领券成功', async () => {
    const r = await request(app).post('/api/claims').set(auth()).send({
      templateId, idempotencyKey: newId('api_'), deviceId: newId('dev_'), ip: '5.5.5.5',
    });
    expect(r.status).toBe(200);
    expect(r.body.data.code).toBeTruthy();
    code = r.body.data.code;
  });
  it('参数缺失 400', async () => {
    const r = await request(app).post('/api/claims').set(auth()).send({});
    expect(r.status).toBe(400);
  });
  it('券查询与券码查询', async () => {
    expect((await request(app).get(`/api/coupons?code=${code}`).set(auth())).body.data.length).toBe(1);
    expect((await request(app).get(`/api/coupons/by-code/${code}`).set(auth())).status).toBe(200);
    expect((await request(app).get('/api/coupons/by-code/nope').set(auth())).status).toBe(404);
    expect((await request(app).get('/api/coupons?status=unused&limit=3').set(auth())).status).toBe(200);
  });
  it('日志检索', async () => {
    const r = await request(app).get(`/api/logs?code=${code}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
  });
  it('核销成功', async () => {
    const r = await request(app).post('/api/redemptions').set(auth()).send({ code, orderNo: newId('ORD_') });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('used');
  });
  it('核销参数缺失 400', async () => {
    const r = await request(app).post('/api/redemptions').set(auth()).send({ code });
    expect(r.status).toBe(400);
  });
  it('管理员退券成功并回补', async () => {
    const r = await request(app).post('/api/refunds').set(auth(adminToken)).send({ code, reason: 'test' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('refunded');
  });
  it('普通用户退券 403', async () => {
    const r = await request(app).post('/api/refunds').set(auth()).send({ code });
    expect(r.status).toBe(403);
  });
  it('批量发放', async () => {
    const r = await request(app).post('/api/claims/batch').set(auth(adminToken)).send({
      templateId, items: [
        { userId: 'x1', idempotencyKey: newId('b_') },
        { userId: 'x2', idempotencyKey: newId('b_') },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.data.succeeded).toBe(2);
  });
  it('批量参数非法 400', async () => {
    const r = await request(app).post('/api/claims/batch').set(auth(adminToken)).send({ templateId, items: [] });
    expect(r.status).toBe(400);
  });
  it('过期扫描手动触发', async () => {
    const r = await request(app).post('/api/jobs/expire-scan').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty('expired');
  });
  it('普通用户触发扫描 403', async () => {
    const r = await request(app).post('/api/jobs/expire-scan').set(auth());
    expect(r.status).toBe(403);
  });
  it('错误码表可见', async () => {
    const r = await request(app).get('/api/error-codes').set(auth());
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).length).toBeGreaterThanOrEqual(20);
  });
});

describe('404', () => {
  it('未知路径 404', async () => {
    const r = await request(app).get('/api/no-such-path').set(auth());
    expect(r.status).toBe(404);
  });
});
