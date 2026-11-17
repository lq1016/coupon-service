import { hashPassword } from '../src/security/password.js';
import { getDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { newId, generateCode, now } from '../src/utils/index.js';
import config from '../src/config/index.js';

/** 初始化 2 个测试账号 + 100+ 条演示数据 */
export function seed(): void {
  migrate();
  const db = getDb();
  const t = now();
  const accounts = [
    { username: 'user1', password: 'Test@123456', role: 'user' },
    { username: 'admin', password: 'Admin@123456', role: 'admin' },
  ];
  for (const a of accounts) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(a.username) as any;
    if (existing) {
      db.prepare('UPDATE users SET password_hash=?, role=?, active=1 WHERE username=?').run(hashPassword(a.password), a.role, a.username);
      console.log(`[seed] 更新测试账号: ${a.username}`);
    } else {
      db.prepare('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)')
        .run(newId('u_'), a.username, hashPassword(a.password), a.role, t);
      console.log(`[seed] 创建测试账号: ${a.username}`);
    }
  }
  const user1 = (db.prepare('SELECT id FROM users WHERE username=?').get('user1') as any).id;

  // 幂等：已有演示模板则跳过
  const demo = db.prepare("SELECT id FROM coupon_templates WHERE activity_id='demo-activity' LIMIT 1").get() as any;
  if (!demo) {
    const total = config.demoCouponCount;
    const tplId = newId('tpl_');
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO coupon_templates (id,name,activity_id,total,discount,per_user,start_at,end_at,status,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,'active',?,?)`,
      ).run(tplId, '大促满100减20券', 'demo-activity', total, 2000, 5, t - 86_400_000, t + 30 * 86_400_000, 'admin', t);
      db.prepare('INSERT INTO inventory (template_id,total) VALUES (?,?)').run(tplId, total);
      db.prepare(
        `INSERT INTO anti_abuse_rules (id,template_id,per_user,per_device,per_ip,enabled,updated_at)
         VALUES (?,?,?,?,?,1,?)`,
      ).run(newId('rule_'), tplId, 3, 5, 10, t);

      const codes = new Set<string>();
      for (let i = 0; i < total; i++) {
        let code = generateCode();
        while (codes.has(code)) code = generateCode();
        codes.add(code);
        db.prepare(
          `INSERT INTO coupon_instances (id,code,template_id,activity_id,user_id,status,idempotency_key,claimed_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(newId('cpn_'), code, tplId, 'demo-activity', null, 'unused', null, null);
      }
    });
    tx();
    console.log(`[seed] 已创建演示模板与 ${total} 条券实例数据`);
  } else {
    console.log('[seed] 演示数据已存在，跳过');
  }

  console.log('\n演示模板 activityId = demo-activity');
  console.log('测试账号:');
  console.log('  user1 / Test@123456  (user)');
  console.log('  admin / Admin@123456 (admin)');
  console.log(`  user1 id = ${user1}`);
}

if (process.argv[1] && /(^|\/)seed(\.ts)?$/.test(process.argv[1])) {
  seed();
}
