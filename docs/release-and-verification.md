# Codex Dock Release And Verification

This document is the operational checklist for shipping the Cloudflare console and the Windows Codex Dock Helper as one commercial product.

## Release Surfaces

- Cloud console: Cloudflare Worker `codex-cloud-console` with Static Assets from `cloud-worker/public`.
- Cloud data: D1 database `codex-cloud-console`, managed by incremental files in `cloud-worker/migrations`.
- Windows Helper: `dist/CodexDockHelper/CodexDockHelper.exe`, currently version `0.4.2` with build date `2026-05-26`.
- Public domain: `https://codex.woai.pro`.

## Required Secrets And Variables

- GitHub repository secrets:
  - `CLOUDFLARE_API_TOKEN`: token with Worker deploy and D1 migration permissions.
  - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id used by Wrangler.
- Cloudflare Worker secret:
  - `TOKEN_ENCRYPTION_KEY`: AES-GCM key material used to encrypt account auth/session payloads in D1.
- Optional Worker variable:
  - `CLOUD_USAGE_REFRESH_DAILY_LIMIT`: per-account cloud refresh daily cap; defaults to `30`, clamped to `1..500`.
- Optional Helper environment variables:
  - `CODEX_PLUS_CLOUD_CONSOLE_URL`: override cloud console URL for local or preview testing.
  - `CODEX_PLUS_ALLOWED_ORIGIN`: extra browser origin allowed to call the local Helper API.
  - `CODEX_PLUS_APP_ID`: override Windows Shell AppID used to restart Codex.

Never commit real tokens, auth payloads, Worker secrets, device bearer tokens, or copied `%USERPROFILE%\.codex\auth.json` content.

## Local Preflight

From the repository root:

```powershell
npm --prefix cloud-worker ci
npm run preflight
```

For a faster Worker/UI-only loop, use `npm test`. It builds Cloudflare Static Assets and runs every local `scripts/verify-*` verifier except production smoke.

`npm run preflight` builds the Helper into `artifacts/build/CodexDockHelper` so local verification still works while the installed Helper is running from `dist\CodexDockHelper`. Use `npm run helper:build` when intentionally refreshing the distributable `dist` package.

After a production deploy, run:

```powershell
cd cloud-worker
npm run smoke:production
```

The smoke script registers a disposable cloud user, verifies login/logout, static asset manifest/version parity, usage-refresh settings persistence, device registration with Helper version, non-admin access denial, token-free account listing, and online Helper download hash parity with `dist/CodexDockHelper/CodexDockHelper.exe`.

For a local Worker smoke test:

```powershell
cd cloud-worker
npm run d1:schema:local
npx wrangler dev --local --ip 127.0.0.1 --port 8787
```

Then verify register/login, settings persistence, Helper diagnostics, auto-switch protection, audit, and admin devices in a real browser.

## GitHub Automation

- `.github/workflows/ci.yml` runs on push, pull request, and manual dispatch.
- CI installs Worker dependencies, runs the root `npm run preflight` command, and uploads `artifacts/build/CodexDockHelper/` as an artifact. `preflight` builds the Windows Helper, builds Static Assets with a content-derived asset version, and runs every local `scripts/verify-*` verifier except production smoke.
- `.github/workflows/cloudflare-deploy.yml` is manual only:
  - `preview` builds and runs `wrangler deploy --dry-run`.
  - `production` is guarded to `master` or `main`, applies remote D1 migrations, runs `wrangler deploy`, then runs `npm run smoke:production`.

## Production Deploy Checklist

1. Confirm CI is green for the exact commit.
2. Confirm `TOKEN_ENCRYPTION_KEY` is already set in Cloudflare:

   ```powershell
   cd cloud-worker
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

3. Inspect remote migration state:

   ```powershell
   npx wrangler d1 migrations list codex-cloud-console --remote
   ```

4. Apply only pending migrations:

   ```powershell
   npx wrangler d1 migrations apply codex-cloud-console --remote
   ```

5. Deploy:

   ```powershell
   npx wrangler deploy
   ```

6. Smoke test `https://codex.woai.pro`:
   - Static asset version loads without cache mismatch.
   - Register/login/logout work.
   - `/api/me` and `/api/settings/usage-refresh` return structured JSON with `X-Request-Id`.
   - Account lists and audit logs never expose token or auth JSON.
   - Helper diagnostics reject mismatched cloud origins and show an authorization action.

## Current Verification Evidence

- Product reference board: `artifacts/design/codex-dock-commercial-interface-reference-board-v1.png`.
- Static Assets build produces `asset-manifest.json`; `scripts/verify-static-asset-versioning.mjs` verifies that every local JS/CSS reference in the built `index.html` uses the generated content version and that the Helper download hash matches the manifest.
- Desktop browser screenshots:
  - `artifacts/verification/codex-dock-helper-diagnostics-desktop.png`
  - `artifacts/verification/codex-dock-settings-usage-channel-desktop.png`
  - `artifacts/verification/codex-dock-smart-switch-protection-desktop.png`
  - `artifacts/verification/codex-dock-admin-helper-version-desktop.png`
  - `artifacts/verification/codex-dock-admin-ops-summary-browser.png`
  - `artifacts/verification/codex-dock-import-primary-drawer-desktop.png`
  - `artifacts/verification/codex-dock-account-detail-diagnostics-local.png`
- Responsive screenshots:
  - `artifacts/verification/codex-dock-smart-switch-tablet.png`
  - `artifacts/verification/codex-dock-helper-mobile.png`
  - `artifacts/verification/codex-dock-import-primary-drawer-mobile.png`
- Production smoke screenshot:
  - `artifacts/verification/codex-dock-production-smoke-playwright.png`
  - `artifacts/verification/codex-dock-oauth-core-live.png`
  - `artifacts/verification/codex-dock-import-primary-live.png`
- Local Helper health verified against `http://127.0.0.1:18766/` with version `0.4.2`, build date `2026-05-26`, active Codex state, and `safe_to_switch: false`.
- Helper lifecycle regression verified on `2026-05-26`: closing the main window hides to tray, process stays alive, `/api/health` remains available with `tray` diagnostics, `/api/diagnostics/export` returns redacted logs/status, no Microsoft .NET Framework dialog appears, no new `[unhandled:]` log entry is emitted, simulated Windows `TaskbarCreated` restores the tray icon registration, and Helper `0.4.2` silently re-registers `NotifyIcon` even when the main window is visible.
- Production deployment verified on `2026-05-26`: `wrangler deploy` published Worker version `02a2ff62-ce6d-4fe5-b6f3-0bacec43652d`, API register/login/logout and usage-refresh settings smoke tests passed, and the deployed static assets use version `1c240a89ca2e`.
- Online Helper download verified on `2026-05-26`: `https://codex.woai.pro/downloads/CodexDockHelper.exe` SHA-256 matches local fixed build `D516CA84CF3FCAA4F09A3F4C806BD1685CF719497CE4D7816529BA6AC41743EB`.
- Automated production smoke verified on `2026-05-26`: `npm run smoke:production` passed in strict local-helper-hash mode, covering register/login/logout, static asset manifest/version parity, structured API error codes/request ids/diagnostic summaries, usage-refresh settings, device registration, non-admin admin rejection, token-free account listing, and Helper download hash parity. Current static asset version is `1c240a89ca2e`; production `index.html` has versioned JS/CSS references, the Helper tray repair buttons, and no stale `20260525-oauth-primary2` string.
- Helper diagnostics browser verification on `2026-05-26`: production `panels-ui.js` exposes `helperDiagnostic`, the device panel renders the Helper diagnosis card with safe-boundary guidance plus refresh, re-authorize, tray repair, local status, and diagnostics export actions. Screenshot: `artifacts/verification/helper-diagnostics-production-preview.png`.
- Admin operations summary verified on `2026-05-26`: `/api/admin/summary` aggregates users, sessions, account health, RT/AT split, latest usage failures, 24h audit failure trend, usage-refresh failures, Helper online/offline counts, and Helper version distribution without exposing credentials.
- Live browser verification on `2026-05-26`: `https://codex.woai.pro` loaded `CodexAdminUi`, rendered the admin operations summary with 3 cards and 4 trend bars, and reported no horizontal overflow.
- Live OAuth callback verification on `2026-05-26`: `https://codex.woai.pro` loaded `CodexOauthCore`; stale callback state returns `oauth_state_mismatch` and missing callback state returns `oauth_state_missing`, both with the user action "重新打开授权页面".
- Live import drawer verification on `2026-05-26`: `https://codex.woai.pro` opens import on OAuth mode by default, shows "登录导入 RT 账号" as the primary recommended path, keeps advanced import collapsed, and has no stale asset version references.
- Live account detail diagnostics verification on `2026-05-26`: `https://codex.woai.pro` renders the detail diagnosis card for usable RT accounts and AT-only accounts; AT-only rows show "不可用于 Codex", explain missing RT, disable switch, and expose the "补 RT" action.

## Commercial Quality Gates

- Usage refresh: supports Helper, cloud Worker, automatic fallback, and manual-only mode; shows the actual source; cloud writes are capped and aggregate audit noise.
- Task continuity: cloud only issues auto-switch payloads when the Helper confirms an idle, safe round boundary.
- Helper lifecycle: close-to-tray, persistent `%APPDATA%\CodexDock\helper.log`, bounded UI log buffer, redacted diagnostics export, log restore, and RichTextBox recovery are required before publishing a Helper artifact.
- Admin operations: users, devices, Helper versions, RT/AT account health, 24h failure trend, usage-refresh failures, and audit are visible without exposing credentials.
- API diagnostics: JSON API errors include stable `code`, body/header request id, and a short `diagnostic.summary` without exposing credentials or stack traces.

