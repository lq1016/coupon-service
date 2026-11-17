import crypto from 'node:crypto';

/** scrypt 密码哈希，格式：scrypt$<saltHex>$<hashHex> */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, saltHex, hashHex] = stored.split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    // 严格校验 hex 格式，避免 Buffer.from('zz','hex') 得到空 buffer 造成误判
    if (!/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(hashHex)) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length === 0) return false;
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
