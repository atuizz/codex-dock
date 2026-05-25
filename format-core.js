(function (root) {
  function numeric(value) {
    if (value === null || value === undefined || value === "") return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function canonicalPlan(value) {
    const plan = String(value || "").trim().toLowerCase();
    if (plan === "chatgptplus") return "plus";
    if (["plus", "pro", "team", "enterprise", "free"].includes(plan)) return plan;
    return plan;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char]);
  }

  function shortId(value) {
    if (!value) return "未识别";
    return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function formatTime(value) {
    if (!value) return "无记录";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function formatRefreshTime(value) {
    if (!value) return "未刷新";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatResetTime(value) {
    if (!value) return "重置未知";
    const number = numeric(value);
    const date = Number.isFinite(number) && number > 1000000000 ? new Date(number * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return "重置未知";
    return `重置 ${date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }

  function planLabel(plan) {
    const value = String(plan || "未知").toLowerCase();
    if (value === "plus") return "Plus";
    if (value === "pro") return "Pro";
    if (value === "team") return "Team";
    if (value === "enterprise") return "Enterprise";
    if (value === "free") return "Free";
    return plan || "未知";
  }

  function planClass(plan) {
    const value = canonicalPlan(plan);
    return value ? `plan-${value}` : "plan-unknown";
  }

  function formatTokenTime(date) {
    if (!date || Number.isNaN(date.getTime())) return "未知";
    return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatBytes(value) {
    const size = Number(value) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function errorSeverity(label) {
    const text = String(label || "").toLowerCase();
    if (!text) return "neutral";
    if (
      text.includes("封") ||
      text.includes("停用") ||
      text.includes("账号已被禁用") ||
      text.includes("账号不可用") ||
      text.includes("banned") ||
      text.includes("suspended") ||
      text.includes("deactivated") ||
      text.includes("disabled account")
    ) {
      return "bad";
    }
    return "warn";
  }

  const api = Object.freeze({
    escapeHtml,
    shortId,
    formatTime,
    formatRefreshTime,
    formatResetTime,
    planLabel,
    planClass,
    formatTokenTime,
    formatBytes,
    errorSeverity,
  });

  root.CodexFormatCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
