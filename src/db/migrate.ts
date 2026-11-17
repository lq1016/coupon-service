import { getDb } from './index.js';
import { SCHEMA_SQL } from './schema.js';

export function migrate(): void {
  getDb().exec(SCHEMA_SQL);
}

if (process.argv[1] && /(^|\/)migrate(\.ts|\.js)?$/.test(process.argv[1])) {
  migrate();
  console.log('[migrate] 建表完成');
}
