(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexAdminUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createAdminUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const auditCore = deps.auditCore || root.CodexAuditCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const shortId = deps.shortId || formatCore.shortId || ((value) => String(value || "").slice(0, 8) || "未识别");
    const formatTime = deps.formatTime || formatCore.formatTime || ((value) => value || "无记录");
    const auditTitle = deps.auditTitle || auditCore.auditTitle || ((item) => item?.action || "操作记录");
    const auditDescription = deps.auditDescription || auditCore.auditDescription || ((item) => item?.result || "已完成");

    function metric(label, value) {
      return `
        <div class="metric flat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value ?? 0)}</strong>
        </div>
      `;
    }

    function renderSummary(summary, devices = []) {
      if (!summary) return "";
      return [
        ["用户数", summary.users],
        ["启用用户", summary.activeUsers],
        ["账号数", summary.accounts],
        ["设备数", devices.length],
        ["在线 session", summary.onlineSessions],
        ["24h 导入", summary.imports24h],
        ["24h 切换", summary.switches24h],
      ].map(([label, value]) => metric(label, value)).join("");
    }

    function renderUserRows(users = [], selectedIds = new Set()) {
      return users.map((user) => {
        const selected = selectedIds.has(user.id);
        const role = user.role === "admin" ? "管理员" : "用户";
        const status = user.status === "disabled" ? "已停用" : "可用";
        return `
          <tr>
            <td><input type="checkbox" data-admin-user-select="${escapeHtml(user.id)}" ${selected ? "checked" : ""} /></td>
            <td><button class="table-link" data-admin-action="user-summary" data-id="${escapeHtml(user.id)}"><strong>${escapeHtml(user.email)}</strong><span>${escapeHtml(shortId(user.id))}</span></button></td>
            <td>${escapeHtml(role)}</td>
            <td>${escapeHtml(status)}</td>
            <td>${Number(user.accountCount || 0)}</td>
            <td>${Number(user.sessionCount || 0)}</td>
            <td>${escapeHtml(formatTime(user.lastSeenAt || user.lastLoginAt))}</td>
            <td>
              <div class="row-actions">
                <button data-admin-action="toggle-status" data-id="${escapeHtml(user.id)}" data-status="${escapeHtml(user.status)}">${user.status === "active" ? "禁用" : "启用"}</button>
                <button data-admin-action="toggle-role" data-id="${escapeHtml(user.id)}" data-role="${escapeHtml(user.role)}">${user.role === "admin" ? "降级" : "升管"}</button>
                <button data-admin-action="reset-password" data-id="${escapeHtml(user.id)}">重置密码</button>
                <button data-admin-action="kick" data-id="${escapeHtml(user.id)}">踢下线</button>
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }

    function renderUsers(users = [], selectedIds = new Set()) {
      if (!users.length) return '<div class="empty small">暂无用户数据。</div>';
      return `
        <table class="admin-table">
          <thead>
            <tr>
              <th></th>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>账号</th>
              <th>会话</th>
              <th>最近活跃</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${renderUserRows(users, selectedIds)}
          </tbody>
        </table>
      `;
    }

    function renderAudit(audit = []) {
      if (!audit.length) return '<div class="empty small">暂无审计记录。</div>';
      return audit.slice(0, 30).map((item) => `
        <div class="audit-item">
          <span>${escapeHtml(formatTime(item.createdAt))}</span>
          <strong>${escapeHtml(item.userEmail || "未知用户")} · ${escapeHtml(auditTitle(item))}</strong>
          <span>${escapeHtml(auditDescription(item))}</span>
        </div>
      `).join("");
    }

    function renderAdmin({
      summary = null,
      users = [],
      audit = [],
      devices = [],
      selectedIds = new Set(),
    } = {}) {
      const selectedCount = selectedIds.size || 0;
      return {
        summaryHtml: renderSummary(summary, devices),
        usersHtml: renderUsers(users, selectedIds),
        selectAllLabel: selectedCount ? `已选 ${selectedCount}` : "选择结果",
        auditHtml: renderAudit(audit),
      };
    }

    return Object.freeze({
      renderSummary,
      renderUsers,
      renderAudit,
      renderAdmin,
    });
  }

  return Object.freeze({
    createAdminUi,
  });
});
