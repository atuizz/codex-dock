(function (root) {
  function auditTitle(item) {
    const action = String(item?.action || "").toLowerCase();
    const result = String(item?.result || "");
    const normalizedResult = result.toLowerCase();
    const metadata = item?.metadata || {};
    if (action.includes("auto-switch")) {
      if (action.includes("auto-switch-check") && normalizedResult === "error") return "额度检查异常";
      if (metadata.manualForce || normalizedResult === "manual-forced") return "用户强制切换";
      if (normalizedResult === "switched") return "自动切换成功";
      if (normalizedResult === "payload-issued") return "已下发候选账号";
      if (normalizedResult === "no-candidate") return "自动切换无候选";
      if (normalizedResult === "deferred-active-task" || normalizedResult === "deferred-active-turn") return "正在保护当前任务";
      if (normalizedResult === "boundary-confirmed") return "安全边界已确认";
      if (normalizedResult.startsWith("trigger:")) return "自动切换已触发";
      if (/fail|失败|error/.test(normalizedResult)) return "自动切换失败";
      return "自动切换检查";
    }
    if (action === "usage-refresh-batch") return /fail|失败|error|failed:[1-9]/i.test(result) ? "批量额度刷新有失败" : "批量额度刷新完成";
    if (action === "usage-refresh") return /fail|失败|error/i.test(result) ? "额度刷新失败" : "额度已刷新";
    if (action === "usage-refresh-settings") return "额度刷新方式已更新";
    if (metadata.manualForce || normalizedResult === "manual-forced") return "用户强制切换";
    if (metadata.waitedForBoundary || normalizedResult === "manual-waited-boundary") return "安全边界后切换";
    if (action.includes("switch")) return /fail|失败|error/i.test(result) ? "切换失败" : "账号已切换";
    if (action.includes("import") || /added|updated|failed/i.test(result)) return "账号已更新";
    if (action.includes("usage")) return "额度已刷新";
    return item?.accountName || "操作已记录";
  }

  function auditDescription(item) {
    const result = String(item?.result || "");
    const metadata = item?.metadata || {};
    const trigger = auditTriggerText(item, metadata);
    if (item?.action === "auto-switch-check" && result.toLowerCase() === "error" && metadata.error) return metadata.error;
    if (metadata.manualForce) {
      return [trigger ? `触发：${trigger}` : "", "用户确认后立即切换", metadata.pendingSwitchReason || ""].filter(Boolean).join(" · ");
    }
    if (metadata.waitedForBoundary) {
      return [trigger ? `触发：${trigger}` : "", "等待安全边界后切换", metadata.lastTaskEvent || metadata.runtimeState || ""].filter(Boolean).join(" · ");
    }
    if (metadata.reason && metadata.target) return `${metadata.reason} -> ${metadata.target}`;
    if (metadata.reason && metadata.detail) return `${metadata.reason} · ${metadata.detail}`;
    if (metadata.summary) return [trigger ? `触发：${trigger}` : "", metadata.summary].filter(Boolean).join(" · ");
    if (Array.isArray(metadata.candidates) && metadata.candidates.length) {
      const candidateText = formatCandidateDiagnostics(metadata.candidates);
      return [trigger ? `触发：${trigger}` : "", candidateText].filter(Boolean).join(" · ");
    }
    if (trigger) return `触发：${trigger}`;
    if (item?.action === "usage-refresh") {
      const sources = {
        helper: "本机 Agent",
        "cloud-worker": "云端 Worker",
        "auto-helper": "自动选择 / 本机 Agent",
        "auto-cloud-fallback": "自动选择 / 云端回退",
      };
      const source = sources[metadata.source] || metadata.source || "";
      return [source ? `执行通道：${source}` : "", metadata.error || ""].filter(Boolean).join(" · ") || result || "已完成";
    }
    if (item?.action === "usage-refresh-batch") {
      const matchBatch = result.match(/ok:(\d+),failed:(\d+)/i);
      return matchBatch ? `成功 ${matchBatch[1]}，失败 ${matchBatch[2]}` : (result || "已完成");
    }
    if (item?.action === "usage-refresh-settings") return `执行通道：${usageRefreshModeLabel(result || "helper")}`;
    if (metadata.trigger && metadata.reason) return `${metadata.trigger} · ${metadata.reason}`;
    const match = result.match(/added:(\d+),updated:(\d+),failed:(\d+)/i);
    if (match) {
      const [, added, updated, failed] = match;
      return `新增 ${added}，更新 ${updated}，失败 ${failed}`;
    }
    if (item?.accountName) return item.accountName;
    return result || "已完成";
  }

  function auditTriggerText(item, metadata = item?.metadata || {}) {
    if (metadata?.trigger) return String(metadata.trigger);
    const result = String(item?.result || "");
    const match = result.match(/^trigger:(.+)$/i);
    if (match) return match[1].trim();
    return "";
  }

  function usageRefreshModeLabel(mode) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized === "cloud") return "云端 Worker";
    if (normalized === "auto") return "自动选择";
    if (normalized === "manual") return "仅手动刷新";
    return "本机 Agent";
  }

  function formatCandidateDiagnostics(candidates) {
    const counts = new Map();
    for (const candidate of candidates || []) {
      const reason = candidate.blocked || (candidate.eligible ? "可用" : "未知原因");
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    const summary = [...counts.entries()].map(([reason, count]) => `${reason} ${count}`).join("；");
    const examples = (candidates || []).slice(0, 3).map((candidate) => {
      const label = candidate.email || candidate.name || candidate.id || "候选账号";
      const reason = candidate.blocked || (candidate.eligible ? "可用" : "未知原因");
      const fiveHour = Number(candidate.fiveHour);
      const oneWeek = Number(candidate.oneWeek);
      const usage = [
        Number.isFinite(fiveHour) ? `5H ${fiveHour}%` : "",
        Number.isFinite(oneWeek) ? `7D ${oneWeek}%` : "",
      ].filter(Boolean).join(" / ");
      return `${label}：${[reason, usage].filter(Boolean).join("，")}`;
    }).join("；");
    return [summary, examples ? `样例：${examples}` : ""].filter(Boolean).join(" · ");
  }

  const api = Object.freeze({
    auditTitle,
    auditDescription,
    auditTriggerText,
    formatCandidateDiagnostics,
    usageRefreshModeLabel,
  });

  root.CodexAuditCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
