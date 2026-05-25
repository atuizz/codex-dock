const assert = require("node:assert/strict");
const { createImportUi } = require("../import-ui.js");

const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);

const ui = createImportUi({
  escapeHtml: htmlEscape,
  shortId: (value) => value ? String(value).slice(0, 6) : "未识别",
  importStatusClass: (status) => status === "无法解析" ? "bad" : "ok",
  summarizeImportPreview(items) {
    const importable = items.filter((item) => item.ok).length;
    return {
      text: items.length ? `解析到 ${items.length} 个，可导入 ${importable} 个` : "还没有待导入账号",
      importable,
    };
  },
});

const resultHtml = ui.renderImportResult({
  added: 1,
  updated: 2,
  failed: 0,
  cloud: {
    added: 1,
    updated: 1,
    failed: 0,
    refreshed: 2,
    refreshFailed: 1,
  },
});
assert.match(resultHtml, /导入完成/);
assert.match(resultHtml, /新增 1 · 更新 2 · 失败 0/);
assert.match(resultHtml, /云端：新增 1 · 更新 1 · 失败 0 · 额度刷新 2\/3/);

const escapedResult = ui.renderImportResult({ preview: true, message: "<bad>" });
assert.match(escapedResult, /核查结果/);
assert.match(escapedResult, /&lt;bad&gt;/);

const preview = ui.renderImportPreview([
  {
    ok: true,
    status: "新增",
    email: "fresh@example.com",
    accountName: "Fresh",
    plan: "Plus",
    tokenLabel: "RT",
    hasRt: true,
    accountId: "acct-123456789",
    sourceName: "auth.json",
  },
  {
    ok: false,
    status: "无法解析",
    sourceName: "broken.json",
    accountName: "Broken",
    error: "<json error>",
  },
  {
    ok: true,
    status: "新增",
    email: "at@example.com",
    accountName: "AT Only",
    plan: "Free",
    tokenLabel: "不支持 Codex",
    hasRt: false,
    warning: "仅 AT：当前不能用于 Codex，请重新登录 Codex 获取 RT。",
    accountId: "acct-at-only",
    sourceName: "Session JSON",
  },
], {
  importCompleted: false,
  operationActive: false,
});

assert.equal(preview.summaryText, "解析到 3 个，可导入 2 个");
assert.equal(preview.confirmHidden, false);
assert.equal(preview.confirmDisabled, false);
assert.equal(preview.finishHidden, true);
assert.equal(preview.clearText, "清空预览");
assert.match(preview.listHtml, /fresh@example\.com/);
assert.match(preview.listHtml, /acct-1/);
assert.match(preview.listHtml, /有 RT/);
assert.match(preview.listHtml, /仅 AT · 不支持 Codex/);
assert.match(preview.listHtml, /当前不能用于 Codex/);
assert.match(preview.listHtml, /&lt;json error&gt;/);
assert.match(preview.listHtml, /import-status bad/);

const completed = ui.renderImportPreview([], {
  importCompleted: true,
  operationActive: false,
});
assert.equal(completed.confirmHidden, true);
assert.equal(completed.finishHidden, false);
assert.equal(completed.finishPrimary, true);
assert.equal(completed.clearText, "继续导入");
assert.match(completed.listHtml, /选择文件或粘贴 JSON/);

const busy = ui.renderImportPreview([{ ok: true, status: "新增" }], {
  operationActive: true,
});
assert.equal(busy.confirmDisabled, true);
assert.equal(ui.modeIsActive("oauth", "oauth"), true);
assert.equal(ui.modeIsActive("oauth", "file"), false);

console.log("import-ui verification passed");
