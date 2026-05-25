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
  codex: {
    label: "空闲",
    detail: "连续 42 秒没有任务类日志。",
    pending_switch_reason: "5H 剩余 0%",
  },
});
assert.match(helperHtml, /Codex：空闲/);
assert.match(helperHtml, /5H 剩余 0%/);

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

console.log("settings-ui verification passed");
