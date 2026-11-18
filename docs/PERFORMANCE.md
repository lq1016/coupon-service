# 防超发压测与性能记录

> 本报告由实际运行 `npm run bench` 生成，可复现。

## 测试环境

Node.js v26.13.1 / SQLite（better-sqlite3 12.11.1）/ local。复现：`npm run build && npm run bench`（bench 自建独立模板，不影响演示数据）。

## 防超发压测（验收标准 #3）

```
请求总数        : 30000
券总量          : 10000
成功领取        : 10000
库存不足被拒    : 20000
其他错误        : 0
唯一券码数      : 10000
库存 claimed    : 10000 / 10000
耗时            : 5264 ms  (5699 req/s)
结论            : ✅ 通过：成功数恰好 1 万，无超发
```

关键指标全部达标：成功领取数 = 券总量 = 10000，无第 10001 张被领走；2 万个超额请求全部以 INSUFFICIENT_STOCK 被拒；1 万个成功请求产生 1 万个互不重复的券码。

## 为什么说单进程即可正确防超发

扣库存是单条原子 SQL `UPDATE inventory SET claimed=claimed+1 WHERE claimed<total`：条件与自增在同一语句内完成，不存在「查到有货→别人抢走→自己再扣」的竞态窗口。better-sqlite3 同步单连接 + Node 事件循环使所有领取事务在库存这一步严格串行。压测脚本用紧凑循环模拟 3 万次并发提交，效果与真实 HTTP 并发在 SQLite 层一致。

如需多实例横向扩展，应把扣库存换成 Redis Lua 或 DB 行锁（见 ARCHITECTURE.md）。

## 幂等验证（验收标准 #4）

同一幂等键连续请求 3 次：首次成功扣库存并返回券码，后两次命中幂等缓存返回同一券码且 `replay=true`，库存只扣 1 次。claim_records.idempotency_key 唯一约束作为并发兜底。
