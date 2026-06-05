# Codex Dock Release And Verification

This document is the operational checklist for shipping the Cloudflare console and the Windows Codex Dock Agent as one commercial product.

## Release Surfaces

- Cloud console: Cloudflare Worker `codex-cloud-console` with Static Assets from `cloud-worker/public`.
- Cloud data: D1 database `codex-cloud-console`, managed by incremental files in `cloud-worker/migrations`.
- Windows Dock Agent release candidate: `dist/CodexDockHelper/CodexDockHelper.exe`, currently version `0.4.11` with build date `2026-06-06`.
- Public domain: `https://codex.woai.pro`.

## Required Secrets And Variables

- GitHub repository secrets:
  - `CHECKOUT_TOKEN`: optional checkout fallback for private repositories when the default `GITHUB_TOKEN` cannot fetch the repository on GitHub-hosted runners. Keep this token read-only or otherwise minimum scoped.
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
  - `CODEX_DOCK_RESTORE_THREAD_PROTOCOL`: optional switch for thread deep-link restore. By default the Agent waits for the Codex main window, then calls `codex://threads/...` once; set to `0`, `false`, or `off` to disable the deep link.

Never commit real tokens, auth payloads, Worker secrets, device bearer tokens, or copied `%USERPROFILE%\.codex\auth.json` content.

## Local Preflight

From the repository root:

```powershell
npm --prefix cloud-worker ci
npm run preflight
```

For a faster Worker/UI-only loop, use `npm test`. It builds Cloudflare Static Assets and runs every local `scripts/verify-*` verifier except production smoke.

`npm run preflight` builds the Helper into `artifacts/build/CodexDockHelper` so local verification still works while the installed Helper is running from `dist\CodexDockHelper`. Use `npm run helper:build` when intentionally refreshing the distributable `dist` package.

`scripts/verify-commercial-release-gate.mjs` is part of `npm run verify` and fails the release if the fixed commercial path evidence disappears from CI: auth/session, self-service account deletion, OAuth RT import, account health, usage refresh channels, safe auto-switch, Helper lifecycle/update, admin/audit, self-cleaning production smoke, CI/CD, design prototype, and responsive/browser screenshots.

`npm run release:report` validates the deployable release candidate: git commit, Worker/static asset version, local Helper release manifest, local Helper lifecycle self-test, CI/CD workflow coverage, and required verification artifacts. It deliberately permits a new candidate Helper version to be ahead of production before deployment. After deploying, run `npm run release:report:production` to enforce production Helper EXE/package hash parity with the candidate.

`npm run smoke:production:surface` writes both `artifacts/verification/production-surface-result.json` and `artifacts/verification/helper-update-release-production-result.json`, so the post-deploy report consumes freshly observed production assets rather than a manually edited record.

After a production deploy, run:

```powershell
cd cloud-worker
npm run smoke:production
cd ..
npm run smoke:production:surface
npm run release:report:production
```

The smoke script requires an already bootstrapped administrator, registers a disposable normal cloud user, verifies its authenticated surface, static asset manifest/version parity, usage-refresh settings persistence, device registration with Helper version, non-admin access denial, token-free account listing, and online Helper download hash parity with `dist/CodexDockHelper/CodexDockHelper.exe`. It then calls `DELETE /api/me` and verifies the disposable user is anonymous again, preventing repeated release checks from accumulating production users and devices.

The production surface smoke checks the deployed HTML, manifest, split JS/CSS modules, Helper release metadata, OAuth error handling copy, manual-switch guard, account health, Helper diagnostics/update, admin metrics, responsive breakpoints, and obvious secret leakage patterns without creating an account.

For a local Worker smoke test:

```powershell
cd cloud-worker
npm run d1:schema:local
npx wrangler dev --local --ip 127.0.0.1 --port 8787
```

Then verify register/login, settings persistence, Helper diagnostics, auto-switch protection, audit, and admin devices in a real browser.

## GitHub Automation

- `.github/workflows/ci.yml` runs on `main`, `master`, and `codex/**` push events, pull requests, and manual dispatch.
- CI installs Worker dependencies on a pinned Windows 2025 runner, runs the root `npm run preflight` command, and uploads `artifacts/build/CodexDockHelper/` as an artifact. `preflight` builds the Windows Helper, builds Static Assets with a content-derived asset version, and runs every local `scripts/verify-*` verifier except production smoke.
- `.github/workflows/cloudflare-deploy.yml` is manual only and always runs the Windows release preflight before any Cloudflare action:
  - checkout uses `secrets.CHECKOUT_TOKEN || github.token`, so private-repository checkout can fall back to a repository secret without committing credentials.
  - all targets fail early with a clear message if `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing from GitHub repository secrets.
  - `preview` builds and runs `wrangler deploy --dry-run`.
  - `production` is guarded to `master` or `main`, applies remote D1 migrations, runs `wrangler deploy`, then runs `npm run smoke:production`.
- `scripts/verify-github-workflows.cjs` keeps the CI/CD shape under local preflight so deployments cannot silently lose Helper build validation, D1 migration, production smoke, or Cloudflare secret wiring.
- `npm run release:github-ci` is an optional controlled CI fallback for teams that choose GitHub-hosted preflight. It dispatches the CI workflow for the current branch, waits for the current commit's `workflow_dispatch` run, and writes the ignored local evidence file `artifacts/verification/github-ci-dispatch-result.json`.
- `npm run release:github-readiness` is an optional GitHub-hosted CD diagnostic. It uses `gh` read-only calls to verify active workflows, current-commit CI, a real push-triggered CI run, repository PushEvents, repository secret names, and external check-suite status, then writes the ignored local evidence file `artifacts/verification/github-release-readiness-result.json` without exposing secret values. Per the current delivery scope, missing push-triggered CI observation or a GitHub Cloudflare deploy secret does not count against product completion and does not block local `preflight` or an authenticated direct Cloudflare deployment.

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
   - Temporary smoke users delete themselves through `DELETE /api/me`; only anonymous deletion-count telemetry remains.

## Current Verification Evidence

- Agent `0.4.11` release candidate built on `2026-06-06`: window restore is now staged for the upgraded Codex desktop app. The Agent launches Codex through the Windows AppID, waits for the packaged Codex main window, restores and foregrounds it with Win32 APIs, then sends a single delayed `codex://threads/...` request to navigate back to the captured local conversation. This preserves thread-level recovery without the previous cold-start protocol loop that produced Electron app-path errors. Local `dist\CodexDockHelper\CodexDockHelper.exe` SHA-256 is `A1BE6C939789970826A9A83E87AAC5673B2B61DF9D01F7121C44965AE665D11F`, final portable zip SHA-256 is `F6987EB709ABF0E8207FEF7185904D794DB890CD7EFB86783100C6F7C3F63935`.
- Agent `0.4.10` release candidate built on `2026-06-02`: after a Codex upgrade, account switching launches Codex once and lets the current app restore its prior window natively. The old `codex://threads/...` protocol restore is disabled by default because current Codex builds can misinterpret its thread id as an Electron app path; it remains available as an explicit legacy compatibility opt-in and is never retried in a loop. Local `dist\CodexDockHelper\CodexDockHelper.exe` SHA-256 is `A68F1D12383B9626C0B95C82938E9FA8CC377AB0EAA5F9F568DD304C0E8E934B`, final portable zip SHA-256 is `EFAFB0E356E3AF2832D8EB5F01F392D20313B72B808AAB146B0611074CBE5870`.
- Agent `0.4.9` release candidate built on `2026-05-27`: client title, tray hint, local status page, update prompts, release manifest, default device name, and manual-switch risk copy now use Dock Agent; the switch progress popup is topmost and stays visible longer after success/failure. Local `dist\CodexDockHelper\CodexDockHelper.exe` SHA-256 is `E47EC88F9C55390DDCA0A3A0784217F8EBE7BF554EAA19312153FAAD16F11E04`, portable zip SHA-256 is `12CD684972B4492BEEF6042C528D90F7C5B4D27BD39FC31FEDC7F4BB7E30BB5B`, and the executable file name remains `CodexDockHelper.exe` for update-path compatibility.
- Helper `0.4.7` release candidate verified on `2026-05-27`: pending auto-switch plans are persisted locally and surfaced as a revalidation-only state after Helper restart; the restored plan cannot write auth until a new live usage and safe-boundary check passes. The final downloadable EXE SHA-256 is `391F8841D88F1434EAEB144A5435ACF5050AE6CCC4D7F3E5462EF90F74FAC515`, portable zip SHA-256 is `87DCA57B1F815CD57FEA5215AC3A0C2462A0F186B6A8831E733C99D977D06B94`, the real `POST /api/lifecycle/self-test` result reported `log_found: true`, `log_view_fault_tested: true`, and `log_view_fault_recovered: true`, and the redacted restart recovery proof is recorded in `artifacts/verification/helper-pending-revalidation-local-result.json` and `artifacts/verification/helper-pending-revalidation-local.png`.
- Latest production release verified on `2026-05-27`: D1 migration `0006_account_deletion_events.sql` was applied and `wrangler deploy` published Worker version `a876df41-a756-4094-b9ae-829297d1f77a` with static asset version `967b8412fa8a`; strict production smoke passed with online/local Helper hash parity and self-deleted its disposable user/device; historical synthetic smoke residue was removed with an anonymous aggregate event recording `53` users, `53` devices and `1` session; production surface smoke confirmed the commercial modules and no obvious public secret leakage. The online Helper distribution remains `0.4.7` with EXE SHA-256 `391F8841D88F1434EAEB144A5435ACF5050AE6CCC4D7F3E5462EF90F74FAC515` and portable zip SHA-256 `87DCA57B1F815CD57FEA5215AC3A0C2462A0F186B6A8831E733C99D977D06B94`.
- Commercial release gate added on `2026-05-26` and extended on `2026-05-27`: `scripts/verify-commercial-release-gate.mjs` checks 18 named commercial gates and 28 tracked evidence artifacts, including account-deletion lifecycle and Helper restart revalidation evidence, and is auto-discovered by `scripts/run-local-verifiers.mjs` during `npm run verify` and `npm run preflight`.
- Release evidence report added on `2026-05-26` and split into candidate/post-deploy checks on `2026-05-27`: `npm run release:report` emits a machine-readable candidate summary without incorrectly blocking a new Helper version before deployment; `npm run release:report:production` enforces the online Helper package hash after deployment; `npm run verify` now runs 33 verifier scripts including `scripts/verify-release-evidence-report.mjs`.
- Responsive layout gate added on `2026-05-26`: `scripts/verify-responsive-layout.cjs` guards desktop/tablet/phone breakpoints, overflow containment, mobile drawer bottom sheet behavior, account health/Helper/auto-switch card collapse, admin table mobile rendering, focus states, and disabled-state affordances.
- Production surface smoke refreshed on `2026-05-27`: `npm run smoke:production:surface` verified deployed static asset version `967b8412fa8a`, Helper `0.4.7`, 17 versioned frontend assets, key `app.js`/`styles.css`/`shell-ui.js`/`panels-ui.js`/`settings-ui.js`/`dialog-ui.js`/`admin-ui.js`/`oauth-core.js` surfaces, responsive breakpoints, manual-switch guard, OAuth error copy, and no obvious public secret leakage. Evidence: `artifacts/verification/production-surface-result.json` and `artifacts/verification/helper-update-release-production-result.json`.
- GitHub CI/CD hardening verified on `2026-05-26`: main CI was re-run successfully after the workflow changes, ran the pinned Windows release preflight, and uploaded the Helper artifact. Repository secret `CLOUDFLARE_ACCOUNT_ID` is set; `CLOUDFLARE_API_TOKEN` still needs to be added before GitHub-hosted Cloudflare deploys can run.
- GitHub release-readiness audit added on `2026-05-26`: the optional live audit records whether the current commit has a successful manual CI run, whether GitHub recorded the PushEvent, whether a push-triggered CI run appeared, whether GitHub-hosted deploy secret names exist, and whether external check suites are still queued. As scoped on `2026-05-27`, missing push CI observation or GitHub Cloudflare deploy secret is not a product-completion scoring item and does not block authenticated direct deployment.
- Helper `0.4.6` local release verified on `2026-05-26`: `dist\CodexDockHelper\CodexDockHelper.exe` SHA-256 is `6E936870B63ECC8A8A4C1357D56FDC850B2D9FDA81CD88967EC9D4038CDB90B2`, portable zip SHA-256 is `780F6A5FBBEAA5DBF0721A013F1B3C34F99BB8CB8321968B9BA50C2F1E1E9C45`, `/api/health` reports `lifecycle`, failure-pause fields, and tray state, `/api/lifecycle/self-test` returns `log_found: true`, `log_view_fault_tested: true`, and `log_view_fault_recovered: true`, and the device panel renders both the `failure_paused` stage plus `恢复自动切换` action and the Helper update check action.
- Auto-switch failure-loop hotfix verified on `2026-05-26`: Helper health now exposes `last_stage`, `last_stage_label`, `last_failure_stage`, `last_failure_detail`, and `failure_backoff_until`; repeated no-candidate/not-switched/switch-failed outcomes enter a 180 second backoff; stale usage snapshots older than 30 minutes are displayed as needing refresh instead of hard-blocking candidate selection as 0% quota; the browser console remained free of warnings/errors after loading `https://codex.woai.pro`.
- Manual switch task-protection guard verified on `2026-05-26`: local Browser verification simulated Helper `safe_to_switch: false`, confirmed account detail/list/manual-smart switch paths open the risk dialog instead of immediately calling `/api/apply-auth`, then confirmed the queued wait path calls Helper exactly once after `safe_to_switch: true`. Browser evidence: `artifacts/verification/manual-switch-risk-local.png`.
- Usage-refresh scheduler hardening verified on `2026-05-26`: the console settings page shows low-frequency background refresh state, `manual` mode pauses automatic stale-usage refresh entirely, and background refresh writes `usage_snapshots.refresh_kind = background` instead of mixing with user-triggered batch refresh or per-account audit rows. Browser evidence: `artifacts/verification/usage-refresh-scheduler-settings-local.png` and `artifacts/verification/usage-refresh-scheduler-settings-production.png`.
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
  - `artifacts/verification/helper-portable-release-production.png`
  - `artifacts/verification/usage-refresh-scheduler-settings-local.png`
  - `artifacts/verification/usage-refresh-scheduler-settings-production.png`
  - `artifacts/verification/manual-switch-risk-local.png`
  - `artifacts/verification/auto-switch-stage-local.png`
  - `artifacts/verification/helper-pending-revalidation-local.png`
  - `artifacts/verification/auto-switch-stage-production.png`
  - `artifacts/verification/helper-stale-reconnect-production.png`
- Responsive screenshots:
  - `artifacts/verification/codex-dock-smart-switch-tablet.png`
  - `artifacts/verification/codex-dock-helper-mobile.png`
  - `artifacts/verification/codex-dock-import-primary-drawer-mobile.png`
- Production smoke screenshot:
  - `artifacts/verification/codex-dock-production-smoke-playwright.png`
  - `artifacts/verification/codex-dock-oauth-core-live.png`
  - `artifacts/verification/codex-dock-import-primary-live.png`
- Local Helper health verified against `http://127.0.0.1:18766/` with version `0.4.7`, build date `2026-05-27`, authorized auto-switch state, cleared pending state after normal restoration, lifecycle self-test, and persisted pending revalidation recovery; `GET /api/update/check` reports current/latest `0.4.7`, matching production SHA-256, and `update_available: false`; the local status page exposes recovery state without exposing credential fingerprints. Evidence: `artifacts/verification/helper-update-local-result.json`, `artifacts/verification/helper-lifecycle-health-local-result.json`, `artifacts/verification/helper-lifecycle-self-test-local-result.json`, `artifacts/verification/helper-pending-revalidation-local-result.json`, and `artifacts/verification/helper-pending-revalidation-local.png`.
- Helper lifecycle regression verified on `2026-05-27`: `/api/lifecycle/self-test` confirms `log_found: true`, simulates RichTextBox log-view failure, confirms `log_view_fault_recovered: true`, and Helper `0.4.7` restores a persisted pending auto-switch plan as a revalidation-only state after a controlled restart, without authorizing an auth write from the restored record alone.
- Production deployment verified on `2026-05-26`: `wrangler deploy` published Worker version `7dc246a5-a4e4-4c31-b9ee-ea897b97c2f8`, API register/login/logout and usage-refresh settings smoke tests passed, and the deployed static assets use version `24a0d58f631b`.
- Online Helper download verified on `2026-05-26`: `https://codex.woai.pro/downloads/CodexDockHelper.exe` SHA-256 matches local fixed build `6E936870B63ECC8A8A4C1357D56FDC850B2D9FDA81CD88967EC9D4038CDB90B2`.
- Automated production smoke verified on `2026-05-26`: `npm run smoke:production` passed in strict local-helper-hash mode, covering register/login/logout, static asset manifest/version parity, OAuth provider-error handling, structured API error codes/request ids/diagnostic summaries, usage-refresh settings, device registration with Helper `0.4.6`, non-admin admin rejection, token-free account listing, and Helper download hash parity. Current static asset version is `24a0d58f631b`; production `index.html` has versioned JS/CSS references, the account health center, the cleanup confirmation modal, the Helper release card, the auto-switch stage card, the Helper tray repair buttons, and no stale `20260525-oauth-primary2` string.
- Helper diagnostics browser verification on `2026-05-26`: production `panels-ui.js` exposes `helperDiagnostic`, the device panel renders the Helper diagnosis card with safe-boundary guidance plus refresh, re-authorize, tray repair, local status, and diagnostics export actions. Screenshot: `artifacts/verification/helper-diagnostics-production-preview.png`.
- Helper release browser verification refreshed on `2026-05-27`: production `asset-manifest.json` reports Helper `0.4.7`, build date `2026-05-27`, size `181248`, and SHA-256 `391F8841D88F1434EAEB144A5435ACF5050AE6CCC4D7F3E5462EF90F74FAC515`; the deployed `panels-ui.js?v=4c1244761f7c` renders the release card with download, local update check, and checksum actions without horizontal overflow. De-identified screenshot and evidence: `artifacts/verification/helper-release-card-production.png` and `artifacts/verification/helper-update-release-production-result.json`.
- Helper portable package verification refreshed on `2026-05-27`: production `asset-manifest.json` exposes `downloads/CodexDockHelper-release.json` and `downloads/CodexDockHelper-0.4.7-portable.zip` with SHA-256 `87DCA57B1F815CD57FEA5215AC3A0C2462A0F186B6A8831E733C99D977D06B94`; strict production smoke verifies the EXE, ZIP, release manifest and local build parity, and browser verification confirms the Helper card renders the `下载 portable 包` action. Evidence: `artifacts/verification/helper-portable-release-production.png`.
- Account health browser verification on `2026-05-26`: production `shell-ui.js` exposes `renderHealthCenter`, the account pool renders health filter chips for usable RT, missing RT, invalid RT/token, low quota, cooldown, current account, Helper blocked, and attention states. De-identified screenshot: `artifacts/verification/account-health-production-preview.png`.
- Account cleanup browser verification on `2026-05-26`: production `dialog-ui.js` exposes `renderCleanupReview`, the batch cleanup modal shows selected, attention, usable, and re-importable counts, warns when usable accounts are included, and was captured with a de-identified screenshot: `artifacts/verification/account-cleanup-modal-production.png`.
- Auto-switch stage browser verification on `2026-05-26`: local built assets render the device page stage card from Helper-style status only, showing the protected active-turn phase, trigger, safe-boundary evidence, recent result, and next action. The captured screenshot `artifacts/verification/auto-switch-stage-local.png` was checked for no email, token, `refresh_token`, `access_token`, or `Bearer` text.
- Production auto-switch stage verification on `2026-05-26`: `wrangler deploy` published Worker version `9e011507-ecb4-49a0-8fe4-af9f0142b992` with static asset version `4c0bc4657977`; production `panels-ui.js` exposes `autoSwitchStage`, rendered `boundary_confirming`, `failure_backoff`, and `failure_paused` scenarios, kept the top diagnostic title aligned to the actual stage, and screenshots `artifacts/verification/auto-switch-stage-production.png` and `artifacts/verification/auto-switch-failure-paused-production.png` were checked for no email, token, `refresh_token`, `access_token`, or `Bearer` text.
- Admin operations summary verified on `2026-05-26`: `/api/admin/summary` aggregates users, sessions, account health, RT/AT split, latest usage failures, 24h audit failure trend, usage-refresh failures, Helper online/offline counts, and Helper version distribution without exposing credentials.
- Live browser verification on `2026-05-26`: `https://codex.woai.pro` loaded `CodexAdminUi`, rendered the admin operations summary with 3 cards and 4 trend bars, and reported no horizontal overflow.
- Live OAuth callback verification on `2026-05-26`: `https://codex.woai.pro` loaded `CodexOauthCore`; stale callback state returns `oauth_state_mismatch` and missing callback state returns `oauth_state_missing`, both with the user action "重新打开授权页面".
- Local OAuth flow regression verified on `2026-05-26`: `scripts/verify-oauth-core.cjs` covers pasted callback URLs with HTML-escaped query strings, bare `error=...` callbacks, provider failure copy, used/expired code copy, stale state, missing state, and empty callback guidance; `scripts/verify-oauth-flow-guards.cjs` guards PKCE history, state-bound verifier lookup, stale Helper callback rejection, local-only `postMessage` origins, and PKCE cleanup after successful code exchange.
- Local OAuth resume regression verified on `2026-05-26`: waiting authorization flows are stored in `codex-dock-oauth-flow-v1`, validated by `oauth-core.js`, and restored after page reload only when the matching PKCE verifier and unexpired OpenAI authorization URL still exist. Browser evidence: `artifacts/verification/oauth-flow-resume-local.png`.
- Production OAuth resume deployment verified on `2026-05-26`: `wrangler deploy` published Worker version `df3244d0-092d-46b2-80d0-cf64c8844243` with static asset version `104c1d69fe65`; `npm run smoke:production` passed, and browser verification confirmed the deployed console restores an unfinished OAuth wait after reload. Browser evidence: `artifacts/verification/oauth-flow-resume-production.png`.
- Production Helper stale/reconnect verification on `2026-05-26`: `wrangler deploy` published Worker version `cfb70692-adba-4035-aacb-b79f8e928137` with static asset version `415a45c0163f`; `/api/devices` and admin device views now expose heartbeat-derived `helperOnline`, raw `helperReportedOnline`, and `helperStale`/`需重连` state after three missed Helper heartbeats. Production smoke passed and browser-rendered evidence is `artifacts/verification/helper-stale-reconnect-production.png`.
- Production OAuth provider-error verification on `2026-05-26`: `https://codex.woai.pro` loaded `oauth-core.js?v=9e8ec588179c` and `app.js?v=9e8ec588179c`; browser evaluation returned `oauth_provider_error` for `access_denied`, preserved stale-state `oauth_state_mismatch`, found no token text in the rendered body, and emitted no console warnings/errors. Evidence: `artifacts/verification/oauth-provider-error-production-result.json`, `artifacts/verification/oauth-provider-error-production.png`, and `artifacts/verification/oauth-provider-error-production-console.log`.
- Live import drawer verification on `2026-05-26`: `https://codex.woai.pro` opens import on OAuth mode by default, shows "登录导入 RT 账号" as the primary recommended path, keeps advanced import collapsed, and has no stale asset version references.
- Live account detail diagnostics verification on `2026-05-26`: `https://codex.woai.pro` renders the detail diagnosis card for usable RT accounts and AT-only accounts; AT-only rows show "不可用于 Codex", explain missing RT, disable switch, and expose the "补 RT" action.

## Commercial Quality Gates

- Usage refresh: supports Helper, cloud Worker, automatic fallback, and manual-only mode; shows the actual source; cloud writes are capped; low-frequency background refresh is visible, bounded, and separated from user-triggered batch/audit noise.
- Task continuity: cloud only issues auto-switch payloads when the Helper confirms an idle, safe round boundary.
- Auto-switch failure control: repeated identical failures enter 180 second backoff, and 3 consecutive identical failures pause local auto-switch for 30 minutes or until the user resumes it from the device panel.
- Helper lifecycle: close-to-tray, persistent `%APPDATA%\CodexDock\helper.log`, bounded UI log buffer, redacted diagnostics export, log restore, and RichTextBox recovery are required before publishing a Helper artifact.
- Helper cloud presence: device lists and admin metrics derive online state from recent Helper heartbeats, keep the raw reported-online bit for diagnostics, and surface stale devices as `需重连` instead of leaving them falsely online.
- Helper distribution: every release publishes the raw EXE, a portable zip, and `CodexDockHelper-release.json`; smoke tests verify hashes and zip contents before a release is accepted.
- Admin operations: users, devices, Helper versions, RT/AT account health, 24h failure trend, usage-refresh failures, and audit are visible without exposing credentials.
- API diagnostics: JSON API errors include stable `code`, body/header request id, and a short `diagnostic.summary` without exposing credentials or stack traces.
- Release gate: the commercial verifier keeps the above gates, production smoke, CI/CD workflow shape, design board, and browser/desktop evidence attached to the normal preflight path instead of relying on an informal manual checklist.

