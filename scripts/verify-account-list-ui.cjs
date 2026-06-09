const assert = require("node:assert/strict");
const { createAccountListUi } = require("../account-list-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createAccountListUi({
  escapeHtml: htmlEscape,
  shortId: (value) => (value ? `${String(value).slice(0, 4)}...` : "未识别"),
  formatRefreshTime: (value) => value || "未刷新",
  planLabel: (value) => value === "plus" ? "Plus" : value || "未知",
  planClass: (value) => `plan-${value || "unknown"}`,
  explainError: (value) => String(value || ""),
  errorSeverity: (value) => String(value || "").includes("失效") ? "bad" : "warn",
  accountPlan: (account) => account.planType || "free",
  tokenState: (account) => account.hasRt
    ? { label: "RT", className: "ok" }
    : { label: "AT", className: "ok" },
  usageIssue: (account) => account.usage?.error
    ? { label: account.usage.error, className: "bad" }
    : null,
  accountActionMode: (account) => account.mode || "direct-switch",
  sourceLabel: () => "本地 + 云端",
});

const accounts = [
  {
    id: "acc-1",
    name: "Primary <Ops>",
    email: "primary@example.com",
    accountId: "acct-primary",
    planType: "plus",
    hasRt: true,
    mode: "direct-switch",
    usage: {
      refreshed_at: "刚刚",
      five_hour: { remaining_percent: 88 },
      one_week: { remaining_percent: 92 },
    },
  },
  {
    id: "acc-2",
    name: "Broken",
    email: "",
    accountId: "acct-broken-long",
    planType: "free",
    mode: "unavailable",
    usage: {
      error: "Token 已失效",
      five_hour: null,
      one_week: null,
    },
  },
];

const loading = ui.renderAccountGrid({ authResolved: false, accounts: [], selectedBulkIds: new Set() });
assert.match(loading.html, /正在加载账号池/);
assert.match(loading.className, /account-list/);

const empty = ui.renderAccountGrid({ authResolved: true, accounts: [], totalAccounts: 2, selectedBulkIds: new Set() });
assert.match(empty.html, /没有匹配账号/);

const list = ui.renderAccountGrid({
  authResolved: true,
  accounts,
  totalAccounts: accounts.length,
  selectedId: "acc-1",
  currentId: "acc-1",
  selectedBulkIds: new Set(["acc-2"]),
  userPresent: false,
  helperReady: true,
  operationActive: false,
});
assert.match(list.className, /account-list/);
assert.match(list.html, /Primary &lt;Ops&gt;/);
assert.match(list.html, /正在使用/);
assert.match(list.html, /本地 \+ 云端/);
assert.match(list.html, /data-account-action="refresh-usage"/);
assert.match(list.html, /88%/);
assert.match(list.html, /Token 已失效/);
assert.match(list.html, /data-bulk-id="acc-2" checked/);
assert.match(list.html, /不可用/);

const teamUsage = ui.renderAccountGrid({
  authResolved: true,
  layout: "cards",
  accounts: [{
    ...accounts[0],
    id: "team-primary",
    planType: "team",
    usage: {
      refreshed_at: "刚刚",
      primary_window: { used_percent: 12, remaining_percent: 88, window_seconds: 2628000 },
    },
  }],
  totalAccounts: 1,
  selectedBulkIds: new Set(),
  userPresent: true,
  helperReady: true,
  operationActive: false,
});
assert.match(teamUsage.html, /30D/);
assert.doesNotMatch(teamUsage.html, /5H/);

const cards = ui.renderAccountGrid({
  authResolved: true,
  layout: "cards",
  accounts: [accounts[0]],
  totalAccounts: 1,
  selectedBulkIds: new Set(),
  userPresent: true,
  helperReady: false,
  operationActive: true,
});
assert.match(cards.className, /account-card-grid/);
assert.match(cards.html, /account-card/);
assert.match(cards.html, /data-account-action="switch"[^>]+disabled/);
assert.match(cards.html, /data-account-action="refresh-usage"[^>]+disabled/);

const recovery = ui.renderAccountGrid({
  authResolved: true,
  accounts: [{
    ...accounts[0],
    id: "stale",
    mode: "sync-auth",
  }],
  totalAccounts: 1,
  selectedBulkIds: new Set(),
  userPresent: true,
  helperReady: true,
  operationActive: false,
});
assert.match(recovery.html, />更新<\/button>/);
assert.match(recovery.html, /data-account-action="recover-auth"/);
assert.match(recovery.html, /data-account-action="refresh-usage"[^>]+disabled/);
assert.match(recovery.html, /account-row[^"]*unavailable/);

console.log("account-list-ui verification passed");
