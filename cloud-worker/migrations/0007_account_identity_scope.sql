ALTER TABLE accounts ADD COLUMN account_scope_id TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN account_identity_key TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_accounts_user_identity ON accounts(user_id, account_identity_key);
