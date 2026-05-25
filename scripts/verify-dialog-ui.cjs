const assert = require("node:assert/strict");
const { createDialogUi } = require("../dialog-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createDialogUi({ escapeHtml: htmlEscape });

const statsHtml = ui.renderSyncStats({ local: 2, cloud: 3, duplicate: 1 });
assert.match(statsHtml, /本地账号/);
assert.match(statsHtml, /<strong>2<\/strong>/);
assert.match(statsHtml, /云端账号/);
assert.match(statsHtml, /重复账号/);

assert.deepEqual(ui.modalState(true), { open: true, ariaHidden: "false" });
assert.deepEqual(ui.modalState(false), { open: false, ariaHidden: "true" });
assert.deepEqual(ui.drawerState(true), { open: true, ariaHidden: "false" });

const login = ui.authModeView("login");
assert.equal(login.title, "登录或注册");
assert.equal(login.submitText, "继续");
assert.match(login.copy, /同步到云端/);
assert.match(login.toggleText, /创建一个/);

const register = ui.authModeView("register");
assert.equal(register.submitText, "创建并继续");
assert.match(register.copy, /需你确认/);
assert.match(register.toggleText, /已有账号/);

assert.equal(ui.isActive("smart", "smart"), true);
assert.equal(ui.isActive("smart", "data"), false);

const summaryHtml = ui.renderAdminUserSummary(
  {
    user: { email: "admin<user>@example.com" },
    accountCount: 5,
    sessionCount: 2,
    deviceCount: 1,
  },
  [
    { email: "first@example.com" },
    { name: "Second <Name>" },
    { email: "third@example.com" },
    { email: "fourth@example.com" },
    { email: "fifth@example.com" },
    { email: "hidden@example.com" },
  ],
);
assert.match(summaryHtml, /admin&lt;user&gt;@example\.com/);
assert.match(summaryHtml, /账号 5 · 会话 2 · 设备 1/);
assert.match(summaryHtml, /Second &lt;Name&gt;/);
assert.doesNotMatch(summaryHtml, /hidden@example\.com/);

console.log("dialog-ui verification passed");
