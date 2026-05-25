(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexAccountDetailUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createAccountDetailUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const shortId = deps.shortId || formatCore.shortId || ((value) => String(value || "").slice(0, 8) || "未识别");
    const formatTime = deps.formatTime || formatCore.formatTime || ((value) => value || "无记录");
    const formatResetTime = deps.formatResetTime || formatCore.formatResetTime || (() => "重置未知");
    const planLabel = deps.planLabel || formatCore.planLabel || ((value) => value || "未知");
    const planClass = deps.planClass || formatCore.planClass || (() => "plan-unknown");
    const errorSeverity = deps.errorSeverity || formatCore.errorSeverity || (() => "warn");
    const explainError = deps.explainError || ((value) => String(value || ""));
    const accountPlan = deps.accountPlan || ((account) => account?.planType || account?.plan_type || "");
    const tokenState = deps.tokenState || (() => ({ label: "未知", className: "warn", detail: "" }));
    const usageIssue = deps.usageIssue || ((account) => {
      const issue = account?.usage?.error ? explainError(account.usage.error) : "";
      return issue ? { label: issue, className: errorSeverity(issue) } : null;
    });
    const canUseAccount = deps.canUseAccount || (() => false);
    const sourceLabel = deps.sourceLabel || (() => "");

    function accountHasRt(account) {
      if (account?.hasRefreshToken !== undefined) return Boolean(account.hasRefreshToken);
      if (account?.hasRt !== undefined) return Boolean(account.hasRt);
      const tokens = account?.session?.tokens || {};
      return Boolean(tokens.refresh_token && tokens.refresh_token !== tokens.access_token && tokens.refresh_token !== "rt_mock_token");
    }

    function rtUpdatePanel() {
      return `
        <div class="auth-acquire-panel compact rt-update-panel">
          <div>
            <strong>通过 OAuth 登录补 RT</strong>
            <span>这个账号当前只有 AT，不能用于 Codex。请用这个邮箱打开 OAuth 网页登录，Helper 会自动接收回调并导入 RT；不要用当前本机 auth 覆盖它。</span>
          </div>
          <div class="auth-acquire-actions">
            <button type="button" data-auth-action="open-import-oauth-login">补 RT</button>
          </div>
        </div>
      `;
    }

    function accountBlockReason(account, token) {
      const reason = account?.codexBlockReason || account?.codex_block_reason || "";
      if (reason) return reason;
      const label = `${token?.label || ""} ${token?.detail || ""}`;
      if (label.includes("不支持 Codex")) return "at_unsupported";
      return "";
    }


    function authAcquirePanel(reason = "") {
      return `
        <div class="auth-acquire-panel compact">
          <div>
            <strong>${escapeHtml(reason || "重新获取授权")}</strong>
            <span>按来源选择 Session 或 OAuth，不混用。</span>
          </div>
          <div class="auth-method-columns">
            <div>
              <strong>Session</strong>
              <div class="auth-acquire-actions">
                <button type="button" data-auth-action="open-import-session">去导入 Session</button>
                <button type="button" data-auth-action="open-session-json">打开 Session JSON</button>
                <button type="button" data-auth-action="copy-session-url">复制地址</button>
              </div>
            </div>
            <div>
              <strong>OAuth</strong>
              <div class="auth-acquire-actions">
                <button type="button" data-auth-action="open-import-oauth">去导入 OAuth</button>
                <button type="button" data-auth-action="open-oauth-login">打开授权页</button>
                <button type="button" data-auth-action="copy-oauth-url">复制授权链接</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function quotaCell(window, label, usage = null) {
      const issue = usage?.error ? explainError(usage.error) : "";
      const issueClass = issue ? errorSeverity(issue) : "";
      if (!window) {
        return `
          <div class="quota-cell empty-quota ${issueClass}" ${issue ? `title="${escapeHtml(issue)}"` : ""}>
            <strong>${escapeHtml(issue ? "不可用" : "未刷新")}</strong>
            <span>${escapeHtml(label)}</span>
            <div class="quota-bar"><i style="width:0%"></i></div>
          </div>
        `;
      }
      const remaining = Number.isFinite(window.remaining_percent) ? window.remaining_percent : null;
      const used = Number.isFinite(window.used_percent) ? window.used_percent : (remaining === null ? null : 100 - remaining);
      const percent = remaining === null ? Math.max(0, 100 - (used || 0)) : remaining;
      const className = percent <= 10 ? "bad" : percent <= 30 ? "warn" : "";
      return `
        <div class="quota-cell ${className}">
          <strong>${percent}% 剩余</strong>
          <span>${escapeHtml(formatResetTime(window.reset_at))}</span>
          <div class="quota-bar"><i style="width:${percent}%"></i></div>
        </div>
      `;
    }

    function renderEmpty({ helperReady = false } = {}) {
      return {
        selectedState: "未选择账号",
        detailTitle: "当前选择",
        panelHtml: '<div class="empty small">选择左侧账号后显示详情。</div>',
        switchLabel: helperReady ? "立即切换" : "下载 auth.json",
        switchDisabled: true,
        copyDisabled: true,
      };
    }

    function renderSelectedAccount({
      account,
      current = false,
      userPresent = false,
      helperReady = false,
      operationActive = false,
    } = {}) {
      if (!account) return renderEmpty({ helperReady });
      const token = tokenState(account);
      const issue = usageIssue(account);
      const plan = accountPlan(account);
      const usable = canUseAccount(account);
      const badgeClass = issue?.className || token.className;
      const hasRt = accountHasRt(account);
      const blockReason = accountBlockReason(account, token);
      const needsAuth = Boolean(issue || token.className === "warn" || !usable);
      return {
        selectedState: [
          account.email || "",
          issue?.label || token.label,
          planLabel(plan),
        ].filter(Boolean).join(" · "),
        detailTitle: account.name || "当前选择",
        switchLabel: helperReady ? "立即切换" : "下载 auth.json",
        switchDisabled: !usable || operationActive,
        copyDisabled: !usable,
        panelHtml: `
          <div class="account-hero">
            <div class="badge-row">
              ${current ? '<span class="badge current-badge">正在使用</span>' : ""}
              ${userPresent ? "" : `<span class="badge">${escapeHtml(sourceLabel(account))}</span>`}
              <span class="badge ${badgeClass}"><span class="status-dot ${badgeClass}"></span>${escapeHtml(issue?.label || token.label)}</span>
              <span class="badge ${planClass(plan)}">${escapeHtml(planLabel(plan))}</span>
            </div>
            <div class="quota-summary">
              ${quotaCell(account.usage?.five_hour, "5H", account.usage)}
              ${quotaCell(account.usage?.one_week, "7D", account.usage)}
            </div>
            <div class="signal-grid">
              <div class="signal wide signal-with-action">
                <span>邮箱</span>
                <strong>${escapeHtml(account.email || "未识别")}</strong>
                ${account.email ? `<button type="button" data-selected-action="copy-email" data-email="${escapeHtml(account.email)}">复制</button>` : ""}
              </div>
              <div class="signal"><span>名称</span><strong>${escapeHtml(account.name || "未命名")}</strong></div>
              <div class="signal"><span>状态</span><strong>${escapeHtml(issue?.label || token.detail || token.label)}</strong></div>
              <div class="signal"><span>套餐</span><strong>${escapeHtml(planLabel(plan))}</strong></div>
              <div class="signal"><span>最近切换</span><strong>${escapeHtml(formatTime(account.lastSwitchAt))}</strong></div>
              <div class="signal wide"><span>账号 ID</span><strong>${escapeHtml(shortId(account.accountId))}</strong></div>
            </div>
            ${hasRt ? (needsAuth ? authAcquirePanel("授权需要更新") : "") : rtUpdatePanel()}
            <div class="detail-edit">
              <div class="detail-edit-head">
                <strong>编辑</strong>
                <span>备注和智能切换偏好只影响账号池管理。</span>
              </div>
              <div class="detail-edit-grid">
                <label><span>名称</span><input id="editAccountName" value="${escapeHtml(account.name || "")}" /></label>
                <label><span>分组</span><input id="editAccountGroup" value="${escapeHtml(account.group || "默认")}" /></label>
                <label>
                  <span>智能切换偏好</span>
                  <select id="editAccountPriority">
                    <option value="primary" ${account.priority === "primary" ? "selected" : ""}>优先使用</option>
                    <option value="normal" ${account.priority !== "primary" && account.priority !== "reserve" ? "selected" : ""}>正常使用</option>
                    <option value="reserve" ${account.priority === "reserve" ? "selected" : ""}>尽量少用</option>
                  </select>
                </label>
                <label><span>备注</span><input id="editUsageNote" value="${escapeHtml(account.usageNote || "")}" /></label>
              </div>
              <button type="button" data-selected-action="save-details">保存修改</button>
            </div>
          </div>
        `,
      };
    }

    return Object.freeze({
      authAcquirePanel,
      quotaCell,
      renderEmpty,
      renderSelectedAccount,
    });
  }

  return Object.freeze({
    createAccountDetailUi,
  });
});
