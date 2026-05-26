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
- `.github/workflows/cloudflare-deploy.yml` is manual only and always runs the Windows release preflight before any Cloudflare action:
  - `preview` builds and runs `wrangler deploy --dry-run`.
  - `production` is guarded to `master` or `main`, applies remote D1 migrations, runs `wrangler deploy`, then runs `npm run smoke:production`.
- `scripts/verify-github-workflows.cjs` keeps the CI/CD shape under local preflight so deployments cannot silently lose Helper build validation, D1 migration, production smoke, or Cloudflare secret wiring.

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

- Latest production hotfix verified on `2026-05-26`: `wrangler deploy` published Worker version `51d37c34-b145-475d-8c2c-b54561621d5d` with static asset version `5b9a5a806756`; production smoke passed in strict local-helper-hash mode; online Helper download and local `dist\CodexDockHelper\CodexDockHelper.exe` both report SHA-256 `099D63B12FBCD7990FA6A8F5EB0DFDCB9F6B06EA558E0CDFF36098C217961AAD`.
- Auto-switch failure-loop hotfix verified on `2026-05-26`: Helper health now exposes `last_stage`, `last_stage_label`, `last_failure_stage`, `last_failure_detail`, and `failure_backoff_until`; repeated no-candidate/not-switched/switch-failed outcomes enter a 180 second backoff; stale usage snapshots older than 30 minutes are displayed as needing refresh instead of hard-blocking candidate selection as 0% quota; the browser console remained free of warnings/errors after loading `https://codex.woai.pro`.
- Product reference board: `artifacts/design/codex-dock-commercial-interface-reference-board-v1.png`.
- Static Assets build produces `asset-manifest.json`; `scripts/verify-static-asset-versioning.mjs` verifies that every local JS/CSS reference in the built `index.html` uses the generated content version and that the Helper download version, build date, size, and hash match the manifest.
- Desktop browser screenshots:
  - `artifacts/verification/codex-dock-helper-diagnostics-desktop.png`
  - `artifacts/verification/codex-dock-settings-usage-channel-desktop.png`
  - `artifacts/verification/codex-dock-smart-switch-protection-desktop.png`
  - `artifacts/verification/codex-dock-admin-helper-version-desktop.png`
  - `artifacts/verification/codex-dock-admin-ops-summary-browser.png`
  - `artifacts/verification/codex-dock-import-primary-drawer-desktop.png`
  - `artifacts/verification/codex-dock-account-detail-diagnostics-local.png`
  - `artifacts/verification/account-health-production-preview.png`
  - `artifacts/verification/account-cleanup-modal-production.png`
  - `artifacts/verification/helper-release-card-production.png`
  - `artifacts/verification/auto-switch-stage-local.png`
  - `artifacts/verification/auto-switch-stage-production.png`
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
- Production deployment verified on `2026-05-26`: `wrangler deploy` published Worker version `51d37c34-b145-475d-8c2c-b54561621d5d`, API register/login/logout and usage-refresh settings smoke tests passed, and the deployed static assets use version `5b9a5a806756`.
- Online Helper download verified on `2026-05-26`: `https://codex.woai.pro/downloads/CodexDockHelper.exe` SHA-256 matches local fixed build `099D63B12FBCD7990FA6A8F5EB0DFDCB9F6B06EA558E0CDFF36098C217961AAD`.
- Automated production smoke verified on `2026-05-26`: `npm run smoke:production` passed in strict local-helper-hash mode, covering register/login/logout, static asset manifest/version parity, structured API error codes/request ids/diagnostic summaries, usage-refresh settings, device registration, non-admin admin rejection, token-free account listing, and Helper download hash parity. Current static asset version is `5b9a5a806756`; production `index.html` has versioned JS/CSS references, the account health center, the cleanup confirmation modal, the Helper release card, the auto-switch stage card, the Helper tray repair buttons, and no stale `20260525-oauth-primary2` string.
- Helper diagnostics browser verification on `2026-05-26`: production `panels-ui.js` exposes `helperDiagnostic`, the device panel renders the Helper diagnosis card with safe-boundary guidance plus refresh, re-authorize, tray repair, local status, and diagnostics export actions. Screenshot: `artifacts/verification/helper-diagnostics-production-preview.png`.
- Helper release browser verification on `2026-05-26`: production `asset-manifest.json` reports Helper `0.4.2`, build date `2026-05-26`, and SHA-256 `099D63B12FBCD7990FA6A8F5EB0DFDCB9F6B06EA558E0CDFF36098C217961AAD`; production `panels-ui.js` renders the release card with download and checksum actions. De-identified screenshot: `artifacts/verification/helper-release-card-production.png`.
- Account health browser verification on `2026-05-26`: production `shell-ui.js` exposes `renderHealthCenter`, the account pool renders health filter chips for usable RT, missing RT, invalid RT/token, low quota, cooldown, current account, Helper blocked, and attention states. De-identified screenshot: `artifacts/verification/account-health-production-preview.png`.
- Account cleanup browser verification on `2026-05-26`: production `dialog-ui.js` exposes `renderCleanupReview`, the batch cleanup modal shows selected, attention, usable, and re-importable counts, warns when usable accounts are included, and was captured with a de-identified screenshot: `artifacts/verification/account-cleanup-modal-production.png`.
- Auto-switch stage browser verification on `2026-05-26`: local built assets render the device page stage card from Helper-style status only, showing the protected active-turn phase, trigger, safe-boundary evidence, recent result, and next action. The captured screenshot `artifacts/verification/auto-switch-stage-local.png` was checked for no email, token, `refresh_token`, `access_token`, or `Bearer` text.
- Production auto-switch stage verification on `2026-05-26`: `wrangler deploy` published Worker version `51d37c34-b145-475d-8c2c-b54561621d5d` with static asset version `5b9a5a806756`; production `panels-ui.js` exposes `autoSwitchStage`, rendered `boundary_confirming` and `failure_backoff` scenarios, kept the top diagnostic title aligned to the actual stage, and screenshot `artifacts/verification/auto-switch-stage-production.png` was checked for no email, token, `refresh_token`, `access_token`, or `Bearer` text.
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

