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
  formatBytes: (value) => `${value} bytes`,
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
  helper: { version: "0.4.2", auto_switch: { enabled: true } },
  helperAuthorized: true,
  codex: { safe_to_switch: true, pending_switch_reason: "5H 剩余 1%" },
}).title, "安全边界已确认");
assert.equal(ui.helperDiagnostic({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true }, tray: { visible: false } },
  helperAuthorized: true,
  codex: { safe_to_switch: true },
}).title, "托盘需要修复");
assert.equal(ui.autoSwitchStage({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true, last_result: "额度已触发，正在保护当前任务：Codex 未稳定空闲；触发源 实时用量：5H 剩余 1%" } },
  helperAuthorized: true,
  codex: {
    safe_to_switch: false,
    pending_switch_reason: "5H 剩余 1%",
    last_task_event: "工具调用中",
    source: "logs_2.sqlite",
  },
}).key, "draining_active_turn");
assert.equal(ui.autoSwitchStage({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true } },
  helperAuthorized: true,
  codex: { safe_to_switch: true, pending_switch_reason: "7D 剩余 2%" },
}).key, "boundary_confirming");
assert.equal(ui.autoSwitchStage({
  helperReady: true,
  helper: { version: "0.4.2", auto_switch: { enabled: true, last_result: "自动切换失败：账号 A", last_reason: "5H 剩余 0%" } },
  helperAuthorized: true,
  codex: { safe_to_switch: true },
}).key, "failed");
const backoffStage = ui.autoSwitchStage({
  helperReady: true,
  helper: {
    version: "0.4.2",
    auto_switch: {
      enabled: true,
      last_stage: "failure-backoff",
      last_stage_label: "失败退避",
      last_failure_stage: "no-candidate",
      last_failure_detail: "没有可用 RT 账号",
      failure_backoff_until: "2026-05-26T00:10:00.000Z",
    },
  },
  helperAuthorized: true,
  codex: { safe_to_switch: true },
});
assert.equal(backoffStage.key, "failure_backoff");
assert.match(backoffStage.result, /没有可用 RT 账号/);
assert.match(ui.renderAutoSwitchStage(backoffStage), /失败退避中/);
assert.match(ui.renderAutoSwitchStage(backoffStage), /当前阶段/);

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
  helperRelease: {
    file: "downloads/CodexDockHelper.exe",
    version: "0.4.2",
    build_date: "2026-05-26",
    bytes: 164352,
    sha256: "099D63B12FBCD7990FA6A8F5EB0DFDCB9F6B06EA558E0CDFF36098C217961AAD",
  },
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
assert.match(deviceHtml, /Helper 分发/);
assert.match(deviceHtml, /下载最新版/);
assert.match(deviceHtml, /data-helper-action="copy-helper-sha"/);
assert.match(deviceHtml, /099D63B12FBC/);
assert.match(deviceHtml, /自动切换阶段/);
assert.match(deviceHtml, /持续监控/);
assert.match(deviceHtml, /在线/);
assert.match(deviceHtml, /v0\.4\.2/);
assert.match(deviceHtml, /http:\/\/127\.0\.0\.1:18766/);
assert.match(deviceHtml, /任务日志/);
assert.match(deviceHtml, /42 秒/);
assert.match(deviceHtml, /已识别/);

const offlineDeviceHtml = ui.renderDevice({ helperReady: false });
assert.match(offlineDeviceHtml, /Helper 未连接/);
assert.match(offlineDeviceHtml, /等待 Helper 在线/);
assert.match(offlineDeviceHtml, /disabled/);

const protectingDeviceHtml = ui.renderDevice({
  helperReady: true,
  helper: {
    port: 18766,
    version: "0.4.2",
    auto_switch: {
      enabled: true,
      last_result: "额度已触发，正在保护当前任务：Codex 未稳定空闲；触发源 实时用量：5H 剩余 1%",
    },
  },
  helperAuthorized: true,
  userPresent: true,
  codex: {
    source: "logs_2.sqlite",
    safe_to_switch: false,
    pending_switch_reason: "5H 剩余 1%",
    last_task_event: "工具调用中",
  },
});
assert.match(protectingDeviceHtml, /保护当前任务/);
assert.match(protectingDeviceHtml, /当前 Codex 轮次仍可能继续执行/);
assert.match(protectingDeviceHtml, /安全门关闭/);

const boundaryDeviceHtml = ui.renderDevice({
  helperReady: true,
  helper: { port: 18766, version: "0.4.2", auto_switch: { enabled: true } },
  helperAuthorized: true,
  userPresent: true,
  codex: {
    source: "logs_2.sqlite",
    safe_to_switch: true,
    pending_switch_reason: "7D 剩余 2%",
    last_task_event: "任务完成",
  },
});
assert.match(boundaryDeviceHtml, /安全边界已确认/);
assert.match(boundaryDeviceHtml, /请求云端候选账号/);

const failedDeviceHtml = ui.renderDevice({
  helperReady: true,
  helper: {
    port: 18766,
    version: "0.4.2",
    auto_switch: {
      enabled: true,
      last_reason: "5H 剩余 0%",
      last_result: "自动切换失败：目标账号",
    },
  },
  helperAuthorized: true,
  userPresent: true,
  codex: { source: "logs_2.sqlite", safe_to_switch: true },
});
assert.match(failedDeviceHtml, /自动切换失败/);
assert.match(failedDeviceHtml, /auth 写入权限/);

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

