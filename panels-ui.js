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
    const formatBytes = deps.formatBytes || formatCore.formatBytes || ((value) => `${Number(value) || 0} B`);
    const auditTitle = deps.auditTitle || auditCore.auditTitle || ((item) => item?.action || "操作记录");
    const auditDescription = deps.auditDescription || auditCore.auditDescription || ((item) => item?.result || "已完成");

    function codexStatusSourceLabel(status = {}) {
      if (status.source === "logs_2.sqlite") return "任务日志";
      if (status.source === "process") return "进程检测";
      if (!status.protocol_connected) return "任务日志";
      return "任务日志";
    }

    function compareVersion(left, right) {
      const a = String(left || "").split(".").map((part) => Number(part) || 0);
      const b = String(right || "").split(".").map((part) => Number(part) || 0);
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
      }
      return 0;
    }

    function helperAutoSwitch(helper = {}) {
      return helper.auto_switch || helper.autoSwitch || {};
    }

    function meaningfulText(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      if (/^(无|暂无|none|null|undefined|n\/a)$/i.test(text)) return "";
      return text;
    }

    function helperDownloadUrl(release = {}) {
      const file = release.downloadUrl || release.file || "downloads/CodexDockHelper.exe";
      if (/^https?:\/\//i.test(file)) return file;
      return file.startsWith("/") ? file : `/${file}`;
    }

    function shortSha(value) {
      const text = String(value || "").trim();
      if (text.length <= 18) return text;
      return `${text.slice(0, 12)}...${text.slice(-6)}`;
    }

    function renderHelperRelease({ helperReady = false, helper = {}, helperRelease = {}, minimumHelperVersion = "0.4.2" } = {}) {
      const latestVersion = helperRelease.version || minimumHelperVersion;
      const latestBuild = helperRelease.build_date || helperRelease.buildDate || "";
      const currentVersion = helperReady ? (helper.version || "旧版未上报") : "未连接";
      const currentOutdated = helperReady && (!helper.version || compareVersion(helper.version, minimumHelperVersion) < 0);
      const releaseKnown = Boolean(helperRelease.file || helperRelease.sha256 || helperRelease.version);
      const cardClass = helperReady && !currentOutdated ? "ok" : "warn";
      const statusText = !helperReady
        ? "未检测到本机 Helper，可先下载最新版。"
        : currentOutdated
          ? `当前 ${currentVersion} 低于最低支持版本 v${minimumHelperVersion}，建议升级后重启 Helper。`
          : `当前 ${currentVersion} 可用；如需重新安装，可下载同版本发布包。`;
      return `
        <div class="helper-release-card ${escapeHtml(cardClass)}">
          <div class="helper-release-main">
            <span>Helper 分发</span>
            <strong>最新版 v${escapeHtml(latestVersion)}${latestBuild ? ` · ${escapeHtml(latestBuild)}` : ""}</strong>
            <small>${releaseKnown ? `发布包 ${escapeHtml(formatBytes(helperRelease.bytes || 0))} · SHA-256 ${escapeHtml(shortSha(helperRelease.sha256))}` : "发布包信息加载中。"}</small>
          </div>
          <div class="helper-release-current">
            <span>当前设备</span>
            <strong>${escapeHtml(statusText)}</strong>
          </div>
          <div class="helper-release-actions">
            <a class="button-link primary-link" href="${escapeHtml(helperDownloadUrl(helperRelease))}" download>下载最新版</a>
            <button type="button" data-helper-action="copy-helper-sha" ${helperRelease.sha256 ? "" : "disabled"}>复制校验值</button>
          </div>
        </div>
      `;
    }

    function helperDiagnostic({
      helperReady = false,
      helper = {},
      codex = {},
      helperAuthorized = false,
      userPresent = false,
      minimumHelperVersion = "0.4.2",
    } = {}) {
      const autoSwitch = helperAutoSwitch(helper);
      const version = helper.version || "";
      const outdated = helperReady && (!version || compareVersion(version, minimumHelperVersion) < 0);
      const tray = helper.tray || {};
      if (!helperReady) {
        return {
          className: "bad",
          title: "Helper 未连接",
          reason: "没有探测到本机 Helper，本机 auth 写入、状态监控和自动切换都不可执行。",
          action: "启动或下载最新版 Helper，然后点击“刷新状态”。",
        };
      }
      if (outdated) {
        return {
          className: "warn",
          title: "Helper 需要升级",
          reason: `当前 Helper 版本 ${version || "未上报"} 低于最低支持版本 ${minimumHelperVersion}。`,
          action: "下载最新版 Helper 并重启本地助手。",
        };
      }
      if (tray.last_error || tray.visible === false) {
        return {
          className: "warn",
          title: "托盘需要修复",
          reason: tray.last_error || "Helper 服务在线，但托盘状态未确认可见。",
          action: "点击“修复托盘图标”，无需重启账号池。",
        };
      }
      if (!helperAuthorized) {
        return {
          className: "warn",
          title: "需要授权 Helper",
          reason: userPresent
            ? "本机 Helper 在线，但还没有绑定当前云控制台的设备令牌。"
            : "本机 Helper 在线；登录云账号后才能授权自动切换。",
          action: userPresent ? "点击“授权 Helper”，让云端只向这台设备下发切换任务。" : "先登录云账号，再授权本机 Helper。",
        };
      }
      const pendingSwitchReason = meaningfulText(codex.pending_switch_reason);
      if (pendingSwitchReason) {
        return {
          className: "warn",
          title: "保护当前任务",
          reason: pendingSwitchReason,
          action: codex.safe_to_switch ? "已到安全边界，可以继续执行切换。" : "等待当前 Codex 轮次完成，不会抢切账号。",
        };
      }
      if (codex.safe_to_switch === false) {
        return {
          className: "warn",
          title: "等待安全边界",
          reason: codex.detail || "Codex 当前仍在执行或尚未稳定空闲。",
          action: "自动切换会继续观察任务日志，确认安全后再换号。",
        };
      }
      if (autoSwitch.enabled === false) {
        return {
          className: "warn",
          title: "自动切换未开启",
          reason: "Helper 已授权，但本机自动切换守护当前处于关闭状态。",
          action: "在智能切换设置中开启后台自动切换。",
        };
      }
      return {
        className: "ok",
        title: "Helper 可用",
        reason: "本机 Helper 在线、已授权，Codex 当前处于可解释状态。",
        action: "可以手动切换、刷新额度或交给智能切换。",
      };
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
      helperAuthorized = false,
      userPresent = false,
      minimumHelperVersion = "0.4.2",
      helperRelease = {},
      currentAuthChecking = false,
      currentAuthMatched = false,
    } = {}) {
      const autoSwitch = helperAutoSwitch(helper);
      const tray = helper.tray || {};
      const diagnostic = helperDiagnostic({
        helperReady,
        helper,
        codex,
        helperAuthorized,
        userPresent,
        minimumHelperVersion,
      });
      const idleSeconds = Number(codex.idle_seconds);
      const stableSeconds = Number(codex.stable_seconds);
      const idleText = Number.isFinite(idleSeconds) && idleSeconds >= 0
        ? `${Math.floor(idleSeconds)} 秒`
        : Number.isFinite(stableSeconds) && stableSeconds >= 0 ? `${Math.floor(stableSeconds)} 秒` : "未确认";
      const lastEventTime = codex.last_task_event_at ? ` · ${formatTime(codex.last_task_event_at)}` : "";
      const lastEvent = codex.last_task_event ? `${codex.last_task_event}${lastEventTime}` : "暂无近期任务事件";
      const pendingReason = meaningfulText(codex.pending_switch_reason) || "无";
      const switchSafety = codex.safe_to_switch ? "可安全切换" : "暂不切换";
      const lastSwitch = autoSwitch.last_switch
        ? `${autoSwitch.last_switch_label || "已切换"} · ${formatTime(autoSwitch.last_switch)}`
        : "无记录";
      const lastResult = autoSwitch.last_reason || autoSwitch.last_result || "无";
      const heartbeat = autoSwitch.cloud_last_sync || autoSwitch.last_check || "";
      const trayStatus = helperReady
        ? `${tray.visible === false ? "未确认" : "已注册"}${tray.last_reason ? ` · ${tray.last_reason}` : ""}${tray.last_error ? ` · ${tray.last_error}` : ""}`
        : "未连接";
      const rows = [
        ["连接", helperReady ? "在线" : "未连接"],
        ["Helper 版本", helperReady ? (helper.version ? `v${helper.version}${helper.build_date ? ` · ${helper.build_date}` : ""}` : "旧版未上报") : "未连接"],
        ["地址", helperReady ? helperBase || "本机" : "未探测到"],
        ["端口", helper.port || "未识别"],
        ["设备授权", helperReady ? (helperAuthorized ? "已授权当前控制台" : "未授权或授权到其它控制台") : "未连接"],
        ["最近心跳", helperReady ? (heartbeat ? formatTime(heartbeat) : "无记录") : "未连接"],
        ["最近切换", helperReady ? lastSwitch : "未连接"],
        ["最近结果", helperReady ? lastResult : "未连接"],
        ["令牌到期", helperReady ? (autoSwitch.token_expires_at ? formatTime(autoSwitch.token_expires_at) : "未授权") : "未连接"],
        ["托盘", trayStatus],
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
        <div class="helper-diagnostic ${escapeHtml(diagnostic.className)}">
          <div>
            <span>诊断结论</span>
            <strong>${escapeHtml(diagnostic.title)}</strong>
          </div>
          <div>
            <span>原因</span>
            <strong>${escapeHtml(diagnostic.reason)}</strong>
          </div>
          <div>
            <span>下一步</span>
            <strong>${escapeHtml(diagnostic.action)}</strong>
          </div>
        </div>
        <div class="helper-action-row">
          <button type="button" data-helper-action="refresh">刷新状态</button>
          <button type="button" data-helper-action="authorize" ${helperReady && userPresent ? "" : "disabled"}>${helperAuthorized ? "重新授权 Helper" : "授权 Helper"}</button>
          <button type="button" data-helper-action="repair-tray" ${helperReady ? "" : "disabled"}>修复托盘</button>
          <button type="button" data-helper-action="open-status" ${helperReady ? "" : "disabled"}>本机状态页</button>
          <button type="button" data-helper-action="export-diagnostics" ${helperReady ? "" : "disabled"}>导出诊断</button>
        </div>
        ${renderHelperRelease({ helperReady, helper, helperRelease, minimumHelperVersion })}
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
      helperDiagnostic,
      renderHelperRelease,
      renderAudit,
      renderDevice,
      securitySummary,
    });
  }

  return Object.freeze({
    createPanelsUi,
  });
});
