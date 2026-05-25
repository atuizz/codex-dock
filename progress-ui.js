(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexProgressUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  const runningStatuses = new Set(["处理中", "刷新中", "读取中", "拉取中"]);

  function createProgressUi(deps = {}) {
    const escapeHtml = deps.escapeHtml
      || root.CodexFormatCore?.escapeHtml
      || fallbackEscapeHtml;

    function progressStats(progress = {}) {
      const items = Array.isArray(progress.items) ? progress.items : [];
      const total = items.length;
      const completed = items.filter((item) => item.status === "已完成").length;
      const failed = items.filter((item) => item.status === "失败").length;
      const running = progress.done
        ? 0
        : items.filter((item) => runningStatuses.has(item.status)).length;
      const done = completed + failed;
      const percent = progress.done
        ? 100
        : total ? Math.min(96, Math.round(((done + running * 0.35) / total) * 100)) : 0;
      return {
        total,
        completed,
        failed,
        running,
        done,
        percent,
      };
    }

    function renderProgressList(items = []) {
      return items.map((item) => {
        const status = item.status || "等待";
        const className = status === "失败"
          ? "bad"
          : status === "已完成" ? "ok"
            : runningStatuses.has(status) ? "running" : "";
        return `
          <div class="progress-item ${className}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(status)}${item.detail ? ` · ${escapeHtml(item.detail)}` : ""}</span>
          </div>
        `;
      }).join("");
    }

    function renderOperationProgress(progress = {}) {
      const stats = progressStats(progress);
      return {
        title: progress.title || "正在处理",
        summary: progress.done
          ? (progress.summary || "处理完成。")
          : `${stats.done}/${stats.total} 已处理，失败 ${stats.failed}`,
        percent: stats.percent,
        closeDisabled: !progress.done,
        listHtml: renderProgressList(Array.isArray(progress.items) ? progress.items : []),
        stats,
      };
    }

    return Object.freeze({
      progressStats,
      renderProgressList,
      renderOperationProgress,
    });
  }

  return Object.freeze({
    createProgressUi,
  });
});
