(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexSettingsUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createSettingsUi(deps = {}) {
    const escapeHtml = deps.escapeHtml
      || root.CodexFormatCore?.escapeHtml
      || fallbackEscapeHtml;

    function selected(value, current) {
      return Number(current) === Number(value) ? "selected" : "";
    }

    function disabledWhen(condition) {
      return condition ? "" : "disabled";
    }

    function checkedWhen(condition) {
      return condition ? "checked" : "";
    }

    function optionList(options, current) {
      return options.map((option) => (
        `<option value="${escapeHtml(option.value)}" ${selected(option.value, current)}>${escapeHtml(option.label)}</option>`
      )).join("");
    }

    function renderAccountState({ user } = {}) {
      if (user) {
        const role = user.role === "admin" ? "管理员账号" : "同步账号";
        const status = user.status === "disabled" ? "已停用" : "可用";
        return `<strong>${escapeHtml(user.email)}</strong><span>${role} · ${status}</span><button id="logoutInlineBtn" type="button">退出登录</button>`;
      }
      return '<strong>未登录</strong><span>本地账号池仍可使用；登录后可同步云端。</span><button id="loginInlineBtn" type="button">登录或注册</button>';
    }

    function renderHelperState({ helperReady, codex } = {}) {
      const status = codex || {};
      return `
        <strong>${helperReady ? "Helper 在线" : "Helper 离线"}</strong>
        <span>${escapeHtml(helperReady ? `Codex：${status.label || "状态确认中"}` : "未安装时可下载 auth.json 手动替换。")}</span>
        ${helperReady && status.detail ? `<span>${escapeHtml(status.detail)}</span>` : ""}
        ${helperReady && status.pending_switch_reason ? `<span>${escapeHtml(status.pending_switch_reason)}</span>` : ""}
      `;
    }

    function renderBackupCloudState({ user, localAccountCount = 0, cloudBackupEnabled = false } = {}) {
      if (!user) return "<strong>自动备份到云端</strong><span>登录后可开启。未登录时账号只保存在当前浏览器。</span>";
      return `
        <label class="setting-toggle">
          <span><strong>自动备份到云端</strong><small>登录后导入的账号自动保存到云端。本机离线副本 ${Number(localAccountCount) || 0} 个。</small></span>
          <input id="autoBackupCloudToggle" type="checkbox" ${checkedWhen(cloudBackupEnabled)} />
        </label>
      `;
    }

    function renderSmartSwitchSettings({
      user,
      helperReady,
      helperInfo,
      autoSwitchStatus,
      autoSettings,
      smartSettings,
      defaultAutoSwitchSettings,
    } = {}) {
      const settings = smartSettings || {};
      const auto = { ...(defaultAutoSwitchSettings || {}), ...(autoSettings || {}) };
      const showAutoAt = Boolean(auto.showExperimentalAt);
      const showSmartAt = Boolean(settings.showExperimentalAt);
      const authorized = Boolean(autoSwitchStatus?.helperAuthorized || helperInfo?.auto_switch?.authorized);
      const autoStateText = !user
        ? "登录后可开启。"
        : !helperReady ? "等待 Dock Helper 在线。"
          : authorized ? "本机 Helper 已授权。"
            : "需要授权本机 Helper。";
      const autoDisabled = disabledWhen(Boolean(user));
      const autoCooldownOptions = [
        { value: 0, label: "不限制" },
        { value: 3, label: "3 分钟" },
        { value: 5, label: "5 分钟" },
        { value: 10, label: "10 分钟" },
        { value: 30, label: "30 分钟" },
        { value: 60, label: "1 小时" },
      ];
      const globalCooldownOptions = [
        { value: 30, label: "30 秒" },
        { value: 60, label: "1 分钟" },
        { value: 120, label: "2 分钟" },
        { value: 180, label: "3 分钟" },
      ];
      const idleOptions = [
        { value: 10, label: "10 秒" },
        { value: 15, label: "15 秒" },
        { value: 30, label: "30 秒" },
        { value: 60, label: "1 分钟" },
        { value: 90, label: "90 秒" },
        { value: 120, label: "2 分钟" },
      ];

      return `
        <div class="settings-section-title">自动切换</div>
        <label class="setting-toggle">
          <span><strong>后台自动切换</strong><small>账号耗尽、限流或授权失效时，Helper 会静默切换到可用账号。</small></span>
          <input type="checkbox" data-auto-switch-setting="enabled" ${checkedWhen(auto.enabled)} ${autoDisabled} />
        </label>
        <div class="setting-box compact">
          <strong>${escapeHtml(autoStateText)}</strong>
          <span>触发阈值：5H ≤ ${Number(auto.fiveHourThreshold || 5)}%，7D ≤ ${Number(auto.oneWeekThreshold || 5)}%。额度检查约 ${Number(helperInfo?.auto_switch?.effective_poll_seconds || auto.pollSeconds || 15)} 秒一次。</span>
          <div class="setting-actions inline">
            <button id="authorizeAutoSwitchBtn" type="button" ${user && helperReady ? "" : "disabled"}>${authorized ? "重新授权 Helper" : "授权本机 Helper"}</button>
            <button id="revokeAutoSwitchBtn" type="button" ${user && authorized ? "" : "disabled"}>解除授权</button>
          </div>
        </div>
        <label class="setting-toggle">
          <span><strong>只用付费账号</strong><small>自动切换只选择 Plus、Pro 或 Team。</small></span>
          <input type="checkbox" data-auto-switch-setting="paidOnly" ${checkedWhen(auto.paidOnly)} ${autoDisabled} />
        </label>
        <label class="setting-toggle">
          <span><strong>优先 RT</strong><small>优先选择长期可刷新账号。</small></span>
          <input type="checkbox" data-auto-switch-setting="preferRt" ${checkedWhen(auto.preferRt)} ${autoDisabled} />
        </label>
        <label class="setting-toggle">
          <span><strong>显示 AT 实验入口</strong><small>默认隐藏 AT 相关设置；AT 当前不作为 Codex 商业可用凭证。</small></span>
          <input type="checkbox" data-auto-switch-setting="showExperimentalAt" ${checkedWhen(showAutoAt)} ${autoDisabled} />
        </label>
        ${showAutoAt ? `
          <label class="setting-toggle">
            <span><strong>允许 AT</strong><small>隐藏实验兼容能力；仅用于未来官方通道恢复后的显式测试。</small></span>
            <input type="checkbox" data-auto-switch-setting="allowAt" ${checkedWhen(auto.allowAt)} ${autoDisabled} />
          </label>
        ` : ""}
        <label class="setting-toggle">
          <span><strong>避开当前账号</strong><small>自动切换不会重新选中当前账号。</small></span>
          <input type="checkbox" data-auto-switch-setting="avoidCurrent" ${checkedWhen(auto.avoidCurrent)} ${autoDisabled} />
        </label>
        <label class="setting-toggle">
          <span><strong>只在空闲时切换</strong><small>根据本机任务日志判断 Codex 是否空闲，避免打断正在执行的任务。</small></span>
          <input type="checkbox" data-auto-switch-setting="onlyWhenIdle" ${checkedWhen(auto.onlyWhenIdle !== false)} ${autoDisabled} />
        </label>
        <label class="setting-line">
          <span><strong>空闲保护</strong><small>连续空闲达到该时间后才允许自动重启 Codex。</small></span>
          <select data-auto-switch-setting="idleSeconds" ${autoDisabled}>
            ${optionList(idleOptions, Number(auto.idleSeconds || 10))}
          </select>
        </label>
        <label class="setting-line">
          <span><strong>触发节流</strong><small>连续触发时最短等待时间，避免重复重启。</small></span>
          <select data-auto-switch-setting="globalCooldownSeconds" ${autoDisabled}>
            ${optionList(globalCooldownOptions, Number(auto.globalCooldownSeconds || 180))}
          </select>
        </label>
        <label class="setting-line">
          <span><strong>账号冷却</strong><small>自动切换后，该账号暂时不再参与候选。</small></span>
          <select data-auto-switch-setting="cooldownMinutes" ${autoDisabled}>
            ${optionList(autoCooldownOptions, Number(auto.cooldownMinutes || 0))}
          </select>
        </label>
        <div class="settings-section-title">手动智能切换</div>
        <label class="setting-toggle">
          <span><strong>只使用付费账号</strong><small>智能切换优先选择 Plus、Pro 或 Team。</small></span>
          <input type="checkbox" data-smart-setting="paidOnly" ${checkedWhen(settings.paidOnly)} />
        </label>
        <label class="setting-toggle">
          <span><strong>优先 RT</strong><small>有 RT 的账号会获得更高分。</small></span>
          <input type="checkbox" data-smart-setting="preferRt" ${checkedWhen(settings.preferRt)} />
        </label>
        <label class="setting-toggle">
          <span><strong>显示 AT 实验入口</strong><small>默认隐藏 AT 相关设置；AT 账号会标注为当前不支持 Codex。</small></span>
          <input type="checkbox" data-smart-setting="showExperimentalAt" ${checkedWhen(showSmartAt)} />
        </label>
        ${showSmartAt ? `
          <label class="setting-toggle">
            <span><strong>允许 AT</strong><small>隐藏实验兼容能力；开启后仍会显示风险提示。</small></span>
            <input type="checkbox" data-smart-setting="allowAt" ${checkedWhen(settings.allowAt)} />
          </label>
        ` : ""}
        <label class="setting-toggle">
          <span><strong>避开当前账号</strong><small>尽量不要重复选中正在使用的账号。</small></span>
          <input type="checkbox" data-smart-setting="avoidCurrent" ${checkedWhen(settings.avoidCurrent)} />
        </label>
        <label class="setting-toggle">
          <span><strong>避开 5H 低余量</strong><small>5H 余量低于 30% 时跳过。</small></span>
          <input type="checkbox" data-smart-setting="avoidLow5h" ${checkedWhen(settings.avoidLow5h)} />
        </label>
        <label class="setting-toggle">
          <span><strong>避开 7D 低余量</strong><small>7D 余量低于 30% 时跳过。</small></span>
          <input type="checkbox" data-smart-setting="avoidLow7d" ${checkedWhen(settings.avoidLow7d)} />
        </label>
        <label class="setting-line">
          <span><strong>切换冷却</strong><small>最近切换过的账号暂时不参与智能切换。</small></span>
          <select data-smart-setting="cooldownMinutes">
            ${optionList(autoCooldownOptions, Number(settings.cooldownMinutes || 0))}
          </select>
        </label>
      `;
    }

    return Object.freeze({
      renderAccountState,
      renderHelperState,
      renderBackupCloudState,
      renderSmartSwitchSettings,
    });
  }

  return Object.freeze({
    createSettingsUi,
  });
});
