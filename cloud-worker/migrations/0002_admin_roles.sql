ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN last_login_at TEXT NOT NULL DEFAULT '';

UPDATE users
SET role = 'admin',
    status = 'active',
    updated_at = COALESCE(NULLIF(updated_at, ''), datetime('now'))
WHERE id = (
  SELECT id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
);

UPDATE users
SET status = 'active'
WHERE status = '';
