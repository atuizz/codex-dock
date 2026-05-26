import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const textCache = new Map();

async function readText(relativePath) {
  if (!textCache.has(relativePath)) {
    textCache.set(relativePath, await readFile(join(repoRoot, relativePath), "utf8"));
  }
  return textCache.get(relativePath);
}

async function expectText(relativePath, checks) {
  const source = await readText(relativePath);
  for (const check of checks) {
    assert.match(source, check.pattern, `${relativePath} should cover ${check.label}`);
  }
}

async function expectNonEmpty(relativePath, minBytes = 128) {
  const file = join(repoRoot, relativePath);
  const info = await stat(file);
  assert.ok(info.size >= minBytes, `${relativePath} should exist and be non-empty`);
}

const releaseGates = [
  {
    name: "account and session security",
    file: "scripts/verify-worker-auth.mjs",
    checks: [
      { label: "registration", pattern: /\/api\/auth\/register/ },
      { label: "login", pattern: /\/api\/auth\/login/ },
      { label: "logout", pattern: /\/api\/auth\/logout/ },
      { label: "session lookup", pattern: /requireUser/ },
      { label: "disabled user denial", pattern: /disabledLogin/ },
      { label: "large body guard", pattern: /request body too large/ },
    ],
  },
  {
    name: "OAuth and RT-first import",
    file: "scripts/verify-oauth-flow-guards.cjs",
    checks: [
      { label: "PKCE state history", pattern: /oauthPkceHistoryStorage/ },
      { label: "refresh and reopen flow recovery", pattern: /restoreOauthFlow/ },
      { label: "state-bound verifier lookup", pattern: /exchange resolves PKCE by returned state/ },
      { label: "stale callback rejection", pattern: /stale|旧|mismatch/i },
      { label: "local callback origin guard", pattern: /postMessage|Origin|localhost/i },
      { label: "PKCE cleanup after exchange", pattern: /forgetOauthPkce/ },
    ],
  },
  {
    name: "OAuth user-facing error handling",
    file: "scripts/verify-oauth-core.cjs",
    checks: [
      { label: "provider error code", pattern: /oauth_provider_error/ },
      { label: "state mismatch", pattern: /oauth_state_mismatch/ },
      { label: "expired code copy", pattern: /expired|已过期|used/i },
      { label: "single recovery action", pattern: /重新打开授权页面/ },
    ],
  },
  {
    name: "account health and manual switch",
    file: "scripts/verify-worker-accounts.mjs",
    checks: [
      { label: "RT payload", pattern: /switchPayloadForAccount/ },
      { label: "AT-only rejection", pattern: /account_at_not_supported/ },
      { label: "low quota candidate block", pattern: /5H 剩余 1%/ },
      { label: "stale usage remains refreshable", pattern: /额度待刷新/ },
      { label: "manual switch audit", pattern: /switch-payload/ },
      { label: "audit redaction", pattern: /doesNotMatch\(JSON\.stringify\(routeAudits\.at\(-1\)\), \/rt-live\|access_token\|refresh_token\/i\)/ },
    ],
  },
  {
    name: "usage refresh execution channels",
    file: "scripts/verify-worker-usage.mjs",
    checks: [
      { label: "default helper-first mode", pattern: /usageRefreshMode,\s*"helper"/ },
      { label: "auto cloud fallback", pattern: /auto-cloud-fallback/ },
      { label: "cloud daily limit", pattern: /cloud_usage_daily_limit/ },
      { label: "audit noise suppression", pattern: /audit:\s*false/ },
      { label: "background refresh kind", pattern: /refresh_kind.*"background"|background:\s*true/ },
      { label: "source persistence", pattern: /refresh_source/ },
    ],
  },
  {
    name: "usage freshness and background refresh guard",
    file: "scripts/verify-usage-refresh-guards.cjs",
    checks: [
      { label: "30 minute freshness window", pattern: /usageFreshWindowMs|USAGE_STALE_MS/ },
      { label: "background stale refresh", pattern: /refreshStaleUsageInBackground/ },
      { label: "manual mode pauses scheduler", pattern: /usageRefreshMode === "manual"/ },
      { label: "silent batch refresh", pattern: /silent:\\s\*true,\s*\\s\*batch:\\s\*true,\s*\\s\*background:\\s\*true/ },
      { label: "stale usage does not hard-block candidates", pattern: /avoidLow5h/ },
    ],
  },
  {
    name: "helper authorization and safe auto-switch",
    file: "scripts/verify-worker-helper.mjs",
    checks: [
      { label: "device token issuance", pattern: /auto-switch-token/ },
      { label: "token rotation", pattern: /replacementDeviceToken/ },
      { label: "token revocation", pattern: /revoked/ },
      { label: "heartbeat-derived stale status", pattern: /HELPER_OFFLINE_AFTER_SECONDS|helperStale/ },
      { label: "safe boundary hold", pattern: /等待 Helper 确认安全轮次边界/ },
      { label: "no-candidate result", pattern: /没有可用候选账号/ },
      { label: "payload issued only after boundary confirmation", pattern: /payload-issued[\s\S]*boundaryConfirmed/ },
      { label: "helper audit redaction", pattern: /doesNotMatch\(JSON\.stringify\(audits\.at\(-1\)\), \/cdh_\|token_hash\|replacementDeviceToken\/i\)/ },
    ],
  },
  {
    name: "helper lifecycle, logging, and update channel",
    file: "scripts/verify-helper-diagnostics.cjs",
    checks: [
      { label: "diagnostics export", pattern: /\/api\/diagnostics\/export/ },
      { label: "tray repair", pattern: /RepairTrayIconFromAnyThread/ },
      { label: "RichTextBox recovery", pattern: /RecoverRichTextState/ },
      { label: "redaction", pattern: /RedactDiagnosticText/ },
      { label: "failure backoff", pattern: /AutoSwitchFailureBackoff/ },
      { label: "failure pause", pattern: /AutoSwitchFailurePauseThreshold/ },
      { label: "update check", pattern: /\/api\/update\/check/ },
      { label: "current Helper version", pattern: /0\.4\.5/ },
      { label: "portable release package", pattern: /Compress-Archive|CodexDockHelper-release\\\.json|portable\\\.zip/i },
    ],
  },
  {
    name: "admin operations and audit",
    file: "scripts/verify-worker-admin-audit.mjs",
    checks: [
      { label: "admin denial", pattern: /assert\.equal\(denied\.status,\s*403\)|assert\.equal\(assertAdmin\(user\), false\)/ },
      { label: "admin summary", pattern: /\/api\/admin\/summary/ },
      { label: "account health aggregation", pattern: /accountHealth/ },
      { label: "failure trend", pattern: /failureTrend/ },
      { label: "helper version distribution", pattern: /helperVersions/ },
      { label: "user governance", pattern: /admin-update-user/ },
      { label: "password reset", pattern: /admin-reset-password/ },
    ],
  },
  {
    name: "production smoke",
    file: "scripts/verify-production-smoke.mjs",
    checks: [
      { label: "online base URL", pattern: /https:\/\/codex\.woai\.pro/ },
      { label: "static asset manifest parity", pattern: /asset-manifest\.json/ },
      { label: "register", pattern: /\/api\/auth\/register/ },
      { label: "logout", pattern: /\/api\/auth\/logout/ },
      { label: "structured API errors", pattern: /diagnostic\?\.summary/ },
      { label: "usage settings", pattern: /\/api\/settings\/usage-refresh/ },
      { label: "normal user admin denial", pattern: /normal smoke user must not access admin summary/ },
      { label: "token-free account list", pattern: /account list must not expose token material/ },
      { label: "Helper download hash parity", pattern: /online Helper download should match local dist build/ },
    ],
  },
];

for (const gate of releaseGates) {
  await expectText(gate.file, gate.checks);
}

const uiGates = [
  {
    file: "scripts/verify-import-ui.cjs",
    checks: [
      { label: "OAuth primary import action", pattern: /打开授权页面/ },
      { label: "advanced JSON fallback", pattern: /高级 JSON/ },
      { label: "AT-only warning", pattern: /仅 AT · 不支持 Codex/ },
    ],
  },
  {
    file: "scripts/verify-account-detail-ui.cjs",
    checks: [
      { label: "diagnosis card", pattern: /诊断结论/ },
      { label: "OAuth RT recovery action", pattern: /data-auth-action="open-import-oauth-login"/ },
      { label: "blocked technical sync actions", pattern: /doesNotMatch\(blocked\.panelHtml, \/data-auth-action="sync-local-auth"\// },
    ],
  },
  {
    file: "scripts/verify-admin-ui.cjs",
    checks: [
      { label: "account health UI", pattern: /账号健康/ },
      { label: "failure trend UI", pattern: /失败趋势/ },
      { label: "Helper version UI", pattern: /Helper 版本分布/ },
      { label: "Helper reconnect UI", pattern: /需重连 Helper|helperStale/ },
      { label: "outdated Helper marker", pattern: /待升级/ },
    ],
  },
  {
    file: "scripts/verify-settings-ui.cjs",
    checks: [
      { label: "usage refresh channel UI", pattern: /usageRefreshMode|额度刷新/ },
      { label: "Helper preferred mode", pattern: /helper|本机 Helper/i },
    ],
  },
  {
    file: "scripts/verify-panels-ui.cjs",
    checks: [
      { label: "Helper diagnostics panel", pattern: /helperDiagnostic|Helper 诊断/ },
      { label: "auto-switch stage panel", pattern: /autoSwitchStage|自动切换阶段/ },
      { label: "Helper update panel", pattern: /检查更新|update/i },
      { label: "Helper portable package action", pattern: /下载 portable 包/ },
    ],
  },
  {
    file: "scripts/verify-manual-switch-guard.cjs",
    checks: [
      { label: "manual switch risk modal", pattern: /manualSwitchRiskModal|任务仍在运行/ },
      { label: "safe boundary wait path", pattern: /waitedForBoundary|maybeRunPendingManualSwitchAfterBoundary/ },
      { label: "manual force audit marker", pattern: /manualForce|manual-forced/ },
    ],
  },
  {
    file: "scripts/verify-responsive-layout.cjs",
    checks: [
      { label: "desktop/tablet/mobile breakpoints", pattern: /max-width: 1180px[\s\S]*max-width: 860px[\s\S]*max-width: 460px/ },
      { label: "overflow guard", pattern: /page should not create horizontal overflow[\s\S]*main content should clip accidental overflow/ },
      { label: "phone drawer bottom sheet", pattern: /phone import drawer should become a bottom sheet/ },
    ],
  },
];

for (const gate of uiGates) {
  await expectText(gate.file, gate.checks);
}

await expectText("package.json", [
  { label: "Helper build in preflight", pattern: /"preflight":\s*"npm run helper:verify-build && npm run verify"/ },
  { label: "release evidence report command", pattern: /"release:report":\s*"node \.\/scripts\/generate-release-evidence-report\.mjs"/ },
  { label: "local verifier runner", pattern: /"verify":\s*"node \.\/scripts\/run-local-verifiers\.mjs"/ },
]);

await expectText("scripts/run-local-verifiers.mjs", [
  { label: "all local verify scripts are discovered", pattern: /\/\^verify-\.\*\\\.\(\?:cjs\|mjs\)\$\// },
  { label: "production smoke is explicitly separate", pattern: /name !== "verify-production-smoke\.mjs"/ },
  { label: "static assets build before verification", pattern: /Building Cloudflare static assets/ },
]);

await expectText("scripts/generate-release-evidence-report.mjs", [
  { label: "Helper lifecycle evidence", pattern: /helper-lifecycle-self-test-local-result\.json/ },
  { label: "production Helper evidence", pattern: /helper-update-release-production-result\.json/ },
  { label: "CI/CD evidence", pattern: /ci_workflow_configured|deploy_workflow_configured/ },
]);

await expectText(".github/workflows/ci.yml", [
  { label: "Windows release preflight", pattern: /windows-2025[\s\S]*npm run preflight/ },
  { label: "Helper artifact upload", pattern: /Upload Helper artifact[\s\S]*artifacts\/build\/CodexDockHelper\// },
]);

await expectText(".github/workflows/cloudflare-deploy.yml", [
  { label: "manual preview/production target", pattern: /workflow_dispatch[\s\S]*target:[\s\S]*preview[\s\S]*production/ },
  { label: "Cloudflare secret guard", pattern: /Missing GitHub secret: CLOUDFLARE_API_TOKEN/ },
  { label: "D1 migrations", pattern: /wrangler d1 migrations apply codex-cloud-console --remote/ },
  { label: "Worker deploy", pattern: /wrangler deploy/ },
  { label: "production smoke", pattern: /npm run smoke:production/ },
]);

await expectText("docs/release-and-verification.md", [
  { label: "commercial quality gates", pattern: /## Commercial Quality Gates/ },
  { label: "current verification evidence", pattern: /## Current Verification Evidence/ },
  { label: "latest Helper release", pattern: /Helper `0\.4\.5`/ },
  { label: "production smoke evidence", pattern: /npm run smoke:production/ },
]);

const visualEvidence = [
  "artifacts/design/codex-dock-commercial-interface-reference-board-v1.png",
  "artifacts/verification/codex-dock-helper-diagnostics-desktop.png",
  "artifacts/verification/codex-dock-settings-usage-channel-desktop.png",
  "artifacts/verification/codex-dock-smart-switch-protection-desktop.png",
  "artifacts/verification/codex-dock-smart-switch-tablet.png",
  "artifacts/verification/codex-dock-helper-mobile.png",
  "artifacts/verification/codex-dock-import-primary-drawer-desktop.png",
  "artifacts/verification/codex-dock-import-primary-drawer-mobile.png",
  "artifacts/verification/codex-dock-account-detail-diagnostics-local.png",
  "artifacts/verification/oauth-flow-resume-local.png",
  "artifacts/verification/oauth-flow-resume-production.png",
  "artifacts/verification/codex-dock-admin-ops-summary-browser.png",
  "artifacts/verification/account-health-production-preview.png",
  "artifacts/verification/account-cleanup-modal-production.png",
  "artifacts/verification/helper-release-card-production.png",
  "artifacts/verification/helper-portable-release-production.png",
  "artifacts/verification/usage-refresh-scheduler-settings-local.png",
  "artifacts/verification/usage-refresh-scheduler-settings-production.png",
  "artifacts/verification/manual-switch-risk-local.png",
  "artifacts/verification/helper-lifecycle-health-local-result.json",
  "artifacts/verification/helper-lifecycle-self-test-local-result.json",
  "artifacts/verification/auto-switch-stage-production.png",
  "artifacts/verification/helper-stale-reconnect-production.png",
  "artifacts/verification/oauth-provider-error-production-result.json",
  "artifacts/verification/helper-update-release-production-result.json",
];

for (const artifact of visualEvidence) {
  await expectNonEmpty(artifact);
}

console.log(`commercial release gate verification passed (${releaseGates.length + uiGates.length} gates, ${visualEvidence.length} evidence artifacts)`);
