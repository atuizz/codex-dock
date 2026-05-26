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

    function helperPackageUrl(release = {}) {
      const helperPackage = release.package || {};
      const file = helperPackage.downloadUrl || helperPackage.file || "";
      if (!file) return "";
      if (/^https?:\/\//i.test(file)) return file;
      return file.startsWith("/") ? file : `/${file}`;
    }

    function shortSha(value) {
      const text = String(value || "").trim();
      if (text.length <= 18) return text;
      return `${text.slice(0, 12)}...${text.slice(-6)}`;
    }

    function hasAnyText(text, patterns = []) {
      return patterns.some((pattern) => pattern.test(text));
    }

    function autoSwitchStage({
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
      const livePendingReason = meaningfulText(codex.pending_switch_reason);
      const restoredPendingReason = meaningfulText(autoSwitch.pending_reason || autoSwitch.pendingReason);
      const pendingReason = livePendingReason || restoredPendingReason;
      const pendingRevalidation = !livePendingReason && Boolean(restoredPendingReason)
        && (autoSwitch.pending_revalidation ?? autoSwitch.pendingRevalidation ?? true) !== false;
      const stageKey = meaningfulText(autoSwitch.last_stage || autoSwitch.lastStage);
      const stageLabel = meaningfulText(autoSwitch.last_stage_label || autoSwitch.lastStageLabel);
      const failureStage = meaningfulText(autoSwitch.last_failure_stage || autoSwitch.lastFailureStage);
      const failureDetail = meaningfulText(autoSwitch.last_failure_detail || autoSwitch.lastFailureDetail);
      const failureCount = Number(autoSwitch.failure_count || autoSwitch.failureCount || 0);
      const backoffUntil = autoSwitch.failure_backoff_until || autoSwitch.failureBackoffUntil || "";
      const pauseUntil = autoSwitch.failure_pause_until || autoSwitch.failurePauseUntil || "";
      const pauseReason = meaningfulText(autoSwitch.failure_pause_reason || autoSwitch.failurePauseReason);
      const lastResult = meaningfulText(autoSwitch.last_result || autoSwitch.lastResult);
      const lastReason = meaningfulText(autoSwitch.last_reason || autoSwitch.lastReason);
      const backoffText = backoffUntil ? `退避至 ${formatTime(backoffUntil)}` : "";
      const pauseText = pauseUntil ? `自动暂停至 ${formatTime(pauseUntil)}` : "";
      const resultText = meaningfulText([lastReason, lastResult, failureDetail ? `失败详情：${failureDetail}` : "", pauseReason ? `暂停原因：${pauseReason}` : "", backoffText, pauseText].filter(Boolean).join("；"));
      const resultProbe = resultText.toLowerCase();
      const sourceLabel = helperReady ? codexStatusSourceLabel(codex) : "未连接";
      const taskEvent = meaningfulText(codex.last_task_event) || meaningfulText(codex.detail) || meaningfulText(codex.label);
      const evidence = helperReady
        ? `${codex.safe_to_switch ? "安全门已打开" : codex.safe_to_switch === false ? "安全门关闭" : "安全门确认中"} · ${sourceLabel}${taskEvent ? ` · ${taskEvent}` : ""}`
        : "Helper 未连接，暂无本机边界证据";
      const trigger = pendingReason || lastReason || "暂无触发";
      const lastSeen = autoSwitch.last_check || autoSwitch.cloud_last_sync || autoSwitch.last_switch || "";
      const base = {
        className: "warn",
        key: "monitoring",
        eyebrow: "自动切换阶段",
        title: "持续监控",
        summary: "Helper 会按阈值观察额度和任务状态，只有安全边界确认后才换号。",
        trigger,
        evidence,
        result: resultText || "暂无执行结果",
        stage: stageLabel || stageKey || "监控中",
        next: "保持 Helper 在线；触发后会先保护当前任务。",
        lastSeen,
      };

      if (!helperReady) {
        return {
          ...base,
          className: "bad",
          key: "offline",
          title: "等待 Helper 在线",
          summary: "本机 Helper 未连接，无法读取任务边界或执行自动切换。",
          trigger: "未连接",
          result: "本机状态不可用",
          next: "启动或安装最新版 Helper，再刷新状态。",
        };
      }
      if (outdated) {
        return {
          ...base,
          className: "warn",
          key: "upgrade_required",
          title: "等待 Helper 升级",
          summary: `当前 Helper 版本 ${version || "未上报"} 低于最低支持版本 ${minimumHelperVersion}。`,
          result: resultText || "版本不满足自动切换要求",
          next: "下载最新版 Helper 并重启本地助手。",
        };
      }
      if (!helperAuthorized) {
        return {
          ...base,
          className: "warn",
          key: "unauthorized",
          title: "等待设备授权",
          summary: userPresent ? "Helper 在线，但还不能接收当前云控制台下发的切换任务。" : "登录后才能把这台 Helper 授权给云控制台。",
          trigger: "未授权",
          result: resultText || "自动切换未绑定当前控制台",
          next: userPresent ? "点击“授权 Helper”，绑定当前设备。" : "先登录云账号，再授权 Helper。",
        };
      }
      if (autoSwitch.enabled === false) {
        return {
          ...base,
          className: "warn",
          key: "disabled",
          title: "自动切换未开启",
          summary: "设备已授权，但后台自动切换守护处于关闭状态。",
          result: resultText || "等待启用",
          next: "在智能切换设置中开启后台自动切换。",
        };
      }
      if (stageKey === "failure-paused" || pauseUntil) {
        return {
          ...base,
          className: "bad",
          key: "failure_paused",
          title: "自动切换已暂停",
          summary: `连续失败${failureCount ? ` ${failureCount} 次` : ""}后，Helper 暂停本机自动切换，避免重复消耗账号和刷屏。`,
          result: resultText || "等待处理失败原因",
          stage: stageLabel || "自动暂停",
          next: "处理候选账号、RT、设备授权或本机写入问题后，点击“恢复自动切换”。",
        };
      }
      if (stageKey === "failure-backoff" || backoffUntil) {
        return {
          ...base,
          className: "warn",
          key: "failure_backoff",
          title: "失败退避中",
          summary: "上一轮自动切换未完成，Helper 已暂停重复触发，避免循环刷屏和审计噪音。",
          result: resultText || "等待退避结束",
          stage: stageLabel || "失败退避",
          next: "等待退避结束；同时检查候选账号、RT 状态和额度刷新来源。",
        };
      }
      if (pendingRevalidation) {
        return {
          ...base,
          className: "warn",
          key: "pending_revalidation",
          title: "恢复待切计划",
          summary: "Helper 重启后保留了尚未处理的触发原因，当前正在重新核验额度与任务边界。",
          result: resultText || "等待重新核验",
          stage: stageLabel || "恢复待切计划",
          next: "核验完成前不会写入 auth 或重启 Codex；保持 Helper 在线即可。",
        };
      }
      if (pendingReason && codex.safe_to_switch === false) {
        return {
          ...base,
          className: "warn",
          key: "draining_active_turn",
          title: "保护当前任务",
          summary: "额度或账号状态已触发切换，但当前 Codex 轮次仍可能继续执行，暂不抢切。",
          result: resultText || "等待安全边界",
          next: "等待当前轮完成；安全门打开后再请求候选账号。",
        };
      }
      if (pendingReason && codex.safe_to_switch === true) {
        return {
          ...base,
          className: "ok",
          key: "boundary_confirming",
          title: "安全边界已确认",
          summary: "触发条件仍存在，当前任务边界已经安全，可以进入候选选择和写入阶段。",
          result: resultText || "准备执行切换",
          next: "Helper 将请求云端候选账号，随后写入 auth 并重启 Codex。",
        };
      }
      if (hasAnyText(resultProbe, [/正在安全切换|安全切换|boundary-confirmed/i])) {
        return {
          ...base,
          className: "warn",
          key: "switching",
          title: "正在执行切换",
          summary: "任务边界已经确认，Helper 正在请求候选、写入 auth 并恢复 Codex。",
          next: "等待切换任务完成；如果长时间停留，导出诊断查看写入或启动阶段。",
        };
      }
      if (hasAnyText(resultProbe, [/失败|failed|error|异常|401|403|500|missing/i])) {
        return {
          ...base,
          className: "bad",
          key: "failed",
          title: "自动切换失败",
          summary: "最近一次自动切换没有完成，需要查看候选 payload、auth 写入或 Codex 重启阶段。",
          next: "导出诊断并检查账号 RT、设备授权、auth 写入权限和本机 Codex 启动状态。",
        };
      }
      if (failureStage === "no-candidate" || hasAnyText(resultProbe, [/无可用候选|no-candidate|候选账号/i])) {
        return {
          ...base,
          className: "bad",
          key: "no_candidate",
          title: "没有可用候选",
          summary: "云端已收到触发，但候选账号被冷却、不可用或不满足策略。",
          next: "导入可用 RT 账号，或调整付费优先、避开当前账号和冷却策略。",
        };
      }
      if (hasAnyText(resultProbe, [/冷却|cooldown/i])) {
        return {
          ...base,
          className: "warn",
          key: "cooldown",
          title: "切换冷却中",
          summary: "已命中触发条件，但全局冷却正在保护账号池，避免连续抖动切换。",
          next: "等待冷却结束；必要时用手动切换处理紧急任务。",
        };
      }
      if (hasAnyText(resultProbe, [/未确认切换条件|未切换|not-triggered|not-switched/i])) {
        return {
          ...base,
          className: "warn",
          key: "held_by_cloud",
          title: "云端暂未放行",
          summary: "Helper 已上报触发信息，但云端策略没有确认本轮必须切换。",
          next: "继续观察额度和失败信号；如策略过严，可在设置中调整阈值。",
        };
      }
      if (hasAnyText(resultProbe, [/已自动切换|switched/i]) || autoSwitch.last_switch) {
        return {
          ...base,
          className: "ok",
          key: "switched",
          title: "最近已切换",
          summary: "最近一次自动切换已完成，当前账号池进入正常监控。",
          next: "继续观察用量；冷却期内不会重复选择刚切过的账号。",
        };
      }
      if (codex.safe_to_switch === false) {
        return {
          ...base,
          className: "warn",
          key: "tail_observing",
          title: "观察任务边界",
          summary: "当前没有明确切换触发，但 Codex 仍未稳定空闲，自动切换会保持观察。",
          next: "无需操作；触发出现后仍会先等待当前轮结束。",
        };
      }
      return {
        ...base,
        className: "ok",
        key: "healthy",
        title: "持续监控",
        result: resultText || "检查正常",
        next: "无需操作；当额度或授权信号触发时再进入保护流程。",
      };
    }

    function renderAutoSwitchStage(stage = {}) {
      const rows = [
        ["当前阶段", stage.stage || stage.title || "状态确认中"],
        ["触发", stage.trigger || "暂无触发"],
        ["边界证据", stage.evidence || "暂无证据"],
        ["最近结果", stage.result || "暂无执行结果"],
        ["最近检查", stage.lastSeen ? formatTime(stage.lastSeen) : "暂无记录"],
        ["下一步", stage.next || "继续观察"],
      ];
      return `
        <div class="auto-switch-stage-card ${escapeHtml(stage.className || "warn")}" data-auto-switch-stage="${escapeHtml(stage.key || "unknown")}">
          <div class="auto-switch-stage-head">
            <span>${escapeHtml(stage.eyebrow || "自动切换阶段")}</span>
            <strong>${escapeHtml(stage.title || "状态确认中")}</strong>
            <p>${escapeHtml(stage.summary || "正在根据 Helper 上报状态确认自动切换阶段。")}</p>
          </div>
          <div class="auto-switch-stage-grid">
            ${rows.map(([label, value]) => `
              <div class="auto-switch-stage-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
              </div>
            `).join("")}
          </div>
          ${stage.lastSeen ? `<small class="auto-switch-stage-time">最近检查 ${escapeHtml(formatTime(stage.lastSeen))}</small>` : ""}
        </div>
      `;
    }

    function renderHelperRelease({ helperReady = false, helper = {}, helperRelease = {}, minimumHelperVersion = "0.4.2" } = {}) {
      const latestVersion = helperRelease.version || minimumHelperVersion;
      const latestBuild = helperRelease.build_date || helperRelease.buildDate || "";
      const currentVersion = helperReady ? (helper.version || "旧版未上报") : "未连接";
      const currentUnsupported = helperReady && (!helper.version || compareVersion(helper.version, minimumHelperVersion) < 0);
      const updateAvailable = helperReady && helper.version && latestVersion && compareVersion(helper.version, latestVersion) < 0;
      const releaseKnown = Boolean(helperRelease.file || helperRelease.sha256 || helperRelease.version);
      const packageInfo = helperRelease.package || {};
      const packageUrl = helperPackageUrl(helperRelease);
      const packageSummary = packageInfo.sha256
        ? ` · portable ${escapeHtml(formatBytes(packageInfo.bytes || 0))} · ZIP ${escapeHtml(shortSha(packageInfo.sha256))}`
        : "";
      const cardClass = helperReady && !currentUnsupported && !updateAvailable ? "ok" : "warn";
      const statusText = !helperReady
        ? "未检测到本机 Helper，可先下载最新版。"
        : currentUnsupported
          ? `当前 ${currentVersion} 低于最低支持版本 v${minimumHelperVersion}，建议升级后重启 Helper。`
          : updateAvailable
            ? `当前 ${currentVersion} 可用，但已有 v${latestVersion} 发布，建议在空闲时升级。`
          : `当前 ${currentVersion} 可用；如需重新安装，可下载同版本发布包。`;
      return `
        <div class="helper-release-card ${escapeHtml(cardClass)}">
          <div class="helper-release-main">
            <span>Helper 分发</span>
            <strong>最新版 v${escapeHtml(latestVersion)}${latestBuild ? ` · ${escapeHtml(latestBuild)}` : ""}</strong>
            <small>${releaseKnown ? `EXE ${escapeHtml(formatBytes(helperRelease.bytes || 0))} · SHA-256 ${escapeHtml(shortSha(helperRelease.sha256))}${packageSummary}` : "发布包信息加载中。"}</small>
          </div>
          <div class="helper-release-current">
            <span>当前设备</span>
            <strong>${escapeHtml(statusText)}</strong>
          </div>
          <div class="helper-release-actions">
            <a class="button-link primary-link" href="${escapeHtml(helperDownloadUrl(helperRelease))}" download>下载最新版</a>
            ${packageUrl ? `<a class="button-link" href="${escapeHtml(packageUrl)}" download>下载 portable 包</a>` : ""}
            <button type="button" data-helper-action="check-update" ${helperReady ? "" : "disabled"}>本机检查更新</button>
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
      const failurePauseUntil = autoSwitch.failure_pause_until || autoSwitch.failurePauseUntil || "";
      const failurePauseReason = meaningfulText(autoSwitch.failure_pause_reason || autoSwitch.failurePauseReason);
      const livePendingReason = meaningfulText(codex.pending_switch_reason);
      const restoredPendingReason = meaningfulText(autoSwitch.pending_reason || autoSwitch.pendingReason);
      const pendingRevalidation = !livePendingReason && Boolean(restoredPendingReason)
        && (autoSwitch.pending_revalidation ?? autoSwitch.pendingRevalidation ?? true) !== false;
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
      if (failurePauseUntil) {
        return {
          className: "bad",
          title: "自动切换已暂停",
          reason: failurePauseReason || `连续失败后暂停至 ${formatTime(failurePauseUntil)}。`,
          action: "处理失败原因后点击“恢复自动切换”，或等待暂停到期自动重试。",
        };
      }
      if (pendingRevalidation) {
        return {
          className: "warn",
          title: "恢复待切计划",
          reason: restoredPendingReason,
          action: "Helper 正在重新核验额度和任务边界；核验前不会写入 auth。",
        };
      }
      const pendingSwitchReason = livePendingReason;
      if (pendingSwitchReason) {
        return {
          className: codex.safe_to_switch ? "ok" : "warn",
          title: codex.safe_to_switch ? "安全边界已确认" : "保护当前任务",
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
      const stage = autoSwitchStage({
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
      const pendingReason = meaningfulText(codex.pending_switch_reason)
        || meaningfulText(autoSwitch.pending_reason || autoSwitch.pendingReason)
        || "无";
      const switchSafety = codex.safe_to_switch ? "可安全切换" : "暂不切换";
      const failurePauseUntil = autoSwitch.failure_pause_until || autoSwitch.failurePauseUntil || "";
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
          ${failurePauseUntil ? `<button type="button" data-helper-action="resume-auto-switch" ${helperReady ? "" : "disabled"}>恢复自动切换</button>` : ""}
          <button type="button" data-helper-action="open-status" ${helperReady ? "" : "disabled"}>本机状态页</button>
          <button type="button" data-helper-action="export-diagnostics" ${helperReady ? "" : "disabled"}>导出诊断</button>
        </div>
        ${renderAutoSwitchStage(stage)}
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
      autoSwitchStage,
      renderAutoSwitchStage,
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
