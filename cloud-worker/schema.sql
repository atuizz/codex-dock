PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '默认',
  priority TEXT NOT NULL DEFAULT 'normal',
  usage_note TEXT NOT NULL DEFAULT '',
  expiry_note TEXT NOT NULL DEFAULT '',
  chatgpt_account_id TEXT NOT NULL DEFAULT '',
  plan_type TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  has_refresh_token INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_switch_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_updated ON accounts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_user_chatgpt ON accounts(user_id, chatgpt_account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user_email ON accounts(user_id, email);

CREATE TABLE IF NOT EXISTS account_secrets (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_auth_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_secrets_user ON account_secrets(user_id);

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_account_created ON usage_snapshots(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_snapshots(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  helper_online INTEGER NOT NULL DEFAULT 0,
  helper_base TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, device_key)
);

CREATE INDEX IF NOT EXISTS idx_devices_user_seen ON devices(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  auto_switch_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT '',
  rotated_from TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(user_id, device_key);
CREATE INDEX IF NOT EXISTS idx_device_tokens_status_expiry ON device_tokens(status, expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  device_key TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at DESC);
