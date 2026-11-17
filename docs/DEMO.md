# 体验路径与录屏脚本（3 分钟）

验收标准 #11：覆盖领券成功、超领拦截、核销、退券回补四项。

## 已录制的验收演示视频

**[`docs/demo.mp4`](demo.mp4)** — 1920×1080 / H.264 / 30fps / **3 分 00 秒**（180.13 s）。

录制方式：启动服务后打开 `http://localhost:3000/demo` 交互式 Demo 页，依次点击 6 张卡片的按钮，页面在每个操作后回显真实 HTTP 状态码与响应 JSON；右上角有「步骤 N/5」标注条、点击目标高亮圈与底部字幕。画面为纯浏览器渲染，无终端依赖，JSON 字号 15px 在 1080p 下清晰可读。

| 时间点 | 演示动作 | 画面证据（实测响应） |
| --- | --- | --- |
| 00:30 | 步骤1 登录鉴权 | `200` + 完整 JWT + `user{id,username,role}` |
| 00:44 | 步骤2 领券成功 | `200`，`code: H4M4-TEU2-GGAG`，`status: unused`，幂等重放 `false` |
| 01:02 | 步骤3 配置限领规则 | `200`，`per_user:1 / per_device:1 / per_ip:10 / enabled:1` |
| 01:18 | 步骤3 同用户换设备再领 | **`429 CLAIM_LIMIT_USER`**「超过单用户限领数量」+ 拦截结果栏 |
| 01:32 | 步骤3 换账号同设备再领 | **`429 CLAIM_LIMIT_DEVICE`**「超过单设备限领数量」 |
| 01:32 | 步骤3 防超发（1 张库存连抢 2 次） | 第 1 次 `200`，第 2 次 **`409 INSUFFICIENT_STOCK`**「库存不足」；库存核对 `total 1 / claimed 1 / remaining 0`「恰好售出 1 / 1 张，无超发」 |
| 01:46 | 步骤4 核销 | `200`，`status: used`，`order_no: ORDER-DEMO-001` |
| 02:00 | 步骤4 同订单号换新券再核销 | **`409 ORDER_ALREADY_USED`**「该订单号已使用过优惠券」 |
| 02:20 | 步骤5 管理员退券 | `200`，`status: refunded`，`refunded_at` 已置位 |
| 02:35 | 步骤5 退券后库存核对 | `claimed −1 (2→1)`、`redeemed −1 (1→0)`、`refunded +1 (0→1)`，`remaining` 回到 119 → 回补规则生效 |
| 02:52 | 步骤6 审计日志 | `200`，按活动检索返回 REFUND / CLAIM / REDEEM 三条记录 |

> 说明：步骤4 的「同订单重复核销」用的是**换一张新券、沿用同一订单号**——因为重复核销同一张券会先命中券状态检查，返回的是 `COUPON_ALREADY_USED` 而不是 `ORDER_ALREADY_USED`，两者分别对应「券不可复用」和「订单不可复用」两条不同约束。

## 准备

```bash
npm install && npm run seed && npm run build && npm start
```

账号：`user1 / Test@123456`、`admin / Admin@123456`。演示活动 `activityId=demo-activity`（120 张券）。先登录拿 token：

```bash
B=http://localhost:3000/api
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"Test@123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
```

## 步骤 1：领券成功（约 30s）

```bash
curl -s -X POST $B/claims -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"templateId":"<演示模板ID>","idempotencyKey":"demo-key-1","deviceId":"dev-1"}'
```

录制要点：展示返回的 `code`（券码）、`status:unused`、`claimedAt`。模板 ID 可在 `GET /api/templates/demo-activity` 报错信息旁的数据库或用 admin 登录后 `GET /api/coupons?activityId=demo-activity` 取 `template_id`。

## 步骤 2：幂等 + 超领拦截（约 40s）

```bash
# 幂等：同一 key 再请求 2 次，返回同一券码、replay=true
curl -s -X POST $B/claims -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"templateId":"<模板ID>","idempotencyKey":"demo-key-1","deviceId":"dev-1"}'

# 超领：用同一设备 dev-1 连领，触发设备限领 CLAIM_LIMIT_DEVICE
curl -s -X POST $B/claims -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"templateId":"<模板ID>","idempotencyKey":"demo-key-2","deviceId":"dev-1"}'
```

录制要点：先展示 replay=true（幂等），再展示 `CLAIM_LIMIT_DEVICE`（防刷超领拦截）。

## 步骤 3：核销（约 30s）

```bash
curl -s -X POST $B/redemptions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"<步骤1的券码>","orderNo":"ORDER-DEMO-001"}'
# 重复核销同订单 → ORDER_ALREADY_USED
curl -s -X POST $B/redemptions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"<步骤1的券码>","orderNo":"ORDER-DEMO-001"}'
```

录制要点：第一次 status 变 used，第二次返回 ORDER_ALREADY_USED。

## 步骤 4：退券回补（约 40s）

```bash
# 查看退券前库存
curl -s $B/templates/<模板ID>/inventory -H "Authorization: Bearer $TOKEN"

# 管理员退券
curl -s -X POST $B/refunds -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"code":"<步骤1的券码>","reason":"用户取消订单"}'

# 查看退券后库存：claimed -1, refunded +1
curl -s $B/templates/<模板ID>/inventory -H "Authorization: Bearer $TOKEN"
```

录制要点：对比退券前后库存，展示 claimed 减 1、refunded 加 1（回补规则生效），券状态变 refunded。

## 步骤 5（可选）：过期扫描手动触发

```bash
curl -s -X POST $B/jobs/expire-scan -H "Authorization: Bearer $ADMIN"
```

---

录制建议：终端字体调大、窗口最大化，每个响应用 `| jq .`（或 node pp）格式化，1080p，约 3 分钟。视频保存到 `docs/demo.mp4` 随交付物提交。

> 推荐直接用交互式 Demo 页录制：它已经把上面 5 步串成一键可点的流程，并内置步骤标注，效果优于手动 curl 录屏。
