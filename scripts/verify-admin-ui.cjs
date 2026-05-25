const assert = require("node:assert/strict");
const { createAdminUi } = require("../admin-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createAdminUi({
  escapeHtml: htmlEscape,
  shortId: (value) => (value ? `${String(value).slice(0, 4)}...` : "未识别"),
  formatTime: (value) => value || "无记录",
  auditTitle: (item) => item.action === "auto-switch" ? "自动切换成功" : "操作记录",
  auditDescription: (item) => item.result || "已完成",
});

const summaryHtml = ui.renderSummary({
  users: 3,
  activeUsers: 2,
  accounts: 9,
  onlineSessions: 4,
  imports24h: 5,
  switches24h: 6,
}, [{ id: "device-a", helperVersion: "0.4.1" }, { id: "device-b", helperVersion: "0.3.1" }]);
assert.match(summaryHtml, /用户数/);
assert.match(summaryHtml, /<strong>3<\/strong>/);
assert.match(summaryHtml, /设备数/);
assert.match(summaryHtml, /<strong>2<\/strong>/);
assert.match(summaryHtml, /待升级 Helper/);

const devicesHtml = ui.renderDevices([
  { id: "device-a", name: "Desk", userEmail: "ops@example.com", helperOnline: true, helperVersion: "0.4.1", lastSeenAt: "now" },
  { id: "device-b", name: "Old", userEmail: "old@example.com", helperOnline: false, helperVersion: "0.3.1", lastSeenAt: "then" },
]);
assert.match(devicesHtml, /0\.4\.1/);
assert.match(devicesHtml, /0\.3\.1 · 待升级/);

const users = [
  {
    id: "user-admin-1",
    email: "admin<ops>@example.com",
    role: "admin",
    status: "active",
    accountCount: 7,
    sessionCount: 2,
    lastSeenAt: "2026-05-25T02:00:00.000Z",
  },
  {
    id: "user-disabled-2",
    email: "disabled@example.com",
    role: "user",
    status: "disabled",
    accountCount: 0,
    sessionCount: 0,
    lastLoginAt: "",
  },
];
const usersHtml = ui.renderUsers(users, new Set(["user-disabled-2"]));
assert.match(usersHtml, /admin&lt;ops&gt;@example\.com/);
assert.match(usersHtml, /管理员/);
assert.match(usersHtml, /data-admin-action="toggle-status"/);
assert.match(usersHtml, /data-admin-user-select="user-disabled-2" checked/);
assert.match(usersHtml, />启用<\/button>/);
assert.match(usersHtml, /重置密码/);

const auditHtml = ui.renderAudit([
  {
    createdAt: "2026-05-25T02:05:00.000Z",
    userEmail: "admin@example.com",
    action: "auto-switch",
    result: "switched",
  },
]);
assert.match(auditHtml, /admin@example\.com · 自动切换成功/);
assert.match(auditHtml, /switched/);

const rendered = ui.renderAdmin({
  summary: { users: 1, activeUsers: 1, accounts: 2, onlineSessions: 1, imports24h: 0, switches24h: 1 },
  users,
  audit: [],
  devices: [],
  selectedIds: new Set(["user-admin-1", "user-disabled-2"]),
});
assert.equal(rendered.selectAllLabel, "已选 2");
assert.match(rendered.usersHtml, /admin-table/);
assert.match(rendered.auditHtml, /暂无审计记录/);

const emptyUsers = ui.renderUsers([]);
assert.match(emptyUsers, /暂无用户数据/);

console.log("admin-ui verification passed");
