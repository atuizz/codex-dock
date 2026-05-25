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

    function selectedText(value, current) {
      return String(value) === String(current) ? "selected" : "";
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

    function compareVersion(left, right) {
      const a = String(left || "").split(".").map((part) => Number(part) || 0);
      const b = String(right || "").split(".").map((part) => Number(part) || 0);
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
      }
      return 0;
    }

    function renderHelperState({ helperReady, helper = {}, codex, minimumHelperVersion = "0.4.2" } = {}) {
      const status = codex || {};
      const version = helper.version || "";
      const outdated = helperReady && (!version || compareVersion(version, minimumHelperVersion) < 0);
      return `
        <strong>${helperReady ? `Helper 在线${version ? ` · v${escapeHtml(version)}` : ""}` : "Helper 离线"}</strong>
        <span>${escapeHtml(helperReady ? `Codex：${status.label || "状态确认中"}` : "未安装时可下载 auth.json 手动替换。")}</span>
        ${outdated ? `<span class="warning-text">Helper 版本过旧，请升级至 v${escapeHtml(minimumHelperVersion)} 或更高版本。</span>` : ""}
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

    function renderUsageRefreshSettings({ user, helperReady, usageSettings = {} } = {}) {
      const settings = {
        usageRefreshMode: "helper",
        cloudUsageRefreshEnabled: false,
        helperFallbackToCloud: false,
        usageRefreshConcurrency: 1,
        usageRefreshIntervalMs: 1500,
        lastUsageRefreshSource: "",
        lastUsageRefreshAt: "",
        ...usageSettings,
      };
      const cloudDisabled = user ? "" : "disabled";
      const sourceLabels = {
        helper: "本机 Helper",
        "cloud-worker": "云端 Worker",
        "auto-helper": "自动选择 / 本机 Helper",
        "auto-cloud-fallback": "自动选择 / 云端回退",
        mixed: "混合通道（查看各账号结果）",
      };
      const lastSource = sourceLabels[settings.lastUsageRefreshSource] || "还没有刷新记录";
      return `
        <div class="settings-section-title">额度刷新方式</div>
        <label class="setting-line">
          <span><strong>执行通道</strong><small>推荐使用本机网络；云端刷新需要主动授权。</small></span>
          <select data-usage-refresh-setting="usageRefreshMode">
            <option value="helper" ${selectedText("helper", settings.usageRefreshMode)}>本机 Helper（推荐）</option>
            <option value="cloud" ${selectedText("cloud", settings.usageRefreshMode)} ${cloudDisabled}>云端 Worker</option>
            <option value="auto" ${selectedText("auto", settings.usageRefreshMode)} ${cloudDisabled}>自动选择</option>
            <option value="manual" ${selectedText("manual", settings.usageRefreshMode)}>仅手动刷新</option>
          </select>
        </label>
        <div class="setting-box compact usage-refresh-status">
          <strong>最近实际通道：${escapeHtml(lastSource)}</strong>
          <span>${settings.lastUsageRefreshAt ? `最近刷新于 ${escapeHtml(settings.lastUsageRefreshAt)}` : "刷新完成后会显示本次实际通过哪条网络通道执行。"}</span>
          <span>${helperReady ? "本机 Helper 当前在线。" : "本机 Helper 当前离线；只有已授权云端刷新时才能从网页继续检查额度。"}</span>
        </div>
        <label class="setting-toggle">
          <span><strong>允许云端 Worker 刷新</strong><small>Worker 将在受限额度内解密该账号授权并请求用量接口；适用于无 Helper 场景。</small></span>
          <input type="checkbox" data-usage-refresh-setting="cloudUsageRefreshEnabled" ${checkedWhen(settings.cloudUsageRefreshEnabled)} ${cloudDisabled} />
        </label>
        <label class="setting-toggle">
          <span><strong>Helper 失败后回退云端</strong><small>仅自动选择模式生效，且必须已允许云端刷新。</small></span>
          <input type="checkbox" data-usage-refresh-setting="helperFallbackToCloud" ${checkedWhen(settings.helperFallbackToCloud)} ${cloudDisabled} />
        </label>
        <label class="setting-line">
          <span><strong>批量并发</strong><small>限制一次并行刷新数量，降低网络与用量接口压力。</small></span>
          <select data-usage-refresh-setting="usageRefreshConcurrency">
            <option value="1" ${selected(1, settings.usageRefreshConcurrency)}>1（推荐）</option>
            <option value="2" ${selected(2, settings.usageRefreshConcurrency)}>2</option>
            <option value="3" ${selected(3, settings.usageRefreshConcurrency)}>3</option>
          </select>
        </label>
        <label class="setting-line">
          <span><strong>批次间隔</strong><small>批量刷新时各批次之间的最短间隔。</small></span>
          <select data-usage-refresh-setting="usageRefreshIntervalMs">
            <option value="1000" ${selected(1000, settings.usageRefreshIntervalMs)}>1 秒</option>
            <option value="1500" ${selected(1500, settings.usageRefreshIntervalMs)}>1.5 秒（推荐）</option>
            <option value="3000" ${selected(3000, settings.usageRefreshIntervalMs)}>3 秒</option>
            <option value="5000" ${selected(5000, settings.usageRefreshIntervalMs)}>5 秒</option>
          </select>
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
      const authorized = Boolean(autoSwitchStatus?.helperAuthorized);
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
          <span><strong>后台自动切换</strong><small>账号触发切换条件后，Helper 会先保护当前任务，只在安全轮次边界换号。</small></span>
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
          <span><strong>任务连续性保护</strong><small>强制开启。额度低、额度耗尽或授权异常都不会中断仍在执行的当前轮。</small></span>
          <input type="checkbox" checked disabled aria-label="任务连续性保护已强制开启" />
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
      renderUsageRefreshSettings,
      renderSmartSwitchSettings,
    });
  }

  return Object.freeze({
    createSettingsUi,
  });
});

