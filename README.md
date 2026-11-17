# 优惠券发放与核销服务

大促场景的优惠券服务：发券、领券、核销、退券全链路，重点解决**超发、脚本刷券、幂等、四态状态机与退券回补**。基于 Node.js 22 + TypeScript + Express + SQLite（better-sqlite3），单进程即可正确防超发，无需 Redis/分布式锁。

## 功能与验收对照

| 验收项 | 实现情况 |
| --- | --- |
| 1. 接口 ≥8 个 + OpenAPI | 13 个接口（模板创建/详情、库存、防刷配置、领券、批量发放、核销、退券、券查询、券码查询、日志、过期扫描、错误码），见 [`docs/openapi.yaml`](docs/openapi.yaml) |
| 2. 数据库 ≥6 张表 | 10 张表：users、coupon_templates、inventory、coupon_instances、claim_records、redemption_records、refund_records、idempotency_records、anti_abuse_rules、operation_logs；脚本 `src/db/schema.ts`（等价 SQL `src/db/schema.sql`） |
| 3. 防超发 | 条件原子更新 `UPDATE inventory SET claimed=claimed+1 WHERE claimed<total` + 事务；3 万并发压测成功恰好 1 万，见 [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| 4. 幂等 | 幂等键查结果缓存 + claim_records 唯一键双保险；同键重复 3 次只成功 1 次、返回同一券码 |
| 5. 防刷 | 每模板可配 per_user/per_device/per_ip 限额（管理员接口动态配置），超限返回 CLAIM_LIMIT_* 明确错误码 |
| 6. 状态机 | unused/used/expired/refunded 四态完整；退券回补规则见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；过期定时扫描 + 手动触发入口 |
| 7. 错误码 ≥20 + 日志检索 + 覆盖率 ≥80% | 30+ 错误码见 [`docs/ERROR_CODES.md`](docs/ERROR_CODES.md)；日志按券码/用户/活动检索；覆盖率见 [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) |
| 8. 源码 | 完整可编译 TypeScript，git 提交历史，无硬编码密钥，附建表脚本与依赖清单 |
| 9. 可运行 | 干净机器按 README 步骤即可启动 |
| 10. 可体验 | 测试环境 + 2 个测试账号 + 120 条演示数据 |
| 11. 体验路径 | 5 步清单 + 录屏脚本见 [`docs/DEMO.md`](docs/DEMO.md) |
| 12. 修改与缺陷修复 | 含 2 轮修改提交，验收后 7 天内修复缺陷（见 [`CHANGELOG.md`](CHANGELOG.md)） |

## 快速开始（干净机器）

环境要求：Node.js ≥ 20（推荐 22），npm ≥ 9。SQLite 嵌入式，无需单独安装。

```bash
# 1. 安装依赖
npm install

# 2. 配置（可选，默认 SQLite + 本地文件）
cp .env.example .env

# 3. 建表 + 初始化 2 个账号 + 120 条演示数据
npm run seed

# 4. 编译并启动
npm run build
npm start
```

访问 `http://localhost:3000/api/health` 应返回 `{"ok":true,"data":{"status":"ok",...}}`。

> 常规磁盘默认 `DB_JOURNAL_MODE=WAL`。若部署在 FUSE/网络盘不支持 WAL，在 `.env` 设 `DB_JOURNAL_MODE=MEMORY`（数据仍落 `.db` 文件，仅回滚日志在内存）。

## 测试账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| user1 | Test@123456 | user |
| admin | Admin@123456 | admin |

演示活动 `activityId = demo-activity`，含 120 张 unused 券。

## 核心设计

**防超发（原子条件更新）**：扣库存不是「先查再扣」，而是一条原子 SQL：`UPDATE inventory SET claimed=claimed+1 WHERE template_id=? AND claimed<total`，`changes()===0` 即已售罄。better-sqlite3 单连接同步事务保证同一时刻只有一个领取在改库存，1 万张券绝不会被领走 10001 张。

**幂等**：每次领券要求客户端传全局唯一的 `idempotencyKey`。先查 `idempotency_records`，命中就返回首次结果（`replay=true`）；写入时 `claim_records.idempotency_key` 唯一约束作第二道防线。

**防刷**：每个模板有 `anti_abuse_rules`，可按 user/device/ip 配置领取上限，超限分别返回 `CLAIM_LIMIT_USER` / `CLAIM_LIMIT_DEVICE` / `CLAIM_LIMIT_IP`。管理员可通过 `PUT /api/templates/{id}/anti-abuse` 动态调整。

**状态机与退券回补**：四态流转为 unused→used（核销）、used→refunded（退券）、unused→expired（过期扫描）。退券时 `inventory.claimed-1、refunded+1、redeemed-1`，券实例置 refunded；过期时 claimed-1、expired+1。规则详见 ARCHITECTURE.md。

## 接口一览

所有业务接口需 `Authorization: Bearer <token>`（登录获取）。

| # | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 1 | POST | `/api/templates` | 创建券模板（管理员） |
| 2 | POST | `/api/claims` | 领券（单张，防超发/幂等/防刷） |
| 3 | POST | `/api/redemptions` | 核销 |
| 4 | POST | `/api/refunds` | 退券（管理员，回补库存） |
| 5 | GET | `/api/coupons` | 券查询 |
| 6 | GET | `/api/templates/:id/inventory` | 库存查询 |
| 7 | GET | `/api/logs` | 日志检索 |
| 8 | POST | `/api/claims/batch` | 批量发放（管理员） |
| — | POST | `/api/jobs/expire-scan` | 过期扫描手动触发（管理员） |
| — | PUT | `/api/templates/:id/anti-abuse` | 配置防刷规则（管理员） |

完整请求/响应/错误码见 OpenAPI 文档。

## 测试

```bash
npm test          # 单元测试 + 覆盖率（阈值 statements/functions/lines 80%，branches 70%）
npm run build     # TypeScript 编译
npm run bench     # 防超发压测：1万券/3万请求
```

覆盖率结果见 [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)，压测结果见 [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)。

## 目录结构

```
src/
  app.ts              应用装配
  index.ts            入口 + 过期扫描定时器
  config/             环境变量（无硬编码密钥）
  db/                 10 张表建表脚本与连接
  security/           JWT / 密码哈希 / 错误码表
  middleware/         鉴权与管理员权限
  services/           模板/领券/核销退券/批量 业务逻辑
  jobs/               过期扫描
  routes/             接口定义
tests/                单元测试 + 接口测试
docs/                 OpenAPI / 架构 / 错误码 / 性能 / 体验路径 / 报告
scripts/              seed / bench 压测 / smoke
```

## 安全提示

测试账号密码仅用于本地演示，生产环境请通过环境变量/管理接口创建账号并修改 `JWT_SECRET`；`.env` 不入库（已在 `.gitignore`）。
