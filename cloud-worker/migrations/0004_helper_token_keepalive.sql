ALTER TABLE device_tokens ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
ALTER TABLE device_tokens ADD COLUMN rotated_from TEXT NOT NULL DEFAULT '';

UPDATE device_tokens
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+60 days')
WHERE expires_at = '';

CREATE INDEX IF NOT EXISTS idx_device_tokens_status_expiry ON device_tokens(status, expires_at);
