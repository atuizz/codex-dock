const assert = require("node:assert/strict");
const {
  auditTitle,
  auditDescription,
  formatCandidateDiagnostics,
  usageRefreshModeLabel,
} = require("../audit-core.js");

const cases = [
  {
    item: { action: "auto-switch", result: "payload-issued", metadata: { trigger: "5H 剩余 3%", reason: "PLUS、5H 99%" } },
    title: "已下发候选账号",
    description: "触发：5H 剩余 3%",
  },
  {
    item: { action: "auto-switch-helper", result: "switched", metadata: { reason: "5H 剩余 3%", target: "target@example.com" } },
    title: "自动切换成功",
    description: "5H 剩余 3% -> target@example.com",
  },
  {
    item: {
      action: "auto-switch",
      result: "no-candidate",
      metadata: {
        trigger: "当前账号不可用或已限流",
        summary: "避开当前账号 1；切换冷却 10 分钟内 2",
      },
    },
    title: "自动切换无候选",
    description: "触发：当前账号不可用或已限流 · 避开当前账号 1；切换冷却 10 分钟内 2",
  },
  {
    item: { action: "auto-switch-helper", result: "deferred-active-turn", metadata: { reason: "5H 剩余 4%", detail: "Codex 未稳定空闲" } },
    title: "正在保护当前任务",
    description: "5H 剩余 4% · Codex 未稳定空闲",
  },
  {
    item: { action: "auto-switch-helper", result: "boundary-confirmed", metadata: { reason: "5H 剩余 4%", detail: "连续 15 秒没有任务类日志" } },
    title: "安全边界已确认",
    description: "5H 剩余 4% · 连续 15 秒没有任务类日志",
  },
  {
    item: { action: "auto-switch-check", result: "error", metadata: { error: "https://chatgpt.com/backend-api/wham/usage -> 操作超时" } },
    title: "额度检查异常",
    description: "https://chatgpt.com/backend-api/wham/usage -> 操作超时",
  },
  {
    item: { action: "auto-switch-check", result: "trigger:5H 剩余 3%", metadata: {} },
    title: "自动切换已触发",
    description: "触发：5H 剩余 3%",
  },
  {
    item: { action: "usage-refresh", result: "ok", metadata: { source: "auto-cloud-fallback" } },
    title: "额度已刷新",
    description: "执行通道：自动选择 / 云端回退",
  },
  {
    item: { action: "usage-refresh", result: "error", metadata: { source: "cloud-worker", error: "操作超时" } },
    title: "额度刷新失败",
    description: "执行通道：云端 Worker · 操作超时",
  },
  {
    item: { action: "usage-refresh-batch", result: "ok:3,failed:1", metadata: {} },
    title: "批量额度刷新有失败",
    description: "成功 3，失败 1",
  },
  {
    item: { action: "usage-refresh-settings", result: "helper", metadata: {} },
    title: "额度刷新方式已更新",
    description: "执行通道：本机 Helper",
  },
  {
    item: { action: "usage-refresh-settings", result: "auto", metadata: {} },
    title: "额度刷新方式已更新",
    description: "执行通道：自动选择",
  },
  {
    item: {
      action: "switch",
      result: "manual-forced",
      metadata: { manualForce: true, pendingSwitchReason: "当前任务仍在运行" },
    },
    title: "用户强制切换",
    description: "用户确认后立即切换 · 当前任务仍在运行",
  },
  {
    item: {
      action: "switch",
      result: "manual-waited-boundary",
      metadata: { waitedForBoundary: true, lastTaskEvent: "response.completed" },
    },
    title: "安全边界后切换",
    description: "等待安全边界后切换 · response.completed",
  },
];

for (const { item, title, description } of cases) {
  assert.equal(auditTitle(item), title, `${item.action}/${item.result} title`);
  assert.equal(auditDescription(item), description, `${item.action}/${item.result} description`);
}

const candidateText = formatCandidateDiagnostics([
  { email: "current@example.com", blocked: "避开当前账号", fiveHour: 2, oneWeek: 88 },
  { email: "cooldown@example.com", blocked: "切换冷却 10 分钟内", fiveHour: 99, oneWeek: 100 },
  { email: "ready@example.com", eligible: true, fiveHour: 97, oneWeek: 99 },
]);
assert.match(candidateText, /避开当前账号 1/);
assert.match(candidateText, /切换冷却 10 分钟内 1/);
assert.match(candidateText, /可用 1/);
assert.match(candidateText, /current@example\.com：避开当前账号，5H 2% \/ 7D 88%/);

assert.equal(usageRefreshModeLabel("cloud"), "云端 Worker");
assert.equal(usageRefreshModeLabel("manual"), "仅手动刷新");

console.log("audit-core verification passed");
