const assert = require("node:assert/strict");
const { createShellUi } = require("../shell-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

let cloudBackup = true;
let currentId = "acct-current";
const ui = createShellUi({
  escapeHtml: htmlEscape,
  formatBytes: (value) => `${value} bytes`,
  cloudBackupEnabled: () => cloudBackup,
  canUseAccount: (account) => Boolean(account.usable),
  resolveCurrentAccountId: () => currentId,
  accountPlan: (account) => account.planType,
  tokenState: (account) => ({ className: account.warn ? "warn" : "ok" }),
});

const attachments = ui.renderCommandAttachments([
  { name: "auth<1>.json", size: 12 },
]);
assert.match(attachments, /auth&lt;1&gt;\.json/);
assert.match(attachments, /12 bytes/);
assert.match(attachments, /data-attachment-index="0"/);

assert.deepEqual(ui.commandShellState({ files: [], accounts: [{ usable: false }] }), {
  hasFiles: false,
  quickSwitchText: "智能切换",
  quickSwitchDisabled: true,
});
assert.deepEqual(ui.commandShellState({ files: [{ name: "auth.json" }], accounts: [] }), {
  hasFiles: true,
  quickSwitchText: "解析导入",
  quickSwitchDisabled: false,
});

const toolbar = ui.toolbarState({
  filtered: [{ id: "a" }, { id: "b" }],
  selectedBulkIds: new Set(["b"]),
  helperReady: true,
  isInvalidAccount: (account) => account.id === "b",
});
assert.equal(toolbar.bulkText, "已选择 1 个账号");
assert.equal(toolbar.refreshDisabled, false);
assert.equal(toolbar.exportDisabled, false);
assert.equal(toolbar.deleteText, "清理不可用");
assert.match(toolbar.cleanupHint, /需处理账号/);

const metrics = ui.renderMetrics([
  { id: "a", planType: "plus", usage: { refreshed_at: "now" }, warn: false },
  { id: "b", planType: "free", usage: { error: "failed" }, warn: true },
]);
assert.match(metrics, /账号总数/);
assert.match(metrics, /付费等级/);
assert.match(metrics, /需处理账号/);
assert.match(metrics, /<strong>1<\/strong>/);

const health = ui.renderHealthCenter({
  total: 4,
  activeKey: "missing-rt",
  groups: [
    { key: "all", label: "全部", count: 4, description: "当前账号池" },
    { key: "ready-rt", label: "可用 RT", count: 2, className: "ok", description: "可直接切换" },
    { key: "missing-rt", label: "缺 RT", count: 1, className: "warn", description: "需重新登录" },
  ],
});
assert.match(health, /账号健康/);
assert.match(health, /data-health-filter="missing-rt"/);
assert.match(health, /health-chip warn active/);
assert.match(health, /批量工具/);

const emptyHealth = ui.renderHealthCenter({ total: 0, groups: [] });
assert.match(emptyHealth, /导入账号后/);

const shell = ui.shellViewModel({
  authResolved: true,
  accounts: [{ usable: true }],
  cloudAccounts: [{ id: "cloud" }],
  user: { email: "user@example.com", role: "admin" },
  helperReady: true,
  helperInfo: { auto_switch: { authorized: true } },
  codexStatus: { state: "idle", label: "空闲" },
  autoSwitchSettings: { enabled: true },
  autoSwitchStatus: { helperAuthorized: true },
  currentView: "accounts",
  sidebarCollapsed: false,
  commandFiles: [],
});
assert.equal(shell.homeHeadline, "选择一个账号，或交给智能切换");
assert.equal(shell.sideCloudText, "user@example.com · 已同步");
assert.equal(shell.autoSwitchPillClass, "status-pill ready");
assert.equal(shell.codexPillClass, "status-pill ready");
assert.equal(shell.adminOnlyHidden, false);
assert.equal(shell.refreshAllUsageDisabled, false);

const cloudShell = ui.shellViewModel({
  authResolved: true,
  accounts: [{ usable: true, cloudId: "cloud-account" }],
  user: { email: "user@example.com" },
  helperReady: false,
  usageRefreshSettings: { usageRefreshMode: "cloud", cloudUsageRefreshEnabled: true },
});
assert.equal(cloudShell.refreshAllUsageDisabled, false);

const cloudToolbar = ui.toolbarState({
  filtered: [{ id: "cloud-account", cloudId: "cloud-account" }],
  selectedBulkIds: new Set(["cloud-account"]),
  helperReady: false,
  canRefreshUsage: (account) => Boolean(account.cloudId),
});
assert.equal(cloudToolbar.refreshDisabled, false);

const foreignAuthorizationShell = ui.shellViewModel({
  authResolved: true,
  accounts: [],
  user: { email: "preview@example.com" },
  helperReady: true,
  helperInfo: { auto_switch: { authorized: true } },
  autoSwitchSettings: { enabled: true },
  autoSwitchStatus: { helperAuthorized: false },
});
assert.match(foreignAuthorizationShell.autoSwitchPillHtml, /自动切换待授权/);

cloudBackup = false;
currentId = "";
const localShell = ui.shellViewModel({
  authResolved: true,
  accounts: [],
  user: null,
  helperReady: false,
  currentView: "helper",
  sidebarCollapsed: true,
});
assert.equal(localShell.viewSubtitle, "安装后即可自动写入 auth 并重启 Codex。");
assert.equal(localShell.vaultTitle, "本地账号池 · 0 个账号");
assert.equal(localShell.adminOnlyHidden, true);
assert.equal(localShell.sidebarToggleLabel, "展开侧边栏");

console.log("shell-ui verification passed");
