# 错误码表（36 个）

所有错误响应统一格式：`{ "ok": false, "error": { "code": "XXX", "message": "中文说明" } }`。

规则：`code` 为稳定机器码，前端按 code 分支；`message` 为人类可读提示。接口也可通过 `GET /api/error-codes` 获取结构化错误码表。

> 代码中的 `ERROR_CODES` 表共 36 项（`src/security/errors.ts`）；登录限流另返回 `TOO_MANY_ATTEMPTS`（429），由 `express-rate-limit` 直接下发，不在注册表内。

## 通用 / 鉴权（4xxx）

| code | HTTP | 说明 |
| --- | --- | --- |
| BAD_REQUEST | 400 | 请求参数错误 |
| UNAUTHORIZED | 401 | 未登录或 token 无效 |
| FORBIDDEN | 403 | 需要管理员权限 |
| NOT_FOUND | 404 | 资源不存在 |
| INTERNAL_ERROR | 500 | 服务内部错误 |
| TOO_MANY_ATTEMPTS | 429 | 登录尝试过多（限流） |

## 模板 / 库存（41xx）

| code | HTTP | 说明 |
| --- | --- | --- |
| TEMPLATE_NOT_FOUND | 404 | 券模板不存在 |
| TEMPLATE_EXISTS | 409 | 券模板已存在 |
| TEMPLATE_ENDED | 409 | 活动已结束 |
| TEMPLATE_NOT_STARTED | 409 | 活动尚未开始 |
| TEMPLATE_PAUSED | 409 | 活动已暂停 |
| INSUFFICIENT_STOCK | 409 | 库存不足（防超发触发） |
| TOTAL_INVALID | 400 | 发放总量非法 |
| INVALID_DATE_RANGE | 400 | 时间范围非法 |

## 领券 / 幂等 / 防刷（42xx）

| code | HTTP | 说明 |
| --- | --- | --- |
| IDEMPOTENT_REPLAY | 200 | 幂等重放，返回首次结果（replay=true） |
| IDEMPOTENCY_CONFLICT | 409 | 相同幂等键参数不一致 |
| MISSING_IDEMPOTENCY_KEY | 400 | 缺少幂等键 |
| CLAIM_LIMIT_USER | 429 | 超过单用户限领数量 |
| CLAIM_LIMIT_DEVICE | 429 | 超过单设备限领数量 |
| CLAIM_LIMIT_IP | 429 | 超过单 IP 限领数量 |
| CLAIM_PER_USER_EXCEEDED | 409 | 超过模板单人领取上限 |
| ANTI_ABUSE_RULE_NOT_FOUND | 404 | 防刷规则不存在 |

## 券实例 / 状态机（43xx）

| code | HTTP | 说明 |
| --- | --- | --- |
| COUPON_NOT_FOUND | 404 | 优惠券不存在 |
| COUPON_NOT_UNUSED | 409 | 非未用状态，无法核销 |
| COUPON_ALREADY_USED | 409 | 已核销 |
| COUPON_EXPIRED | 409 | 已过期 |
| COUPON_REFUNDED | 409 | 已退款 |
| COUPON_CODE_INVALID | 400 | 券码格式错误 |
| INVALID_STATE_TRANSITION | 409 | 非法状态转换 |

## 核销 / 退券（44xx）

| code | HTTP | 说明 |
| --- | --- | --- |
| ORDER_NO_REQUIRED | 400 | 核销需要订单号 |
| ORDER_ALREADY_USED | 409 | 订单号已用过券 |
| REDEMPTION_NOT_FOUND | 404 | 核销记录不存在 |
| REFUND_NOT_ALLOWED | 409 | 当前状态不允许退券 |
| REFUND_WINDOW_CLOSED | 409 | 超过退券时间窗口（7 天） |
| REFUND_ALREADY_DONE | 409 | 已退券，勿重复 |

## 批量 / 查询（45xx / 46xx）

| code | HTTP | 说明 |
| --- | --- | --- |
| BATCH_TOO_LARGE | 400 | 批量数量超过上限 1000 |
| BATCH_PARTIAL_FAILURE | 207 | 批量部分失败（逐条结果见响应） |
| INVALID_DATE_RANGE | 400 | 时间范围不合法 |

合计 36 个错误码，覆盖鉴权、库存、幂等、防刷、状态机、批量全链路。
