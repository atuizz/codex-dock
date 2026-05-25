ALTER TABLE user_settings ADD COLUMN usage_refresh_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE usage_snapshots ADD COLUMN refresh_source TEXT NOT NULL DEFAULT '';
ALTER TABLE usage_snapshots ADD COLUMN refresh_kind TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_usage_user_source_created ON usage_snapshots(user_id, refresh_source, created_at DESC);

ALTER TABLE devices ADD COLUMN helper_version TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN helper_build_date TEXT NOT NULL DEFAULT '';
