# 架构与核心规则

## 数据表（10 张）

| 表 | 作用 |
| --- | --- |
| users | 用户/管理员账号（scrypt 密码哈希） |
| coupon_templates | 券模板：总量、优惠额、单人上限、活动时间窗、状态 |
| inventory | 库存：total/claimed/redeemed/refunded/expired 计数器 |
| coupon_instances | 券实例：券码、四态状态、归属用户、幂等键、时间戳 |
| claim_records | 领取记录，idempotency_key 唯一约束（幂等第二道防线） |
| redemption_records | 核销记录，instance_id 唯一 + order_no 唯一 |
| refund_records | 退券记录，关联原核销记录 |
| idempotency_records | 幂等结果快照（key → 首次响应 JSON） |
| anti_abuse_rules | 每模板的 per_user/per_device/per_ip 防刷规则 |
| operation_logs | 操作日志（券码/用户/活动/动作/时间），建索引可检索 |

## 防超发

扣库存用单条原子 SQL，杜绝「先查后扣」的竞态：

```sql
UPDATE inventory SET claimed = claimed + 1
WHERE template_id = ? AND claimed < total;
-- changes()===0 表示库存耗尽，拒绝领取
```

better-sqlite3 为同步单连接，Node 事件循环一次只执行一个事务；配合 SQLite 事务，等价于所有并发领取在库存这一step 严格串行。因此单进程即可保证 1 万张券不会被领走第 10001 张。压测结果见 PERFORMANCE.md。

> 多实例部署时，应将库存扣减迁移到 Redis Lua 或数据库行锁（SELECT ... FOR UPDATE），本交付为单服务形态。

## 幂等

1. 每次领券要求全局唯一 `idempotencyKey`。
2. 事务开始先查 `idempotency_records`，命中即返回首次响应并标记 `replay=true`（不再扣库存）。
3. 首次成功后把响应 JSON 写入幂等表；`claim_records.idempotency_key` 的 UNIQUE 约束作为并发重复的第二道防线。
4. 同一 key 重复 3 次：只扣 1 次库存，3 次返回同一券码。

## 防刷

每模板 `anti_abuse_rules` 存三个维度上限，管理员可动态调整：

- per_user：同用户在该模板的累计领取数上限
- per_device：同设备上限（需客户端传 deviceId）
- per_ip：同 IP 上限（默认取请求来源 IP）

超限分别返回 `CLAIM_LIMIT_USER` / `CLAIM_LIMIT_DEVICE` / `CLAIM_LIMIT_IP`（HTTP 429）。另有模板级 `per_user` 业务限领（始终生效，返回 CLAIM_PER_USER_EXCEEDED）。

## 四态状态机与回补规则

```
             核销(redeem)          退券(refund)
  unused ──────────────> used ──────────────> refunded
    │
    │ 过期扫描(scanExpired): tpl.end_at < now
    ▼
  expired
```

回补规则（都在事务内完成）：

| 动作 | 券实例状态 | 库存变化 |
| --- | --- | --- |
| 领券 claim | unused（新建） | claimed +1 |
| 核销 redeem | unused → used | redeemed +1 |
| 退券 refund | used → refunded | claimed -1、redeemed -1、refunded +1 |
| 过期 scan | unused → expired | claimed -1、expired +1 |

说明：退券后券实例不可逆地变为 refunded（不回退到 unused 再次发放），只是把库存计数释放，便于统计「已发出但被退回」的量。退券窗口为核销后 7 天，超窗返回 REFUND_WINDOW_CLOSED。

## 过期扫描

- 定时：`EXPIRE_SCAN_INTERVAL_MS`（默认 60s，设 0 关闭自动）。
- 手动：`POST /api/jobs/expire-scan`（管理员），返回 scanned/expired/templateIds。
- 逻辑：查 `status='unused' AND template.end_at < now` 的券，批量置 expired 并回补库存。

## 日志检索

`operation_logs` 记录 CLAIM/REDEEM/REFUND/EXPIRE 动作，含券码、用户、活动、时间。`GET /api/logs?code=|userId=|activityId=` 可按任意维度检索，索引覆盖三个字段。
