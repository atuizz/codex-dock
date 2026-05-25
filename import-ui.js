(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexImportUi = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const fallbackEscapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

  function createImportUi(deps = {}) {
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const escapeHtml = deps.escapeHtml || formatCore.escapeHtml || fallbackEscapeHtml;
    const shortId = deps.shortId || formatCore.shortId || ((value) => String(value || "").slice(0, 8) || "未识别");
    const importStatusClass = deps.importStatusClass || ((status) => status === "无法解析" ? "bad" : "ok");
    const summarizeImportPreview = deps.summarizeImportPreview || ((items = []) => ({
      text: items.length ? `解析到 ${items.length} 个` : "还没有待导入账号",
      importable: items.some((item) => item.ok),
    }));

    function renderImportResult(result = {}) {
      const title = result.preview ? "核查结果" : "导入完成";
      const refreshTotal = result.cloud ? (result.cloud.refreshed || 0) + (result.cloud.refreshFailed || 0) : 0;
      const cloudText = result.cloud
        ? `<span>云端：新增 ${result.cloud.added || 0} · 更新 ${result.cloud.updated || 0} · 失败 ${result.cloud.failed || 0}${refreshTotal ? ` · 额度刷新 ${result.cloud.refreshed || 0}/${refreshTotal}` : ""}</span>`
        : "";
      return `
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(result.message || `新增 ${result.added || 0} · 更新 ${result.updated || 0} · 失败 ${result.failed || 0}`)}</span>
        ${cloudText}
      `;
    }

    function renderImportPreviewItem(item = {}) {
      const title = item.email || item.accountName || "未知账号";
      const subtitle = item.accountName || item.accountId || item.error || "";
      const meta = item.ok ? `
        <div class="import-preview-meta">
          <span>${escapeHtml(item.plan || "未知")}</span>
          <span>${escapeHtml(item.tokenLabel || "无 token")}</span>
          <span>${item.hasRt ? "有 RT" : "仅 AT · 不支持 Codex"}</span>
          <span>${escapeHtml(shortId(item.accountId || ""))}</span>
          <span>${escapeHtml(item.sourceName || "导入内容")}</span>
        </div>
      ` : `
        <div class="import-preview-meta">
          <span>${escapeHtml(item.sourceName || "导入内容")}</span>
          <span>${escapeHtml(item.error || "解析失败")}</span>
        </div>
      `;
      return `
        <div class="import-preview-item ${item.ok ? (item.hasRt === false ? "warn" : "") : "bad"}">
          <div class="import-preview-main">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(subtitle)}</span>
          </div>
          ${meta}
          <span class="import-status ${importStatusClass(item.status)}">${escapeHtml(item.status)}</span>
          ${item.warning ? `<span class="import-warning">${escapeHtml(item.warning)}</span>` : ""}
          ${item.error ? `<span class="import-error">${escapeHtml(item.error)}</span>` : ""}
        </div>
      `;
    }

    function renderImportPreview(items = [], context = {}) {
      const summary = summarizeImportPreview(items);
      const importCompleted = Boolean(context.importCompleted);
      const operationActive = Boolean(context.operationActive);
      return {
        summaryText: summary.text,
        confirmHidden: importCompleted,
        confirmDisabled: !summary.importable || operationActive,
        finishHidden: !importCompleted,
        finishPrimary: importCompleted,
        clearText: importCompleted ? "继续导入" : "清空预览",
        clearSoft: !importCompleted,
        listHtml: items.length
          ? items.map(renderImportPreviewItem).join("")
          : '<div class="empty small">选择文件或粘贴 JSON 后，先在这里预览解析结果。</div>',
      };
    }

    function modeIsActive(mode, expected) {
      return mode === expected;
    }

    return Object.freeze({
      renderImportResult,
      renderImportPreviewItem,
      renderImportPreview,
      modeIsActive,
    });
  }

  return Object.freeze({
    createImportUi,
  });
});
