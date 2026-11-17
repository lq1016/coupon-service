import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}

export function sha256(input: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** 生成人类可读的优惠券码：XXXX-XXXX-XXXX，去掉易混淆字符 */
export function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 I L O 0 1 等易混淆字符
  const pick = () => alphabet[crypto.randomInt(alphabet.length)];
  const seg = () => Array.from({ length: 4 }, pick).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
  ) {
    super(message);
  }
}

export function ok<T>(res: any, data: T, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function fail(res: any, status: number, message: string, code = 'ERROR'): void {
  res.status(status).json({ ok: false, error: { code, message } });
}

export function now(): number {
  return Date.now();
}
