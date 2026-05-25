const assert = require("node:assert/strict");
const { createPanelsUi } = require("../panels-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createPanelsUi({
  escapeHtml: htmlEscape,
  formatTime: (value) => value || "无记录",
  auditTitle: (item) => item.action === "switch" ? "账号已切换" : "操作记录",
  auditDescription: (item) => item.result || "已完成",
});

assert.equal(ui.codexStatusSourceLabel({ source: "logs_2.sqlite" }), "任务日志");
assert.equal(ui.codexStatusSourceLabel({ source: "process" }), "进程检测");

const emptyAudit = ui.renderAudit([]);
assert.match(emptyAudit, /还没有云端运行记录/);

const auditHtml = ui.renderAudit([
  { at: "刚刚", action: "switch", result: "switched" },
]);
assert.match(auditHtml, /账号已切换/);
assert.match(auditHtml, /switched/);

const deviceHtml = ui.renderDevice({
  helperReady: true,
  helper: { port: 18766, version: "0.4.2", build_date: "2026-05-26" },
  helperBase: "http://127.0.0.1:18766",
  codex: {
    source: "logs_2.sqlite",
    label: "空闲",
    idle_seconds: 42,
    last_task_event: "任务完成",
    last_task_event_at: "刚刚",
    pending_switch_reason: "无",
    safe_to_switch: true,
  },
  currentAuthMatched: true,
});
assert.match(deviceHtml, /在线/);
assert.match(deviceHtml, /v0\.4\.2/);
assert.match(deviceHtml, /http:\/\/127\.0\.0\.1:18766/);
assert.match(deviceHtml, /任务日志/);
assert.match(deviceHtml, /42 秒/);
assert.match(deviceHtml, /已识别/);

const emptySecurity = ui.securitySummary(null);
assert.equal(emptySecurity.preview, "选择账号后显示摘要。");
assert.equal(emptySecurity.warningHidden, true);

const cloudOnly = ui.securitySummary(
  {
    accountId: "acct-cloud",
    email: "cloud@example.com",
    planType: "plus",
    expiresAt: "2026-06-01T00:00:00.000Z",
    hasLocalSecret: false,
    cloudId: "cloud-1",
  },
  {
    userPresent: false,
    accountPlan: (account) => account.planType,
    hasUsableRefreshToken: () => false,
  },
);
assert.match(cloudOnly.preview, /cloud@example\.com/);
assert.equal(cloudOnly.warningHidden, false);
assert.match(cloudOnly.warningText, /只有云端元数据/);

const noRefresh = ui.securitySummary(
  {
    accountId: "acct-at",
    email: "at@example.com",
    planType: "free",
    hasLocalSecret: true,
  },
  {
    userPresent: true,
    accountPlan: (account) => account.planType,
    hasUsableRefreshToken: () => false,
  },
);
assert.match(noRefresh.warningText, /refresh_token 缺失/);

console.log("panels-ui verification passed");

