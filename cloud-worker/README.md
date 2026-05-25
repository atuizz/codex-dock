# Codex Cloud Console Worker

Cloudflare Worker + Static Assets + D1 backend for `https://codex.woai.pro`.

## Commands

CI/CD entrypoints:

- `../.github/workflows/ci.yml` runs all `scripts/verify-*` checks, builds assets, builds the Windows Helper, and uploads the Helper artifact.
- `../.github/workflows/cloudflare-deploy.yml` is manual. `preview` runs a Wrangler dry run; `production` applies remote D1 migrations and deploys.

Manual deploy:

```powershell
npm install
npm run build
npx wrangler d1 execute codex-cloud-console --remote --file ./schema.sql
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

For an existing remote database, apply incremental migrations instead of replaying the full schema:

```powershell
npx wrangler d1 migrations apply codex-cloud-console --remote
```

Before applying remote migrations, check the ledger first:

```powershell
npx wrangler d1 migrations list codex-cloud-console --remote
```

If Wrangler reports pending migrations but the remote schema already contains the columns or tables, do not run `migrations apply` blindly. Inspect `sqlite_master`, `PRAGMA table_info(...)`, and `d1_migrations`, then repair the migration ledger only after the real schema is proven to match the migration files.

## Runtime Shape

- Static assets: `index.html`, `account-core.js`, `platform-clients.js`, `format-core.js`, `progress-ui.js`, `shell-ui.js`, `dialog-ui.js`, `settings-ui.js`, `account-list-ui.js`, `account-detail-ui.js`, `audit-core.js`, `admin-ui.js`, `panels-ui.js`, `import-core.js`, `import-ui.js`, `app.js`, `styles.css` copied into `cloud-worker/public`.
- Worker shared utilities: `worker-shared.js` owns JSON responses, request ids, structured logging, cookies, password hashing, token randomness, JWT decoding, and AES-GCM token encryption helpers.
- Worker auth module: `worker-auth.js` owns register/login/logout, session lookup, public user projection, and OAuth code exchange.
- Worker account module: `worker-accounts.js` owns ChatGPT account/session normalization, usage normalization, candidate scoring/diagnostics, account CRUD, and switch payload generation.
- Worker usage module: `worker-usage.js` owns usage refresh settings, cloud Worker refresh, per-account daily limits, recent refresh-source summaries, and usage snapshot source metadata.
- Worker settings module: `worker-settings.js` owns auto-switch policy defaults, clamping, and D1 persistence.
- Worker helper module: `worker-helper.js` owns device registration, Helper bearer-token verification, sliding TTL/rotation, heartbeat, current-usage reporting, next-account selection, and Helper switch audit callbacks.
- Worker audit module: `worker-audit.js` owns D1 audit writes, request-id metadata stitching, user audit listing, and switch success timestamp updates.
- Worker admin module: `worker-admin.js` owns admin summary/users/devices/audit views, role/status management, session deletion, password resets, and last-admin protection.
- Worker user module: `worker-user.js` owns signed-in user settings and password-change routes.
- API: `/api/*` served by `worker.js`.
- Database: D1 binding `DB`.
- Secret: `TOKEN_ENCRYPTION_KEY`, used to encrypt account auth/session payloads before storage.
- Optional variable: `CLOUD_USAGE_REFRESH_DAILY_LIMIT`, default `30`, clamps cloud refresh writes to `1..500` per account per day.
- Custom domain: `codex.woai.pro`.
- Observability: every response includes `X-Request-Id`; Worker logs emit structured JSON events such as `worker.request`, `worker.exception`, and `worker.audit`. D1 audit metadata stores the same request id for cross-checking.

## Safety Boundary

`GET /api/accounts` returns only metadata and usage snapshots. Token material is encrypted in `account_secrets` and is only decrypted for `POST /api/accounts/:id/switch-payload` after the cloud user is logged in.
Helper device tokens are bearer credentials with a sliding 60-day TTL. Active helpers refresh their expiry on every cloud call, and `/api/helper/auto-switch/config` can return a replacement token after the rotation window so the local Helper can save it before the old token enters its grace period.
Auto-switch payloads are only issued after the Helper reports a confirmed safe boundary, so quota exhaustion does not interrupt an active Codex turn that can still continue.

## Added Commercial API Surface

- `GET /api/settings/usage-refresh`
- `PATCH /api/settings/usage-refresh`
- `POST /api/settings/usage-refresh/recent`
- `POST /api/accounts/:id/usage/refresh-cloud`
- `GET /api/admin/devices`
