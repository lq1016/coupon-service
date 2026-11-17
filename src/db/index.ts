import Database from 'better-sqlite3';
import config from '../config/index.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma(`journal_mode = ${config.dbJournalMode}`);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** 测试用：切换到内存数据库 */
export function useMemoryDb(): Database.Database {
  closeDb();
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
