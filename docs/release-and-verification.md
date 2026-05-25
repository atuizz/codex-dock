# Codex Dock Release And Verification

This document is the operational checklist for shipping the Cloudflare console and the Windows Codex Dock Helper as one commercial product.

## Release Surfaces

- Cloud console: Cloudflare Worker `codex-cloud-console` with Static Assets from `cloud-worker/public`.
- Cloud data: D1 database `codex-cloud-console`, managed by incremental files in `cloud-worker/migrations`.
- Windows Helper: `dist/CodexDockHelper/CodexDockHelper.exe`, currently version `0.4.0` with build date `2026-05-26`.
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
cd cloud-worker
npm ci
cd ..
Get-ChildItem -File scripts -Filter 'verify-*' | Sort-Object Name | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
cd cloud-worker
npm run build
cd ..
.\native-helper\build-helper.ps1
```

After a production deploy, run:

```powershell
cd cloud-worker
npm run smoke:production
```

The smoke script registers a disposable cloud user, verifies login/logout, usage-refresh settings persistence, device registration with Helper version, non-admin access denial, token-free account listing, and online Helper download hash parity with `dist/CodexDockHelper/CodexDockHelper.exe`.

For a local Worker smoke test:

```powershell
cd cloud-worker
npm run d1:schema:local
npx wrangler dev --local --ip 127.0.0.1 --port 8787
```

Then verify register/login, settings persistence, Helper diagnostics, auto-switch protection, audit, and admin devices in a real browser.

## GitHub Automation

- `.github/workflows/ci.yml` runs on push, pull request, and manual dispatch.
- CI installs Worker dependencies, runs every `scripts/verify-*` verifier, builds Static Assets, builds the Windows Helper, and uploads `dist/CodexDockHelper/` as an artifact.
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
- Desktop browser screenshots:
  - `artifacts/verification/codex-dock-helper-diagnostics-desktop.png`
  - `artifacts/verification/codex-dock-settings-usage-channel-desktop.png`
  - `artifacts/verification/codex-dock-smart-switch-protection-desktop.png`
  - `artifacts/verification/codex-dock-admin-helper-version-desktop.png`
- Responsive screenshots:
  - `artifacts/verification/codex-dock-smart-switch-tablet.png`
  - `artifacts/verification/codex-dock-helper-mobile.png`
- Production smoke screenshot:
  - `artifacts/verification/codex-dock-production-smoke-playwright.png`
- Local Helper health verified against `http://127.0.0.1:18766/` with version `0.4.0`, build date `2026-05-26`, active Codex state, and `safe_to_switch: false`.
- Helper lifecycle regression verified on `2026-05-26`: closing the main window hides to tray, process stays alive, `/api/health` remains available, no Microsoft .NET Framework dialog appears, no new `[unhandled:]` log entry is emitted, and simulated Windows `TaskbarCreated` restores the tray icon registration.
- Production deployment verified on `2026-05-26`: D1 migration `0005_usage_refresh_channels.sql` applied, `wrangler deploy` published Worker version `805648bb-4030-4aa7-b09b-05a226e8a430`, remote migration list returned no pending migrations, API register/login/logout and usage-refresh settings smoke tests passed.
- Online Helper download verified on `2026-05-26`: `https://codex.woai.pro/downloads/CodexDockHelper.exe` SHA-256 matches local fixed build `20CB7636E7F712E70CE449FF20AB17CB184588237A1200A0825DAC1FD4255223`.
- Automated production smoke verified on `2026-05-26`: `npm run smoke:production` passed in strict local-helper-hash mode, covering register/login/logout, structured API error codes/request ids/diagnostic summaries, usage-refresh settings, device registration, non-admin admin rejection, token-free account listing, and Helper download hash parity.

## Commercial Quality Gates

- Usage refresh: supports Helper, cloud Worker, automatic fallback, and manual-only mode; shows the actual source; cloud writes are capped and aggregate audit noise.
- Task continuity: cloud only issues auto-switch payloads when the Helper confirms an idle, safe round boundary.
- Helper lifecycle: close-to-tray, persistent `%APPDATA%\CodexDock\helper.log`, bounded UI log buffer, log restore, and RichTextBox recovery are required before publishing a Helper artifact.
- Admin operations: users, devices, Helper versions, health totals, failures, and audit are visible without exposing credentials.
- API diagnostics: JSON API errors include stable `code`, body/header request id, and a short `diagnostic.summary` without exposing credentials or stack traces.
