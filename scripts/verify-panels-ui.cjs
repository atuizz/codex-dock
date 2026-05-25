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
assert.equal(ui.helperDiagnostic({ helperReady: false }).title, "Helper 未连接");
assert.equal(ui.helperDiagnostic({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true } },
  helperAuthorized: true,
  codex: { safe_to_switch: false, detail: "任务中" },
}).title, "等待安全边界");
assert.equal(ui.helperDiagnostic({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true }, tray: { visible: false } },
  helperAuthorized: true,
  codex: { safe_to_switch: true },
}).title, "托盘需要修复");

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
  helperAuthorized: true,
  userPresent: true,
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
assert.match(deviceHtml, /诊断结论/);
assert.match(deviceHtml, /Helper 可用/);
assert.match(deviceHtml, /设备授权/);
assert.match(deviceHtml, /最近心跳/);
assert.match(deviceHtml, /最近切换/);
assert.match(deviceHtml, /最近结果/);
assert.match(deviceHtml, /令牌到期/);
assert.match(deviceHtml, /托盘/);
assert.match(deviceHtml, /data-helper-action="authorize"/);
assert.match(deviceHtml, /data-helper-action="export-diagnostics"/);
assert.match(deviceHtml, /在线/);
assert.match(deviceHtml, /v0\.4\.2/);
assert.match(deviceHtml, /http:\/\/127\.0\.0\.1:18766/);
assert.match(deviceHtml, /任务日志/);
assert.match(deviceHtml, /42 秒/);
assert.match(deviceHtml, /已识别/);

const offlineDeviceHtml = ui.renderDevice({ helperReady: false });
assert.match(offlineDeviceHtml, /Helper 未连接/);
assert.match(offlineDeviceHtml, /disabled/);

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

