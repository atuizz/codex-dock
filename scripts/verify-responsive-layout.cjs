const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const styles = readFileSync(join(root, "styles.css"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");

function expectRule(selectorPattern, bodyPattern, label) {
  const selector = selectorPattern instanceof RegExp
    ? selectorPattern.source
    : selectorPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${selector}\\s*\\{[\\s\\S]*?${bodyPattern.source}[\\s\\S]*?\\}`, "m");
  assert.match(styles, pattern, label);
}

function expectMedia(maxWidth, selectorPattern, bodyPattern, label) {
  const selector = selectorPattern instanceof RegExp
    ? selectorPattern.source
    : selectorPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{[\\s\\S]*?${selector}\\s*\\{[\\s\\S]*?${bodyPattern.source}[\\s\\S]*?\\}`, "m");
  assert.match(styles, pattern, label);
}

assert.match(styles, /--safe-vh:\s*100dvh/);
assert.match(styles, /--focus-ring:/);
assert.match(styles, /@media \(max-width: 1180px\)/);
assert.match(styles, /@media \(max-width: 860px\)/);
assert.match(styles, /@media \(max-width: 460px\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

expectRule("body", /overflow-x:\s*hidden/, "page should not create horizontal overflow");
expectRule(".content", /overflow-x:\s*clip/, "main content should clip accidental overflow");
expectRule("button:disabled", /cursor:\s*not-allowed/, "disabled controls need explicit affordance");
expectRule(/button:focus-visible,\s*a:focus-visible,\s*input:focus-visible,\s*textarea:focus-visible,\s*select:focus-visible/, /box-shadow:\s*var\(--focus-ring\)/, "keyboard focus ring should be shared");
expectRule(".shell", /grid-template-columns:\s*260px minmax\(0, 1fr\)/, "desktop shell keeps bounded sidebar");
expectRule(".health-chip-row", /grid-template-columns:\s*repeat\(auto-fit, minmax\(118px, 1fr\)\)/, "health chips should scan on desktop");
expectRule(".helper-release-card", /grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(0, 1fr\) auto/, "Helper release card should keep desktop action column");
expectRule(".auto-switch-stage-grid", /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/, "auto-switch stage should use four desktop columns");
expectRule(".drawer-panel", /max-height:\s*calc\(var\(--safe-vh\) - 48px\)/, "drawer should be viewport bounded");

expectMedia(1180, ".shell", /grid-template-columns:\s*220px minmax\(0, 1fr\)/, "tablet shell should narrow sidebar");
expectMedia(860, ".shell", /grid-template-columns:\s*56px minmax\(0, 1fr\)/, "small viewport shell should collapse navigation");
assert.match(styles, /@media \(max-width: 860px\) \{[\s\S]*?\.toolbar-controls,\s*\.primary-actions\s*\{[\s\S]*?overflow-x:\s*auto/, "small viewport toolbar should scroll internally");
expectMedia(860, ".health-chip-row", /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "tablet health chips should form two columns");
expectMedia(860, ".helper-release-card", /grid-template-columns:\s*minmax\(0, 1fr\)/, "Helper release card should collapse before mobile");
expectMedia(860, ".auto-switch-stage-grid", /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "auto-switch stage should collapse to two columns");
expectMedia(860, ".admin-table thead", /display:\s*none/, "admin tables should become card-like on small screens");
expectMedia(460, ".primary-actions", /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "phone primary actions should avoid squeezed inline buttons");
expectMedia(460, ".health-chip-row", /grid-template-columns:\s*1fr/, "phone health chips should become single column");
expectMedia(460, ".auto-switch-stage-grid", /grid-template-columns:\s*1fr/, "phone auto-switch stage should become single column");
expectMedia(460, ".drawer-panel", /top:\s*auto[\s\S]*width:\s*100%[\s\S]*border-radius:\s*18px 18px 0 0/, "phone import drawer should become a bottom sheet");

assert.match(indexHtml, /<aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">/);
assert.match(indexHtml, /id="manualSwitchRiskModal"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
assert.doesNotMatch(styles, /min-width:\s*(?:9\d{2,}|1\d{3,})px/);

console.log("responsive layout verification passed");
