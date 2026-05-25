(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexShellUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function selectedSetHas(selectedBulkIds, id) {
    return Boolean(selectedBulkIds && typeof selectedBulkIds.has === "function" && selectedBulkIds.has(id));
  }

  function createShellUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const formatBytes = deps.formatBytes || formatCore.formatBytes || ((value) => `${Number(value) || 0} B`);
    const cloudBackupEnabled = deps.cloudBackupEnabled || (() => false);
    const canUseAccount = deps.canUseAccount || (() => false);
    const resolveCurrentAccountId = deps.resolveCurrentAccountId || (() => "");
    const accountPlan = deps.accountPlan || ((account) => account?.planType || account?.plan_type || "");
    const tokenState = deps.tokenState || (() => ({ className: "" }));

    function renderCommandAttachments(files = []) {
      return files.map((file, index) => `
        <button class="attachment-chip" type="button" data-attachment-index="${index}" title="移除 ${escapeHtml(file.name)}">
          <span>${escapeHtml(file.name)}</span>
          <small>${escapeHtml(formatBytes(file.size))}</small>
          <strong aria-hidden="true">×</strong>
        </button>
      `).join("");
    }

    function commandShellState({ files = [], accounts = [] } = {}) {
      const hasFiles = files.length > 0;
      return {
        hasFiles,
        quickSwitchText: hasFiles ? "解析导入" : "智能切换",
        quickSwitchDisabled: hasFiles ? false : !accounts.some(canUseAccount),
      };
    }

    function toolbarState({ filtered = [], selectedBulkIds, helperReady = false, canRefreshUsage, isInvalidAccount } = {}) {
      const selected = filtered.filter((account) => selectedSetHas(selectedBulkIds, account.id));
      const refreshAvailable = selected.some((account) => (
        typeof canRefreshUsage === "function" ? canRefreshUsage(account) : helperReady
      ));
      const invalidSelected = selected.filter((account) => (
        typeof isInvalidAccount === "function" ? isInvalidAccount(account) : false
      )).length;
      const normalSelected = selected.length - invalidSelected;
      const cleanupHint = selected.length
        ? (normalSelected
          ? `包含 ${normalSelected} 个看似可用账号，删除前会二次确认。`
          : `已选择 ${invalidSelected} 个需处理账号，可清理后通过 OAuth 重新导入。`)
        : "先选择当前结果或需处理账号，再执行批量操作。";
      return {
        selectedCount: selected.length,
        resultCount: filtered.length,
        bulkText: selected.length ? `已选择 ${selected.length} 个账号` : `当前结果 ${filtered.length} 个`,
        hasSelection: selected.length > 0,
        refreshDisabled: !selected.length || !refreshAvailable,
        exportDisabled: !selected.length,
        deleteDisabled: !selected.length,
        priorityDisabled: !selected.length,
        deleteText: selected.length && !normalSelected && invalidSelected ? "清理不可用" : "删除所选",
        cleanupHint,
      };
    }

    function renderMetrics(accounts = []) {
      const total = accounts.length;
      const plusLike = accounts.filter((account) => ["plus", "pro", "team", "enterprise"].includes(String(accountPlan(account)).toLowerCase())).length;
      const usageReady = accounts.filter((account) => account.usage?.refreshed_at && !account.usage?.error).length;
      const attention = accounts.filter((account) => ["warn", "bad"].includes(tokenState(account).className)).length;
      const current = resolveCurrentAccountId() ? 1 : 0;
      return [
        ["账号总数", total],
        ["付费等级", plusLike],
        ["额度已刷新", usageReady],
        ["需处理账号", attention],
        ["当前选择", current],
      ].map(([label, value]) => `
        <div class="metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("");
    }

    function renderHealthCenter({ groups = [], activeKey = "all", total = 0 } = {}) {
      if (!total) {
        return `
          <div class="health-center empty">
            <div class="health-center-head">
              <strong>账号健康</strong>
              <span>导入账号后，这里会按可用性、额度和 Helper 状态自动分组。</span>
            </div>
          </div>
        `;
      }
      return `
        <div class="health-center">
          <div class="health-center-head">
            <strong>账号健康</strong>
            <span>点击状态筛选列表；下方批量工具可处理当前结果。</span>
          </div>
          <div class="health-chip-row" role="group" aria-label="账号健康筛选">
            ${groups.map((group) => {
              const active = group.key === activeKey;
              return `
                <button class="health-chip ${escapeHtml(group.className || "")} ${active ? "active" : ""}" type="button" data-health-filter="${escapeHtml(group.key)}" ${group.disabled ? "disabled" : ""}>
                  <span>${escapeHtml(group.label)}</span>
                  <strong>${escapeHtml(group.count)}</strong>
                  <small>${escapeHtml(group.description || "")}</small>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    function shellViewModel(state = {}) {
      const accounts = Array.isArray(state.accounts) ? state.accounts : [];
      const total = accounts.length;
      const cloudText = state.user ? `${state.user.email}${cloudBackupEnabled() ? " · 已同步" : ""}` : "未登录";
      const helperText = state.helperReady ? "Helper 在线" : "Helper 未连接";
      const codexStatus = state.codexStatus || {};
      const codexLabel = state.helperReady
        ? (codexStatus.label || "状态确认中")
        : "Codex 未探测";
      const codexClass = codexStatus.state === "idle"
        ? "ready"
        : ["active", "waiting", "cooling"].includes(codexStatus.state) ? "warn"
          : codexStatus.state === "not_running" ? ""
            : "warn";
      const subtitles = {
        accounts: "",
        helper: "安装后即可自动写入 auth 并重启 Codex。",
        admin: "查看用户、设备和最近操作。",
      };
      const autoEnabled = Boolean(state.autoSwitchSettings?.enabled);
      const autoAuthorized = Boolean(state.autoSwitchStatus?.helperAuthorized);
      const autoRuntimeLabel = codexStatus.state === "idle"
        ? "自动切换已开启 · 当前空闲"
        : codexStatus.state === "active" ? "自动切换已开启 · 等待任务结束"
          : codexStatus.state === "cooling" ? "自动切换已开启 · 等待稳定空闲"
            : codexStatus.state === "unknown" ? "检测未知，已暂停自动切换"
              : codexStatus.state === "not_running" ? "Codex 未运行，自动切换暂停"
                : "自动切换已开启";
      const autoLabel = !state.user
        ? "自动切换需登录"
        : !autoEnabled ? "自动切换未开启"
          : !state.helperReady ? "自动切换待 Helper"
            : !autoAuthorized ? "自动切换待授权"
              : autoRuntimeLabel;
      const autoClass = autoEnabled && autoAuthorized && state.helperReady && codexStatus.state === "idle"
        ? "ready"
        : autoEnabled ? "warn" : "";
      const helperLabel = state.currentAuthChecking ? "确认 auth" : (state.helperReady ? "Helper 在线" : "Helper 离线");
      const cloudSynced = Boolean(state.user && cloudBackupEnabled());
      const commandState = commandShellState({ files: state.commandFiles || [], accounts });
      const usageSettings = state.usageRefreshSettings || {};
      const mode = usageSettings.usageRefreshMode || "helper";
      const cloudAvailable = Boolean(state.user && usageSettings.cloudUsageRefreshEnabled);
      const canRefreshUsage = (account) => {
        const cloudForAccount = Boolean(cloudAvailable && account.cloudId);
        if (mode === "helper") return Boolean(state.helperReady);
        if (mode === "cloud") return cloudForAccount;
        if (mode === "auto") return Boolean(state.helperReady || (usageSettings.helperFallbackToCloud && cloudForAccount));
        return Boolean(state.helperReady || cloudForAccount);
      };

      return {
        viewSubtitle: subtitles[state.currentView] || "",
        homeHeadline: !state.authResolved ? "正在加载账号池" : (total ? "选择一个账号，或交给智能切换" : "导入账号后开始切换"),
        homeSubcopy: !state.authResolved ? "正在确认登录状态。" : (state.user ? "已开启多设备账号池。" : "登录后可在多台设备同步账号池。"),
        vaultTitle: !state.authResolved ? "账号池" : `${state.user ? "账号池" : "本地账号池"} · ${total} 个账号`,
        vaultCopy: "",
        sideCloudText: cloudText,
        sideCloudClass: state.user ? "ready" : "",
        sideHelperText: helperText,
        sideHelperClass: state.helperReady ? "ready" : "warn",
        syncPillHtml: `<span class="status-dot ${state.user ? "ok" : ""}"></span>${escapeHtml(state.user ? (cloudSynced ? "已同步" : "已登录") : "本地")}`,
        syncPillClass: `status-pill ${state.user ? "ready" : ""}`,
        autoSwitchPillHtml: `<span class="status-dot ${autoClass === "ready" ? "ok" : autoClass === "warn" ? "warn" : ""}"></span>${escapeHtml(autoLabel)}`,
        autoSwitchPillClass: `status-pill ${autoClass}`,
        codexPillHtml: `<span class="status-dot ${codexClass === "ready" ? "ok" : codexClass === "warn" ? "warn" : ""}"></span>${escapeHtml(codexLabel)}`,
        codexPillClass: `status-pill ${codexClass}`,
        helperPillHtml: `<span class="status-dot ${state.helperReady ? "ok" : "warn"}"></span>${escapeHtml(helperLabel)}`,
        helperPillClass: `status-pill ${state.helperReady ? "ready" : "warn"}`,
        userMenuText: state.user ? state.user.email : "登录以同步",
        sidebarLoginText: state.user ? "账号设置" : "登录以同步",
        sidebarSyncTitle: state.user ? "已登录" : "快速切换",
        sidebarSyncText: state.user
          ? (cloudBackupEnabled() ? "账号池会自动同步。" : "可在设置里开启同步。")
          : "安装 Helper 后可一键切换。",
        adminOnlyHidden: state.user?.role !== "admin",
        sidebarCollapsed: Boolean(state.sidebarCollapsed),
        sidebarExpanded: String(!state.sidebarCollapsed),
        sidebarToggleLabel: state.sidebarCollapsed ? "展开侧边栏" : "隐藏侧边栏",
        refreshAllUsageDisabled: !accounts.some((account) => canUseAccount(account) && canRefreshUsage(account)) || Boolean(state.refreshingUsage),
        importLocalAuthDisabled: !state.helperReady,
        commandState,
      };
    }

    return Object.freeze({
      renderCommandAttachments,
      commandShellState,
      toolbarState,
      renderMetrics,
      renderHealthCenter,
      shellViewModel,
    });
  }

  return Object.freeze({
    createShellUi,
  });
});
