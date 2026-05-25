(function (root) {
  function auditTitle(item) {
    const action = String(item?.action || "").toLowerCase();
    const result = String(item?.result || "");
    const normalizedResult = result.toLowerCase();
    if (action.includes("auto-switch")) {
      if (normalizedResult === "switched") return "自动切换成功";
      if (normalizedResult === "payload-issued") return "已下发候选账号";
      if (normalizedResult === "no-candidate") return "自动切换无候选";
      if (normalizedResult === "deferred-active-task") return "自动切换等待空闲";
      if (normalizedResult.startsWith("trigger:")) return "自动切换已触发";
      if (/fail|失败|error/.test(normalizedResult)) return "自动切换失败";
      return "自动切换检查";
    }
    if (action.includes("switch")) return /fail|失败|error/i.test(result) ? "切换失败" : "账号已切换";
    if (action.includes("import") || /added|updated|failed/i.test(result)) return "账号已更新";
    if (action.includes("usage")) return "额度已刷新";
    return item?.accountName || "操作已记录";
  }

  function auditDescription(item) {
    const result = String(item?.result || "");
    const metadata = item?.metadata || {};
    const trigger = auditTriggerText(item, metadata);
    if (metadata.reason && metadata.target) return `${metadata.reason} -> ${metadata.target}`;
    if (metadata.reason && metadata.detail) return `${metadata.reason} · ${metadata.detail}`;
    if (metadata.summary) return [trigger ? `触发：${trigger}` : "", metadata.summary].filter(Boolean).join(" · ");
    if (Array.isArray(metadata.candidates) && metadata.candidates.length) {
      const candidateText = formatCandidateDiagnostics(metadata.candidates);
      return [trigger ? `触发：${trigger}` : "", candidateText].filter(Boolean).join(" · ");
    }
    if (trigger) return `触发：${trigger}`;
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
  });

  root.CodexAuditCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
