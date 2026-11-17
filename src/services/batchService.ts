import { claim } from './claimService.js';
import { HttpError } from '../utils/index.js';

const MAX_BATCH = 1000;

export interface BatchClaimItem {
  userId: string;
  idempotencyKey: string;
  deviceId?: string;
  ip?: string;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ userId: string; ok: boolean; code?: string; error?: string }>;
}

/** 批量发放：逐条走 claim（各自事务），单条失败不影响其他，汇总结果 */
export function batchClaim(templateId: string, items: BatchClaimItem[]): BatchResult {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, '批量数量必须大于 0', 'BAD_REQUEST');
  }
  if (items.length > MAX_BATCH) {
    throw new HttpError(400, `批量数量超过单次上限 ${MAX_BATCH}`, 'BATCH_TOO_LARGE');
  }
  const results: BatchResult['results'] = [];
  let succeeded = 0;
  for (const it of items) {
    try {
      const r = claim({ templateId, ...it });
      succeeded++;
      results.push({ userId: it.userId, ok: true, code: r.code });
    } catch (e: any) {
      results.push({ userId: it.userId, ok: false, error: e?.code ?? 'INTERNAL_ERROR' });
    }
  }
  return { total: items.length, succeeded, failed: items.length - succeeded, results };
}
