const assert = require("node:assert/strict");
const {
  auditTitle,
  auditDescription,
  formatCandidateDiagnostics,
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
    item: { action: "auto-switch-helper", result: "deferred-active-task", metadata: { reason: "5H 剩余 4%", detail: "Codex 未稳定空闲" } },
    title: "自动切换等待空闲",
    description: "5H 剩余 4% · Codex 未稳定空闲",
  },
  {
    item: { action: "auto-switch-check", result: "trigger:5H 剩余 3%", metadata: {} },
    title: "自动切换已触发",
    description: "触发：5H 剩余 3%",
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

console.log("audit-core verification passed");
