-- 建表与初始化脚本（可读 SQL）；运行时以 src/db/schema.ts 的 SCHEMA_SQL 为准

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  activity_id  TEXT NOT NULL,
  total        INTEGER NOT NULL CHECK (total > 0),
  discount     INTEGER NOT NULL,              -- 优惠金额（分）
  per_user     INTEGER NOT NULL DEFAULT 1,
  start_at     INTEGER NOT NULL,
  end_at       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active', -- active / paused / ended
  created_by   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tpl_activity ON coupon_templates(activity_id);

CREATE TABLE IF NOT EXISTS inventory (
  template_id  TEXT PRIMARY KEY REFERENCES coupon_templates(id),
  total        INTEGER NOT NULL,
  claimed      INTEGER NOT NULL DEFAULT 0,
  redeemed     INTEGER NOT NULL DEFAULT 0,
  refunded     INTEGER NOT NULL DEFAULT 0,
  expired      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coupon_instances (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  template_id    TEXT NOT NULL REFERENCES coupon_templates(id),
  activity_id    TEXT NOT NULL,
  user_id        TEXT,
  status         TEXT NOT NULL DEFAULT 'unused', -- unused/used/expired/refunded
  idempotency_key TEXT,
  device_id      TEXT,
  ip             TEXT,
  claimed_at     INTEGER,
  used_at        INTEGER,
  refunded_at    INTEGER,
  expired_at     INTEGER,
  order_no       TEXT
);
CREATE INDEX IF NOT EXISTS idx_inst_code     ON coupon_instances(code);
CREATE INDEX IF NOT EXISTS idx_inst_tpl      ON coupon_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_inst_user     ON coupon_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_inst_status   ON coupon_instances(status);
CREATE INDEX IF NOT EXISTS idx_inst_activity ON coupon_instances(activity_id);

CREATE TABLE IF NOT EXISTS claim_records (
  id              TEXT PRIMARY KEY,
  template_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  instance_id     TEXT NOT NULL REFERENCES coupon_instances(id),
  idempotency_key TEXT NOT NULL,
  device_id       TEXT,
  ip              TEXT,
  claimed_at      INTEGER NOT NULL,
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_claim_user ON claim_records(user_id);

CREATE TABLE IF NOT EXISTS redemption_records (
  id            TEXT PRIMARY KEY,
  instance_id   TEXT NOT NULL UNIQUE REFERENCES coupon_instances(id),
  template_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  activity_id   TEXT NOT NULL,
  order_no      TEXT NOT NULL,
  redeemed_at   INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'success' -- success / refunded
);
CREATE INDEX IF NOT EXISTS idx_redeem_activity ON redemption_records(activity_id);
CREATE INDEX IF NOT EXISTS idx_redeem_user     ON redemption_records(user_id);

CREATE TABLE IF NOT EXISTS refund_records (
  id             TEXT PRIMARY KEY,
  instance_id    TEXT NOT NULL REFERENCES coupon_instances(id),
  redemption_id  TEXT NOT NULL REFERENCES redemption_records(id),
  reason         TEXT,
  operator       TEXT,
  refunded_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  operation       TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anti_abuse_rules (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL UNIQUE REFERENCES coupon_templates(id),
  per_user     INTEGER NOT NULL,
  per_device   INTEGER NOT NULL,
  per_ip       INTEGER NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id           TEXT PRIMARY KEY,
  coupon_code  TEXT,
  user_id      TEXT,
  activity_id  TEXT,
  action       TEXT NOT NULL,
  detail       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_code     ON operation_logs(coupon_code);
CREATE INDEX IF NOT EXISTS idx_log_user     ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_log_activity ON operation_logs(activity_id);
