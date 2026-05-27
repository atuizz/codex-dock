(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexDialogUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createDialogUi(deps = {}) {
    const escapeHtml = deps.escapeHtml || root.CodexFormatCore?.escapeHtml || fallbackEscapeHtml;

    function renderSyncStats(stats = {}) {
      const rows = [
        ["本地账号", stats.local || 0],
        ["云端账号", stats.cloud || 0],
        ["重复账号", stats.duplicate || 0],
      ];
      return rows.map(([label, value]) => `
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      `).join("");
    }

    function modalState(open) {
      return {
        open: Boolean(open),
        ariaHidden: open ? "false" : "true",
      };
    }

    function drawerState(open) {
      return modalState(open);
    }

    function authModeView(mode) {
      const isRegister = mode === "register";
      return {
        title: "登录或注册",
        copy: isRegister
          ? "创建云账户后，本地账号池仍需你确认才会上传。"
          : "登录后可把本地账号池同步到云端，并在其他设备继续使用。",
        submitText: isRegister ? "创建并继续" : "继续",
        toggleText: isRegister ? "已有账号？登录" : "没有账号？创建一个",
      };
    }

    function isActive(current, expected) {
      return current === expected;
    }

    function renderAdminUserSummary(detail = {}, accounts = []) {
      const userEmail = detail.user?.email || "未知用户";
      const recent = accounts.slice(0, 5)
        .map((account) => escapeHtml(account.email || account.name))
        .filter(Boolean)
        .join("、") || "无";
      return `
        <strong>${escapeHtml(userEmail)}</strong>
        <span>账号 ${Number(detail.accountCount) || 0} · 会话 ${Number(detail.sessionCount) || 0} · 设备 ${Number(detail.deviceCount) || 0}</span>
        <span>最近账号：${recent}</span>
      `;
    }

    function renderCleanupReview(review = {}) {
      const total = Number(review.total) || 0;
      const invalid = Number(review.invalid) || 0;
      const normal = Number(review.normal) || 0;
      const recoverable = Number(review.recoverable) || 0;
      const rows = Array.isArray(review.rows) ? review.rows : [];
      const summaryText = normal
        ? `将删除 ${total} 个账号，其中 ${normal} 个看起来仍可使用。请确认这些账号不再需要。`
        : `将清理 ${invalid} 个不可直接使用的账号。可恢复账号建议后续通过登录导入重新登记。`;
      const riskTitle = normal ? "包含可用账号" : "清理不可用账号";
      const riskCopy = normal
        ? "删除后云端凭据和本地缓存都会移除；若误删，需要重新导入。"
        : "缺 RT 或 RT 失效的账号可通过 OAuth 重新导入；删除不会影响 OpenAI 账号本身。";
      const statsHtml = [
        ["所选账号", total],
        ["需处理", invalid],
        ["看似可用", normal],
        ["可重新导入", recoverable],
      ].map(([label, value]) => `
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      `).join("");
      const listHtml = rows.slice(0, 8).map((row) => `
        <div class="cleanup-row ${escapeHtml(row.className || "")}">
          <div>
            <strong>${escapeHtml(row.title)}</strong>
            <span>${escapeHtml(row.subtitle || "")}</span>
          </div>
          <small>${escapeHtml(row.reason || "待确认")}</small>
        </div>
      `).join("") + (rows.length > 8 ? `<div class="cleanup-more">还有 ${escapeHtml(rows.length - 8)} 个账号将在确认后一起处理。</div>` : "");
      return {
        summaryText,
        confirmText: normal ? "仍要删除所选" : "确认清理不可用",
        statsHtml,
        riskHtml: `
          <div class="cleanup-risk ${normal ? "bad" : "warn"}">
            <strong>${escapeHtml(riskTitle)}</strong>
            <span>${escapeHtml(riskCopy)}</span>
          </div>
        `,
        listHtml,
      };
    }

    function renderManualSwitchRisk(context = {}) {
      const account = context.account || {};
      const codex = context.codex || {};
      const pending = context.pending || {};
      const accountLabel = account.name || account.email || account.accountId || "所选账号";
      const runtimeState = codex.label || codex.state || "状态确认中";
      const pendingReason = codex.pending_switch_reason || pending.reason || "当前 Codex 轮次仍在运行";
      const taskEvent = codex.last_task_event || codex.lastTaskEvent || "";
      const source = codex.boundary_source || codex.boundarySource || codex.runtime_source || "Agent 运行状态";
      const waitQueued = Boolean(pending.waitForBoundary);
      const summaryText = waitQueued
        ? "已加入等待队列。Agent 确认安全边界后才会写入 auth 并重启 Codex。"
        : "当前任务仍在运行，立即切换可能中断本轮并浪费剩余额度。";
      const statsHtml = [
        ["目标账号", accountLabel],
        ["任务状态", runtimeState],
        ["安全门", codex.safe_to_switch === false ? "暂不安全" : "确认中"],
      ].map(([label, value]) => `
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      `).join("");
      const detailRows = [
        ["保护原因", pendingReason],
        taskEvent ? ["最近任务事件", taskEvent] : null,
        ["状态来源", source],
      ].filter(Boolean).map(([label, value]) => `
        <div class="switch-risk-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("");
      return {
        summaryText,
        waitText: waitQueued ? "等待中" : "等待安全边界后切换",
        forceText: "仍然立即切换",
        statsHtml,
        riskHtml: `
          <div class="cleanup-risk warn switch-risk-copy">
            <strong>保护当前任务</strong>
            <span>Dock Agent 报告安全门未打开。本次默认不会抢切账号；强制切换会记录为用户动作。</span>
          </div>
          <div class="switch-risk-detail">${detailRows}</div>
        `,
      };
    }

    return Object.freeze({
      renderSyncStats,
      modalState,
      drawerState,
      authModeView,
      isActive,
      renderAdminUserSummary,
      renderCleanupReview,
      renderManualSwitchRisk,
    });
  }

  return Object.freeze({
    createDialogUi,
  });
});
