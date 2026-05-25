(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexPanelsUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createPanelsUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const auditCore = deps.auditCore || root.CodexAuditCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const formatTime = deps.formatTime || formatCore.formatTime || ((value) => value || "无记录");
    const auditTitle = deps.auditTitle || auditCore.auditTitle || ((item) => item?.action || "操作记录");
    const auditDescription = deps.auditDescription || auditCore.auditDescription || ((item) => item?.result || "已完成");

    function codexStatusSourceLabel(status = {}) {
      if (status.source === "logs_2.sqlite") return "任务日志";
      if (status.source === "process") return "进程检测";
      if (!status.protocol_connected) return "任务日志";
      return "任务日志";
    }

    function renderAudit(audit = []) {
      const list = audit.slice(0, 8);
      if (!list.length) return '<div class="empty small">还没有云端运行记录。本地离线切换不会强制写云审计。</div>';
      return list.map((item) => `
        <div class="audit-item">
          <span>${escapeHtml(formatTime(item.at || item.createdAt))}</span>
          <strong>${escapeHtml(auditTitle(item))}</strong>
          <span>${escapeHtml(auditDescription(item))}</span>
        </div>
      `).join("");
    }

    function renderDevice({
      helperReady = false,
      helper = {},
      codex = {},
      helperBase = "",
      currentAuthChecking = false,
      currentAuthMatched = false,
    } = {}) {
      const idleSeconds = Number(codex.idle_seconds);
      const stableSeconds = Number(codex.stable_seconds);
      const idleText = Number.isFinite(idleSeconds) && idleSeconds >= 0
        ? `${Math.floor(idleSeconds)} 秒`
        : Number.isFinite(stableSeconds) && stableSeconds >= 0 ? `${Math.floor(stableSeconds)} 秒` : "未确认";
      const lastEventTime = codex.last_task_event_at ? ` · ${formatTime(codex.last_task_event_at)}` : "";
      const lastEvent = codex.last_task_event ? `${codex.last_task_event}${lastEventTime}` : "暂无近期任务事件";
      const pendingReason = codex.pending_switch_reason || "无";
      const switchSafety = codex.safe_to_switch ? "可安全切换" : "暂不切换";
      const rows = [
        ["连接", helperReady ? "在线" : "未连接"],
        ["Helper 版本", helperReady ? (helper.version ? `v${helper.version}${helper.build_date ? ` · ${helper.build_date}` : ""}` : "旧版未上报") : "未连接"],
        ["地址", helperReady ? helperBase || "本机" : "未探测到"],
        ["端口", helper.port || "未识别"],
        ["Codex 状态", helperReady ? (codex.label || "确认中") : "未探测"],
        ["状态来源", helperReady ? codexStatusSourceLabel(codex) : "未连接"],
        ["空闲时长", helperReady ? idleText : "未确认"],
        ["最近任务", helperReady ? lastEvent : "未连接"],
        ["待切换原因", helperReady ? pendingReason : "未连接"],
        ["安全门", helperReady ? switchSafety : "未连接"],
        ["当前 auth", currentAuthChecking ? "正在确认" : (currentAuthMatched ? "已识别" : "未匹配账号池")],
        ["执行", "写入 auth 并重启 Codex"],
      ];
      return `
        <div class="device-grid">
          ${rows.map(([label, value]) => `
            <div class="device-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
        <p class="muted-line">Helper 只读取本机任务日志中的事件类型，不展示或上传对话内容。</p>
      `;
    }

    function securitySummary(account, helpers = {}) {
      if (!account) {
        return {
          preview: "选择账号后显示摘要。",
          warningHidden: true,
          warningText: "",
        };
      }
      const accountPlan = helpers.accountPlan || ((item) => item?.planType || "");
      const hasUsableRefreshToken = helpers.hasUsableRefreshToken || ((item) => Boolean(item?.session?.tokens?.refresh_token || item?.hasRefreshToken));
      let warningText = "";
      if (!account.hasLocalSecret && account.cloudId && !helpers.userPresent) {
        warningText = "这个账号只有云端元数据，需要登录云账号后才能获取切换 payload。";
      } else if (!hasUsableRefreshToken(account)) {
        warningText = "这个账号的 refresh_token 缺失或是占位值，长期可用性取决于 Codex 是否还能刷新。";
      }
      return {
        preview: JSON.stringify({
          account_id: account.accountId || "",
          email: account.email || "",
          plan_type: accountPlan(account),
          expires_at: account.expiresAt || "",
          has_refresh_token: hasUsableRefreshToken(account),
        }, null, 2),
        warningHidden: !warningText,
        warningText,
      };
    }

    return Object.freeze({
      codexStatusSourceLabel,
      renderAudit,
      renderDevice,
      securitySummary,
    });
  }

  return Object.freeze({
    createPanelsUi,
  });
});
