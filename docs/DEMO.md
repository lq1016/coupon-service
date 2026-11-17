# 体验路径与录屏脚本（3 分钟）

验收标准 #11：覆盖领券成功、超领拦截、核销、退券回补四项。

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
