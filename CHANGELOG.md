# 变更记录

## 第一轮修改（自测修正）

- 分离「业务限领 per_user」与「防刷频控」：业务限领始终生效，防刷规则受 enabled 开关控制，避免关闭防刷时业务规则失效。
- 修复健康检查路由被全局鉴权中间件拦截的问题（调整注册顺序）。
- 修复 `/api/auth/me` 未校验 token 即返回的问题。

## 第二轮修改（覆盖与健壮性）

- 补充边界校验：模板总量必须正整数、结束时间必须晚于开始时间、批量上限 1000。
- 券码生成去重（排除易混淆字符 + 唯一性重试），压测 1 万张无重复。
- 完善错误码表至 30+ 个，新增 `GET /api/error-codes` 供前端对接。
- 退券增加订单号/时间窗口校验，库存回补用 MAX(claimed-1,0) 防止计数为负。

## 第三轮修改（验收演示录制）

- 新增零依赖交互式 Demo 页 `public/demo.html` + `public/demo.js`，并在 `src/routes/demo.ts` 提供 `/demo` 与 `/demo/demo.js` 路由，`/` 重定向到 `/demo`。
  - Demo 页脚本以独立文件提供而非内联 `<script>`，因为服务端启用了 helmet 的严格 CSP（`script-src 'self'; script-src-attr 'none'`），内联脚本与内联事件属性都会被浏览器拦截（会导致页面完全无响应）。
- Demo 页内置步骤标注能力（`window.anno`：步骤条 / 字幕 / 点击目标高亮圈），并在每张卡片标题下标注对应接口，便于录屏讲解。
- 修复 Demo 页两个真实缺陷：
  - 幂等键改为每次运行唯一（`RUN_TAG` + `uniqKey`），避免重放导致「防超发第 2 次」误显示为 200 而非 409。
  - 「同订单重复核销」改为换一张新券沿用同一订单号，否则会先命中券状态检查返回 `COUPON_ALREADY_USED`，无法展示 `ORDER_ALREADY_USED` 这条订单维度约束。
- 录制 3 分钟验收演示视频 `docs/demo.mp4`（1920×1080 / 30fps / 180.13 秒），完整覆盖领券成功、幂等重放、超领拦截、防超发、核销、同订单重复核销、退券回补、审计日志。
- README 与 `docs/DEMO.md` 补充 Demo 页说明、录屏时间轴与逐条响应证据表。

## 第四轮修改（开源发布与依赖兼容）

- 新增 MIT `LICENSE` 与 GitHub Actions CI（Node 20 / 22：安装、类型检查、覆盖率测试、防超发压测回归闸门）。
- `better-sqlite3` 从 `^11.8.1` 升级到 `^12.11.1`：v11 使用的 V8 API（`v8::Object::GetPrototype`、`v8::Context::GetIsolate`、`v8::PropertyCallbackInfo::This`）在 Node 24/26 已被移除，导致新环境 `npm ci` 在 node-gyp 阶段编译失败。v12.11.1 官方支持 Node 20–26。
- 文档事实校准：接口数 13 → 16、错误码 30+ → 36、覆盖率 93.34% → 91.60%、压测环境更新为 Node v26.13.1 / better-sqlite3 12.11.1（实际重跑结果 5699 req/s）；OpenAPI 各接口编号重新对齐。
- README 补充 MIT 许可证与 CI 章节；快速开始改为 `npm ci`（与 CI 一致）。

## 验收通过后缺陷修复承诺

验收通过后 7 天内，对发布者反馈的缺陷免费修复并重新提交。
