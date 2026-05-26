CREATE TABLE IF NOT EXISTS account_deletion_events (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'self-service',
  former_role TEXT NOT NULL DEFAULT 'user',
  removed_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_created ON account_deletion_events(created_at DESC);
