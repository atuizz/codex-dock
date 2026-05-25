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

    return Object.freeze({
      renderSyncStats,
      modalState,
      drawerState,
      authModeView,
      isActive,
      renderAdminUserSummary,
    });
  }

  return Object.freeze({
    createDialogUi,
  });
});
