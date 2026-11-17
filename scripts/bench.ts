import { getDb, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createTemplate } from '../src/services/templateService.js';
import { claim } from '../src/services/claimService.js';
import { newId, now } from '../src/utils/index.js';

/**
 * 防超发压测（验收标准 #3）：
 * 1 万张券，3 万个不同幂等键/用户的领取请求，成功数必须恰好 10000，无超发。
 *
 * 说明：better-sqlite3 为同步单连接，Node 事件循环上一次只执行一个事务；
 * 压测脚本用紧凑循环模拟 3 万并发提交——这与真实 HTTP 并发在 SQLite 层
 * 的串行化效果一致（事务级原子条件更新 claimed<total）。
 * 若要多进程真实 HTTP 压测，可用 autocannon -c 50 打 /api/coupons/claims 接口。
 */
const TOTAL = 10_000;
const REQUESTS = 30_000;
const t0 = Date.now();

migrate();
const db = getDb();
const tpl = createTemplate({
  name: '压测-1万券', activityId: 'bench-act', total: TOTAL, discount: 100,
  perUser: REQUESTS, // 关闭业务限领干扰（每人可领多次），聚焦库存原子性
  startAt: now() - 1000, endAt: now() + 3600_000,
}, 'admin');
// 关闭防刷频控，确保只测库存
db.prepare('UPDATE anti_abuse_rules SET enabled=0 WHERE template_id=?').run(tpl.id);

let success = 0;
let insufficient = 0;
let otherErrors = 0;
const codeSet = new Set<string>();

for (let i = 0; i < REQUESTS; i++) {
  try {
    const r = claim({
      templateId: tpl.id,
      userId: `bench_u_${i}`,
      idempotencyKey: newId('bk_'),
      deviceId: `dev_${i}`,
      ip: `10.0.${(i >> 8) & 255}.${i & 255}`,
    });
    success++;
    codeSet.add(r.code);
  } catch (e: any) {
    if (e?.code === 'INSUFFICIENT_STOCK') insufficient++;
    else otherErrors++;
  }
}

const inv = db.prepare('SELECT * FROM inventory WHERE template_id=?').get(tpl.id) as any;
const elapsed = Date.now() - t0;
const pass = success === TOTAL && inv.claimed === TOTAL && codeSet.size === TOTAL && insufficient === REQUESTS - TOTAL;

console.log('\n===== 防超发压测结果 =====');
console.log(`请求总数        : ${REQUESTS}`);
console.log(`券总量          : ${TOTAL}`);
console.log(`成功领取        : ${success}`);
console.log(`库存不足被拒    : ${insufficient}`);
console.log(`其他错误        : ${otherErrors}`);
console.log(`唯一券码数      : ${codeSet.size}`);
console.log(`库存 claimed    : ${inv.claimed} / ${inv.total}`);
console.log(`耗时            : ${elapsed} ms  (${(REQUESTS / (elapsed / 1000)).toFixed(0)} req/s)`);
console.log(`结论            : ${pass ? '✅ 通过：成功数恰好 1 万，无超发' : '❌ 失败'}`);
console.log('==========================\n');

closeDb();
process.exit(pass ? 0 : 1);
