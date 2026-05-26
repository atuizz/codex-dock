const assert = require("node:assert/strict");
const { createSettingsUi } = require("../settings-ui.js");

const ui = createSettingsUi({
  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char]);
  },
});

const accountHtml = ui.renderAccountState({
  user: { email: "ops<team>@example.com", role: "admin", status: "active" },
});
assert.match(accountHtml, /ops&lt;team&gt;@example\.com/);
assert.match(accountHtml, /管理员账号/);
assert.match(accountHtml, /logoutInlineBtn/);

const backupHtml = ui.renderBackupCloudState({
  user: { email: "ops@example.com" },
  localAccountCount: 7,
  cloudBackupEnabled: true,
});
assert.match(backupHtml, /本机离线副本 7 个/);
assert.match(backupHtml, /checked/);

const helperHtml = ui.renderHelperState({
  helperReady: true,
  helper: { version: "0.3.1" },
  minimumHelperVersion: "0.4.2",
  helperRelease: {
    version: "0.4.4",
    build_date: "2026-05-26",
    sha256: "1EC50E1E200624A639E4213092481A63572C365E06DD4A19047797D13525039B",
  },
  codex: {
    label: "空闲",
    detail: "连续 42 秒没有任务类日志。",
    pending_switch_reason: "5H 剩余 0%",
  },
});
assert.match(helperHtml, /Codex：空闲/);
assert.match(helperHtml, /最新发布：v0\.4\.4 · 2026-05-26/);
assert.match(helperHtml, /1EC50E1E2006/);
assert.match(helperHtml, /5H 剩余 0%/);
assert.match(helperHtml, /版本过旧/);

const usageHtml = ui.renderUsageRefreshSettings({
  user: { email: "ops@example.com" },
  helperReady: false,
  usageSettings: {
    usageRefreshMode: "auto",
    cloudUsageRefreshEnabled: true,
    helperFallbackToCloud: true,
    usageRefreshConcurrency: 2,
    usageRefreshIntervalMs: 3000,
    lastUsageRefreshSource: "auto-cloud-fallback",
    lastUsageRefreshAt: "2026-05-26T00:00:00Z",
  },
});
assert.match(usageHtml, /data-usage-refresh-setting="usageRefreshMode"/);
assert.match(usageHtml, /value="auto" selected/);
assert.match(usageHtml, /自动选择 \/ 云端回退/);
assert.match(usageHtml, /data-usage-refresh-setting="cloudUsageRefreshEnabled"[^>]+checked/);
assert.match(usageHtml, /data-usage-refresh-setting="helperFallbackToCloud"[^>]+checked/);
assert.match(usageHtml, /value="2" selected>2/);
assert.match(usageHtml, /value="3000" selected>3 秒/);

const localUsageHtml = ui.renderUsageRefreshSettings({
  user: null,
  helperReady: true,
  usageSettings: { usageRefreshMode: "helper" },
});
assert.match(localUsageHtml, /value="cloud"[^>]+disabled/);

const smartHtml = ui.renderSmartSwitchSettings({
  user: { email: "ops@example.com" },
  helperReady: true,
  helperInfo: { auto_switch: { authorized: true, effective_poll_seconds: 15 } },
  autoSwitchStatus: { helperAuthorized: true },
  defaultAutoSwitchSettings: {
    fiveHourThreshold: 5,
    oneWeekThreshold: 5,
    pollSeconds: 15,
    globalCooldownSeconds: 180,
    cooldownMinutes: 10,
  },
  autoSettings: {
    enabled: true,
    paidOnly: true,
    preferRt: true,
    showExperimentalAt: true,
    allowAt: true,
    avoidCurrent: true,
    onlyWhenIdle: true,
    idleSeconds: 10,
    globalCooldownSeconds: 30,
    cooldownMinutes: 3,
  },
  smartSettings: {
    paidOnly: false,
    preferRt: true,
    showExperimentalAt: true,
    allowAt: true,
    avoidCurrent: true,
    avoidLow5h: true,
    avoidLow7d: true,
    cooldownMinutes: 5,
  },
});
assert.match(smartHtml, /本机 Helper 已授权/);
assert.match(smartHtml, /任务连续性保护/);
assert.match(smartHtml, /强制开启/);
assert.match(smartHtml, /value="3" selected>3 分钟/);
assert.match(smartHtml, /value="30" selected>30 秒/);
assert.match(smartHtml, /data-smart-setting="cooldownMinutes"/);
assert.match(smartHtml, /value="5" selected>5 分钟/);
assert.match(smartHtml, /data-auto-switch-setting="showExperimentalAt"[^>]+checked/);
assert.match(smartHtml, /data-auto-switch-setting="allowAt"[^>]+checked/);
assert.match(smartHtml, /data-smart-setting="showExperimentalAt"[^>]+checked/);
assert.match(smartHtml, /data-smart-setting="allowAt"[^>]+checked/);

const disabledHtml = ui.renderSmartSwitchSettings({
  user: null,
  helperReady: false,
  autoSettings: {},
  smartSettings: {},
});
assert.match(disabledHtml, /登录后可开启/);
assert.match(disabledHtml, /data-auto-switch-setting="enabled"[^>]+disabled/);
assert.doesNotMatch(disabledHtml, /data-auto-switch-setting="allowAt"/);
assert.doesNotMatch(disabledHtml, /data-smart-setting="allowAt"/);

const foreignHelperHtml = ui.renderSmartSwitchSettings({
  user: { email: "preview@example.com" },
  helperReady: true,
  helperInfo: { auto_switch: { authorized: true, cloud_base: "https://production.example.com" } },
  autoSwitchStatus: { helperAuthorized: false },
  autoSettings: {},
  smartSettings: {},
  defaultAutoSwitchSettings: {},
});
assert.match(foreignHelperHtml, /需要授权本机 Helper/);
assert.doesNotMatch(foreignHelperHtml, /本机 Helper 已授权/);

console.log("settings-ui verification passed");

