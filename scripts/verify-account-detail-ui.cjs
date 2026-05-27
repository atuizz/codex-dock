const assert = require("node:assert/strict");
const { createAccountDetailUi } = require("../account-detail-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createAccountDetailUi({
  escapeHtml: htmlEscape,
  shortId: (value) => (value ? `${String(value).slice(0, 4)}...${String(value).slice(-2)}` : "未识别"),
  formatTime: (value) => value || "无记录",
  formatResetTime: (value) => value ? `重置 ${value}` : "重置未知",
  planLabel: (value) => value === "plus" ? "Plus" : value || "未知",
  planClass: (value) => `plan-${value || "unknown"}`,
  explainError: (value) => String(value || ""),
  errorSeverity: (value) => String(value || "").includes("失效") ? "bad" : "warn",
  accountPlan: (account) => account.planType || "free",
  tokenState: (account) => account.hasRt
    ? { label: "RT", className: "ok", detail: "RT" }
    : { label: "AT", className: "warn", detail: "AT 即将过期" },
  usageIssue: (account) => account.usage?.error
    ? { label: account.usage.error, className: "bad" }
    : null,
  canUseAccount: (account) => Boolean(account.canUse),
  sourceLabel: () => "本地 + 云端",
});

const empty = ui.renderSelectedAccount({ account: null, helperReady: true });
assert.equal(empty.selectedState, "未选择账号");
assert.equal(empty.switchLabel, "立即切换");
assert.equal(empty.switchDisabled, true);
assert.match(empty.panelHtml, /选择左侧账号后显示详情/);

const account = {
  id: "detail-1",
  name: "Primary <Ops>",
  email: "primary@example.com",
  accountId: "acct-primary-detail",
  group: "默认",
  priority: "primary",
  usageNote: "watch",
  planType: "plus",
  hasRt: true,
  canUse: true,
  lastSwitchAt: "2026-05-25T02:00:00.000Z",
  usage: {
    five_hour: { remaining_percent: 72, reset_at: "soon" },
    one_week: { remaining_percent: 96, reset_at: "later" },
  },
};

const selected = ui.renderSelectedAccount({
  account,
  current: true,
  userPresent: false,
  helperReady: false,
  operationActive: false,
});
assert.equal(selected.selectedState, "primary@example.com · 正在使用 · Plus");
assert.equal(selected.detailTitle, "Primary <Ops>");
assert.equal(selected.switchLabel, "下载 auth.json");
assert.equal(selected.switchDisabled, false);
assert.equal(selected.copyDisabled, false);
assert.match(selected.panelHtml, /Primary &lt;Ops&gt;/);
assert.match(selected.panelHtml, /正在使用/);
assert.match(selected.panelHtml, /诊断结论/);
assert.match(selected.panelHtml, /无需切换；如需换号，可选择其它可用 RT 账号。/);
assert.match(selected.panelHtml, /本地 \+ 云端/);
assert.match(selected.panelHtml, /72% 剩余/);
assert.match(selected.panelHtml, /data-selected-action="copy-email"/);
assert.match(selected.panelHtml, /option value="primary" selected/);
assert.doesNotMatch(selected.panelHtml, /授权需要更新/);

const helperOffline = ui.renderSelectedAccount({
  account: { ...account, id: "detail-2", lastSwitchAt: "" },
  current: false,
  userPresent: true,
  helperReady: false,
  operationActive: false,
});
assert.equal(helperOffline.selectedState, "primary@example.com · 可用，Agent 未连接 · Plus");
assert.match(helperOffline.panelHtml, /启动 Dock Agent 后可一键切换/);
assert.match(helperOffline.panelHtml, /下载 auth\.json/);

const blocked = ui.renderSelectedAccount({
  account: {
    ...account,
    canUse: false,
    hasRt: false,
    usage: { error: "Token 已失效", five_hour: null, one_week: null },
  },
  userPresent: true,
  helperReady: true,
  operationActive: true,
});
assert.equal(blocked.switchLabel, "立即切换");
assert.equal(blocked.switchDisabled, true);
assert.equal(blocked.copyDisabled, true);
assert.match(blocked.panelHtml, /Token 已失效/);
assert.match(blocked.panelHtml, /暂不可用/);
assert.match(blocked.panelHtml, /点击“补 RT”，用这个账号重新网页登录。/);
assert.match(blocked.panelHtml, /通过 OAuth 登录补 RT/);
assert.match(blocked.panelHtml, /不要用当前本机 auth 覆盖它/);
assert.doesNotMatch(blocked.panelHtml, /data-auth-action="sync-local-auth"/);
assert.doesNotMatch(blocked.panelHtml, /data-auth-action="copy-codex-login"/);
assert.doesNotMatch(blocked.panelHtml, /data-auth-action="open-import-file"/);
assert.match(blocked.panelHtml, /data-auth-action="open-import-oauth-login"/);
assert.match(blocked.panelHtml, /不可用/);

console.log("account-detail-ui verification passed");
