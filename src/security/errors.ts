/**
 * 统一错误码表（>20 个）。
 * code 为稳定机器码，HTTP 状态按语义映射，message 为人类可读中文。
 */
export const ERROR_CODES = {
  // 通用 / 鉴权 4000
  BAD_REQUEST: { status: 400, message: '请求参数错误' },
  UNAUTHORIZED: { status: 401, message: '未登录或 token 无效' },
  FORBIDDEN: { status: 403, message: '没有权限执行该操作' },
  NOT_FOUND: { status: 404, message: '资源不存在' },
  INTERNAL_ERROR: { status: 500, message: '服务内部错误' },

  // 模板 / 库存 4100
  TEMPLATE_NOT_FOUND: { status: 404, message: '券模板不存在' },
  TEMPLATE_EXISTS: { status: 409, message: '券模板已存在' },
  TEMPLATE_ENDED: { status: 409, message: '活动已结束' },
  TEMPLATE_NOT_STARTED: { status: 409, message: '活动尚未开始' },
  TEMPLATE_PAUSED: { status: 409, message: '活动已暂停' },
  INSUFFICIENT_STOCK: { status: 409, message: '库存不足' },
  TOTAL_INVALID: { status: 400, message: '发放总量必须为正整数' },

  // 领券 / 幂等 4200
  IDEMPOTENT_REPLAY: { status: 200, message: '幂等重放，返回首次结果' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: '相同幂等键的请求参数不一致' },
  MISSING_IDEMPOTENCY_KEY: { status: 400, message: '缺少幂等键' },
  CLAIM_LIMIT_USER: { status: 429, message: '超过单用户限领数量' },
  CLAIM_LIMIT_DEVICE: { status: 429, message: '超过单设备限领数量' },
  CLAIM_LIMIT_IP: { status: 429, message: '超过单 IP 限领数量' },
  CLAIM_PER_USER_EXCEEDED: { status: 409, message: '超过该模板的单人领取上限' },
  ANTI_ABUSE_RULE_NOT_FOUND: { status: 404, message: '防刷规则不存在' },

  // 券实例 / 状态机 4300
  COUPON_NOT_FOUND: { status: 404, message: '优惠券不存在' },
  COUPON_NOT_UNUSED: { status: 409, message: '优惠券不是未使用状态，无法核销' },
  COUPON_ALREADY_USED: { status: 409, message: '优惠券已核销' },
  COUPON_EXPIRED: { status: 409, message: '优惠券已过期' },
  COUPON_REFUNDED: { status: 409, message: '优惠券已退货退款' },
  COUPON_CODE_INVALID: { status: 400, message: '券码格式错误' },
  INVALID_STATE_TRANSITION: { status: 409, message: '非法状态转换' },

  // 核销 / 退券 4400
  ORDER_NO_REQUIRED: { status: 400, message: '核销需要订单号' },
  ORDER_ALREADY_USED: { status: 409, message: '该订单号已使用过优惠券' },
  REDEMPTION_NOT_FOUND: { status: 404, message: '核销记录不存在' },
  REFUND_NOT_ALLOWED: { status: 409, message: '当前状态不允许退券' },
  REFUND_WINDOW_CLOSED: { status: 409, message: '超过退券时间窗口' },
  REFUND_ALREADY_DONE: { status: 409, message: '已退券，请勿重复操作' },

  // 批量 4500
  BATCH_TOO_LARGE: { status: 400, message: '批量数量超过单次上限' },
  BATCH_PARTIAL_FAILURE: { status: 207, message: '批量操作部分失败' },

  // 日志 / 查询 4600
  INVALID_DATE_RANGE: { status: 400, message: '时间范围不合法' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorInfo(code: ErrorCode): { status: number; message: string } {
  return ERROR_CODES[code];
}
