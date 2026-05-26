const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const app = readFileSync("app.js", "utf8");
const html = readFileSync("index.html", "utf8");
const styles = readFileSync("styles.css", "utf8");
const dialog = readFileSync("dialog-ui.js", "utf8");

assert.match(app, /pendingManualSwitch:\s*null/);
assert.match(app, /function manualSwitchNeedsTaskConfirmation/);
assert.match(app, /safe_to_switch\s*===\s*false/);
assert.match(app, /openManualSwitchRisk\(account,\s*switchOptions\)/);
assert.match(app, /waitForManualSwitchBoundary/);
assert.match(app, /maybeRunPendingManualSwitchAfterBoundary/);
assert.match(app, /waitedForBoundary:\s*true/);
assert.match(app, /manualForce:\s*true/);
assert.match(app, /result:\s*switchOptions\.manualForce[\s\S]*manual-forced/);
assert.match(app, /safeToSwitch:\s*\(state\.codexStatus \|\| {}\)\.safe_to_switch/);
assert.match(app, /manualSwitchWaitBtn/);
assert.match(app, /manualSwitchForceBtn/);

assert.match(html, /id="manualSwitchRiskModal"/);
assert.match(html, /当前任务还不能安全切换/);
assert.match(html, /等待安全边界后切换/);
assert.match(html, /仍然立即切换/);

assert.match(styles, /\.switch-risk-dialog/);
assert.match(styles, /\.switch-risk-actions/);
assert.match(styles, /\.switch-risk-row/);

assert.match(dialog, /renderManualSwitchRisk/);
assert.match(dialog, /当前任务仍在运行，立即切换可能中断本轮并浪费剩余额度/);
assert.match(dialog, /强制切换会记录为用户动作/);

console.log("manual switch guard verification passed");
