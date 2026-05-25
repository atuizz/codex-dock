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
});
assert.equal(toolbar.bulkText, "已选择 1 个账号");
assert.equal(toolbar.refreshDisabled, false);
assert.equal(toolbar.exportDisabled, false);

const metrics = ui.renderMetrics([
  { id: "a", planType: "plus", usage: { refreshed_at: "now" }, warn: false },
  { id: "b", planType: "free", usage: { error: "failed" }, warn: true },
]);
assert.match(metrics, /账号总数/);
assert.match(metrics, /付费等级/);
assert.match(metrics, /需处理账号/);
assert.match(metrics, /<strong>1<\/strong>/);

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
