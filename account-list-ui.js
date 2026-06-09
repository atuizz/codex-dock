(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexAccountListUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  const refreshIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M18.2 9A7 7 0 0 0 6.4 6.8L4 12"></path><path d="M5.8 15A7 7 0 0 0 17.6 17.2L20 12"></path></svg>';

  function createAccountListUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const shortId = deps.shortId || formatCore.shortId || ((value) => String(value || "").slice(0, 8) || "未识别");
    const formatRefreshTime = deps.formatRefreshTime || formatCore.formatRefreshTime || ((value) => value || "未刷新");
    const planLabel = deps.planLabel || formatCore.planLabel || ((value) => value || "未知");
    const planClass = deps.planClass || formatCore.planClass || (() => "plan-unknown");
    const errorSeverity = deps.errorSeverity || formatCore.errorSeverity || (() => "warn");
    const explainError = deps.explainError || ((value) => String(value || ""));
    const accountPlan = deps.accountPlan || ((account) => account?.planType || account?.plan_type || "");
    const tokenState = deps.tokenState || (() => ({ label: "未知", className: "warn" }));
    const usageIssue = deps.usageIssue || ((account) => {
      const issue = account?.usage?.error ? explainError(account.usage.error) : "";
      return issue ? { label: issue, className: errorSeverity(issue) } : null;
    });
    const accountActionMode = deps.accountActionMode || (() => "unavailable");
    const sourceLabel = deps.sourceLabel || (() => "");

    function accountInitial(account) {
      const seed = account?.name || account?.email || account?.accountId || "?";
      return String(seed).trim().slice(0, 1).toUpperCase() || "?";
    }

    function quotaMini(window, label, usage = null) {
      const issueLabel = usage?.error ? explainError(usage.error) : "";
      const issue = issueLabel ? { label: issueLabel, className: errorSeverity(issueLabel) } : null;
      if (!window) {
        return `
          <div class="quota-mini empty ${issue?.className || ""}" ${issue ? `title="${escapeHtml(issue.label)}"` : ""}>
            <div class="quota-mini-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(issue ? "待重试" : "未刷新")}</strong></div>
            <div class="mini-bar"><i style="width:0%"></i></div>
          </div>
        `;
      }
      const remaining = Number.isFinite(window.remaining_percent) ? window.remaining_percent : null;
      const used = Number.isFinite(window.used_percent) ? window.used_percent : (remaining === null ? null : 100 - remaining);
      const percent = remaining === null ? Math.max(0, 100 - (used || 0)) : remaining;
      const className = percent <= 10 ? "bad" : percent <= 30 ? "warn" : "";
      return `
        <div class="quota-mini ${className}">
          <div class="quota-mini-head"><span>${escapeHtml(label)}</span><strong>${percent}%</strong></div>
          <div class="mini-bar"><i style="width:${percent}%"></i></div>
        </div>
      `;
    }

    function quotaItems(usage = {}) {
      const items = [];
      if (usage?.five_hour) items.push({ label: "5H", window: usage.five_hour });
      if (usage?.one_week) items.push({ label: "7D", window: usage.one_week });
      const primary = usage?.primary_window;
      const primarySeconds = Number(primary?.window_seconds);
      const duplicate = [usage?.five_hour, usage?.one_week].some((item) => (
        item && Number(item.window_seconds) === primarySeconds
      ));
      if (primary && !duplicate) {
        const days = Number.isFinite(primarySeconds) ? Math.max(1, Math.round(primarySeconds / 86400)) : 0;
        items.push({ label: days ? `${days}D` : "额度", window: primary });
      }
      if (!items.length) return [
        { label: "5H", window: null },
        { label: "7D", window: null },
      ];
      return items.slice(0, 2);
    }

    function renderQuotaMinis(usage = {}) {
      return quotaItems(usage).map((item) => quotaMini(item.window, item.label, usage)).join("");
    }

    function renderAction(account, current, context) {
      const mode = accountActionMode(account);
      const label = mode === "direct-switch"
        ? (current ? "重启" : "切换")
        : (mode === "download-auth" ? "下载" : (mode === "sync-auth" || mode === "update-rt" ? "更新" : "不可用"));
      const disabled = mode === "unavailable" || context.operationActive ? "disabled" : "";
      const action = mode === "sync-auth" || mode === "update-rt" ? "recover-auth" : "switch";
      return `<button class="primary" data-account-action="${action}" data-id="${escapeHtml(account.id)}" ${disabled}>${label}</button>`;
    }

    function renderMeta(account, context) {
      const subItems = [account.email || account.accountId || "未识别邮箱", context.userPresent ? "" : sourceLabel(account)].filter(Boolean);
      return subItems.map((item, index) => `${index ? "<span>·</span>" : ""}<span>${escapeHtml(item)}</span>`).join("");
    }

    function selectedSetHas(selectedBulkIds, id) {
      return Boolean(selectedBulkIds && typeof selectedBulkIds.has === "function" && selectedBulkIds.has(id));
    }

    function renderStatus(account) {
      const token = tokenState(account);
      const issue = usageIssue(account);
      const className = issue?.className || token.className;
      return `
        <div class="account-row-status ${className}">
          <span class="status-dot ${className}"></span>
          <span>${escapeHtml(issue?.label || token.label)}</span>
          <span>·</span>
          <span>${escapeHtml(formatRefreshTime(account.usage?.refreshed_at))}</span>
        </div>
      `;
    }

    function renderActions(account, current, context) {
      const mode = accountActionMode(account);
      const canRefresh = mode === "direct-switch" || mode === "download-auth";
      const refreshAvailable = typeof context.canRefreshUsage === "function"
        ? context.canRefreshUsage(account)
        : context.helperReady;
      return `
        <div class="account-row-actions">
          <button class="icon-action" data-account-action="refresh-usage" data-id="${escapeHtml(account.id)}" ${refreshAvailable && canRefresh ? "" : "disabled"} title="刷新额度" aria-label="刷新额度">
            ${refreshIcon}
          </button>
          ${renderAction(account, current, context)}
          <button class="subtle-danger" data-account-action="delete" data-id="${escapeHtml(account.id)}" title="删除账号">删除</button>
        </div>
      `;
    }

    function renderRow(account, context) {
      const plan = accountPlan(account);
      const current = account.id === context.currentId;
      const selected = selectedSetHas(context.selectedBulkIds, account.id);
      const mode = accountActionMode(account);
      return `
        <div class="account-row ${account.id === context.selectedId ? "active" : ""} ${current ? "current" : ""} ${mode === "unavailable" || mode === "update-rt" || mode === "sync-auth" ? "unavailable" : ""}" data-id="${escapeHtml(account.id)}" role="button" tabindex="0">
          <label class="bulk-check" title="选择账号"><input type="checkbox" data-bulk-id="${escapeHtml(account.id)}" ${selected ? "checked" : ""} /></label>
          <div class="account-symbol">${escapeHtml(accountInitial(account))}</div>
          <div class="account-row-main">
            <div class="account-row-title">
              <strong>${escapeHtml(account.name)}</strong>
              ${current ? '<span class="current-chip">正在使用</span>' : ""}
              <span class="plan-chip ${planClass(plan)}">${escapeHtml(planLabel(plan))}</span>
            </div>
            <div class="account-row-sub">${renderMeta(account, context)}</div>
            ${renderStatus(account)}
          </div>
          <div class="account-row-quota">
            ${renderQuotaMinis(account.usage)}
          </div>
          ${renderActions(account, current, context)}
        </div>
      `;
    }

    function renderCard(account, context) {
      const plan = accountPlan(account);
      const current = account.id === context.currentId;
      const selected = selectedSetHas(context.selectedBulkIds, account.id);
      const mode = accountActionMode(account);
      return `
        <div class="account-card ${account.id === context.selectedId ? "active" : ""} ${current ? "current" : ""} ${mode === "unavailable" || mode === "update-rt" || mode === "sync-auth" ? "unavailable" : ""}" data-id="${escapeHtml(account.id)}" role="button" tabindex="0">
          <div class="account-card-top">
            <label class="bulk-check" title="选择账号"><input type="checkbox" data-bulk-id="${escapeHtml(account.id)}" ${selected ? "checked" : ""} /></label>
            <div class="account-symbol">${escapeHtml(accountInitial(account))}</div>
            <div class="account-card-identity">
              <strong>${escapeHtml(account.name)}</strong>
              <span>${escapeHtml(account.email || shortId(account.accountId))}</span>
            </div>
            <div class="account-card-badges">
              ${current ? '<span class="current-chip">正在使用</span>' : ""}
              <span class="plan-chip ${planClass(plan)}">${escapeHtml(planLabel(plan))}</span>
            </div>
          </div>
          ${renderStatus(account)}
          <div class="account-card-quota">
            ${renderQuotaMinis(account.usage)}
          </div>
          ${renderActions(account, current, context)}
        </div>
      `;
    }

    function renderAccountGrid(context = {}) {
      const accounts = context.accounts || [];
      const layout = context.layout === "cards" ? "cards" : "list";
      const classes = `${layout === "cards" ? "account-card-grid" : "account-list chat-list"} ${context.selectedBulkIds?.size ? "bulk-mode" : ""}`.trim();
      if (!context.authResolved) {
        return {
          className: classes,
          html: `
            <div class="empty">
              <strong>正在加载账号池</strong>
              <span>正在确认登录状态，登录后将直接显示云端账号。</span>
            </div>
          `,
        };
      }
      if (!accounts.length) {
        return {
          className: classes,
          html: `
            <div class="empty">
              <strong>${context.totalAccounts ? "没有匹配账号" : "还没有账号"}</strong>
              <span>${context.totalAccounts ? "换个关键词或调整筛选。" : "导入 auth.json 后开始管理账号。"}</span>
            </div>
          `,
        };
      }
      return {
        className: classes,
        html: accounts.map((account) => layout === "cards" ? renderCard(account, context) : renderRow(account, context)).join(""),
      };
    }

    return Object.freeze({
      accountInitial,
      quotaMini,
      renderAccountGrid,
    });
  }

  return Object.freeze({
    createAccountListUi,
  });
});
