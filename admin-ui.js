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

    function compareVersion(left, right) {
      const a = String(left || "").split(".").map((part) => Number(part) || 0);
      const b = String(right || "").split(".").map((part) => Number(part) || 0);
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
      }
      return 0;
    }

    function derivedHelperVersions(devices = []) {
      const grouped = new Map();
      for (const device of devices) {
        const version = device.helperVersion || "未上报";
        const current = grouped.get(version) || { version, total: 0, online: 0, stale: 0, lastSeenAt: "" };
        current.total += 1;
        if (device.helperOnline) current.online += 1;
        if (device.helperStale) current.stale += 1;
        current.lastSeenAt = current.lastSeenAt || device.lastSeenAt || "";
        grouped.set(version, current);
      }
      return [...grouped.values()].sort((a, b) => b.total - a.total);
    }

    function renderTrend(trend = []) {
      const rows = trend.slice(-8);
      if (!rows.length) return '<div class="mini-trend empty-trend">暂无失败趋势</div>';
      const max = Math.max(1, ...rows.map((row) => Number(row.failures || 0)));
      return `
        <div class="mini-trend" aria-label="最近失败趋势">
          ${rows.map((row) => {
            const failures = Number(row.failures || 0);
            const height = Math.max(8, Math.round((failures / max) * 34));
            return `<span title="${escapeHtml(row.bucket || "时间段")} · ${failures} 次失败" style="height:${height}px"></span>`;
          }).join("")}
        </div>
      `;
    }

    function renderVersionList(versions = [], minVersion = "0.4.2") {
      if (!versions.length) return '<div class="ops-inline muted">暂无设备版本。</div>';
      return `
        <div class="ops-version-list">
          ${versions.slice(0, 4).map((item) => {
            const version = item.version || "未上报";
            const outdated = version === "未上报" || compareVersion(version, minVersion) < 0;
            const stale = Number(item.stale || 0);
            const suffix = stale ? ` · ${stale} 台需重连` : "";
            return `<span class="${outdated || stale ? "warn" : ""}">${escapeHtml(version)} · ${Number(item.online || 0)}/${Number(item.total || 0)} 在线${escapeHtml(suffix)}</span>`;
          }).join("")}
        </div>
      `;
    }

    function renderSummary(summary, devices = []) {
      if (!summary) return "";
      const minVersion = summary.minSupportedHelperVersion || "0.4.2";
      const versions = summary.helperVersions?.length ? summary.helperVersions : derivedHelperVersions(devices);
      const fallbackOutdated = devices.filter((device) => !device.helperVersion || compareVersion(device.helperVersion, minVersion) < 0).length;
      const outdatedHelpers = Number.isFinite(Number(summary.deviceHealth?.outdated)) ? Number(summary.deviceHealth.outdated) : fallbackOutdated;
      const staleHelpers = Number.isFinite(Number(summary.deviceHealth?.stale))
        ? Number(summary.deviceHealth.stale)
        : devices.filter((device) => device.helperStale).length;
      const accountHealth = summary.accountHealth || {};
      const failureTotals = summary.failureTotals || {};
      const basic = [
        ["用户数", summary.users],
        ["启用用户", summary.activeUsers],
        ["账号数", summary.accounts],
        ["设备数", summary.deviceHealth?.total ?? devices.length],
        ["待升级 Agent", outdatedHelpers],
        ["需重连 Agent", staleHelpers],
        ["在线 session", summary.onlineSessions],
        ["24h 导入", summary.imports24h],
        ["24h 切换", summary.switches24h],
        ["24h 注销", summary.deletions24h],
      ].map(([label, value]) => metric(label, value)).join("");
      return `
        <div class="admin-ops-grid">
          <div class="ops-card">
            <span>账号健康</span>
            <strong>${Number(accountHealth.rtReady || 0)} / ${Number(accountHealth.total ?? summary.accounts ?? 0)} RT 可用</strong>
            <p>AT-only ${Number(accountHealth.atOnly || 0)} · 刷新失败 ${Number(accountHealth.usageFailed || 0)} · 未刷新 ${Number(accountHealth.unrefreshed || 0)}</p>
          </div>
          <div class="ops-card">
            <span>失败趋势</span>
            <strong>${Number(failureTotals.auditFailures24h || 0)} / ${Number(failureTotals.audit24h || 0)} 次审计失败</strong>
            ${renderTrend(summary.failureTrend || [])}
            <p>24h 额度刷新失败 ${Number(failureTotals.usageRefreshFailures24h || 0)} 次</p>
          </div>
          <div class="ops-card">
            <span>Agent 版本分布</span>
            <strong>${outdatedHelpers} 台待升级 · ${staleHelpers} 台需重连</strong>
            ${renderVersionList(versions, minVersion)}
            <p>最低支持版本 v${escapeHtml(minVersion)}</p>
          </div>
        </div>
        <div class="admin-metrics-label">详细指标</div>
        <div class="admin-summary-metrics">${basic}</div>
      `;
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

    function renderDevices(devices = []) {
      if (!devices.length) return '<div class="empty small">暂无设备记录。</div>';
      return `
        <table class="admin-table">
          <thead><tr><th>设备</th><th>用户</th><th>连接</th><th>Agent 版本</th><th>最近活跃</th></tr></thead>
          <tbody>
            ${devices.map((device) => {
              const version = device.helperVersion || "未上报";
              const versionStatus = !device.helperVersion || compareVersion(device.helperVersion, "0.4.2") < 0 ? " · 待升级" : "";
              const age = Number(device.helperLastSeenAgeSeconds);
              const ageLabel = Number.isFinite(age) ? ` · ${Math.floor(age / 60)} 分钟未心跳` : "";
              const connection = device.helperStale
                ? `需重连${ageLabel}`
                : (device.helperOnline ? "在线" : "离线");
              return `<tr>
                <td><strong>${escapeHtml(device.name || "设备")}</strong><span>${escapeHtml(shortId(device.id))}</span></td>
                <td>${escapeHtml(device.userEmail || "未知用户")}</td>
                <td>${escapeHtml(connection)}</td>
                <td>${escapeHtml(version + versionStatus)}</td>
                <td>${escapeHtml(formatTime(device.lastSeenAt))}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      `;
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
        devicesHtml: renderDevices(devices),
        selectAllLabel: selectedCount ? `已选 ${selectedCount}` : "选择结果",
        auditHtml: renderAudit(audit),
      };
    }

    return Object.freeze({
      renderSummary,
      renderUsers,
      renderAudit,
      renderDevices,
      renderAdmin,
    });
  }

  return Object.freeze({
    createAdminUi,
  });
});
