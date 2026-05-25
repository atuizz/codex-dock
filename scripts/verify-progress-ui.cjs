const assert = require("node:assert/strict");
const { createProgressUi } = require("../progress-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createProgressUi({ escapeHtml: htmlEscape });

const pending = ui.renderOperationProgress({
  done: false,
  title: "刷新额度",
  items: [
    { label: "账号 A", status: "已完成" },
    { label: "账号 B", status: "刷新中", detail: "等待响应" },
    { label: "账号 C", status: "失败", detail: "<token>" },
  ],
});

assert.equal(pending.title, "刷新额度");
assert.equal(pending.summary, "2/3 已处理，失败 1");
assert.equal(pending.closeDisabled, true);
assert.equal(pending.stats.completed, 1);
assert.equal(pending.stats.failed, 1);
assert.equal(pending.stats.running, 1);
assert.match(pending.listHtml, /账号 B/);
assert.match(pending.listHtml, /&lt;token&gt;/);
assert.match(pending.listHtml, /running/);

const completed = ui.renderOperationProgress({
  done: true,
  summary: "全部完成",
  items: [{ label: "账号 A", status: "已完成" }],
});

assert.equal(completed.percent, 100);
assert.equal(completed.summary, "全部完成");
assert.equal(completed.closeDisabled, false);

const empty = ui.renderOperationProgress({});
assert.equal(empty.summary, "0/0 已处理，失败 0");
assert.equal(empty.percent, 0);

console.log("progress-ui verification passed");
