const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const appJs = readFileSync(join(root, "app.js"), "utf8");

assert.match(indexHtml, /class="import-source-card primary-source active"[^>]+data-import-mode="oauth"/);
assert.match(indexHtml, /登录导入 RT 账号/);
assert.match(indexHtml, /推荐路径。Agent 在线时自动接收回调、换取 RT 并导入/);
assert.match(indexHtml, /<details class="advanced-import-panel">/);
assert.match(indexHtml, /Session JSON（仅登记）/);
assert.match(indexHtml, /不能用于 Codex 切换/);
assert.match(indexHtml, /当前设备账号/);
assert.match(indexHtml, /不用于修复其它账号/);
assert.match(indexHtml, /批量上传文件/);
assert.doesNotMatch(indexHtml, /Session JSON（仅 AT）<\/strong>/);

assert.match(appJs, /importMode: "oauth"/);
assert.match(appJs, /setImportMode\(options\.mode \|\| "oauth"\)/);
assert.match(appJs, /advancedPanel\.open = mode !== "oauth"/);
assert.match(appJs, /setDrawer\(true, \{ mode: "file" \}\)/);

console.log("import-drawer verification passed");
