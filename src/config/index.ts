import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, '.env'));

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name] !== undefined && process.env[name] !== '' ? process.env[name]! : fallback;
}

export const config = {
  port: int('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  nodeEnv: str('NODE_ENV', 'development'),
  dbPath: path.resolve(ROOT, str('DB_PATH', './data/coupon.db')),
  dbJournalMode: str('DB_JOURNAL_MODE', 'WAL') as 'WAL' | 'MEMORY' | 'DELETE',
  jwtSecret: str('JWT_SECRET', 'change-me-in-production'),
  jwtTtl: int('JWT_TTL', 3600),
  antiAbuse: {
    perUser: int('DEFAULT_PER_USER_LIMIT', 3),
    perDevice: int('DEFAULT_PER_DEVICE_LIMIT', 5),
    perIp: int('DEFAULT_PER_IP_LIMIT', 10),
  },
  expireScanIntervalMs: int('EXPIRE_SCAN_INTERVAL_MS', 60000),
  demoCouponCount: int('DEMO_COUPON_COUNT', 120),
};

export default config;
