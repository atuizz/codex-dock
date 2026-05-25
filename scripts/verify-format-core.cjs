const assert = require("node:assert/strict");
const {
  escapeHtml,
  shortId,
  formatResetTime,
  planLabel,
  planClass,
  formatTokenTime,
  formatBytes,
  errorSeverity,
} = require("../format-core.js");

assert.equal(escapeHtml(`<script>"&'</script>`), "&lt;script&gt;&quot;&amp;&#039;&lt;/script&gt;");
assert.equal(shortId("1234567890abcdef123456"), "12345678...123456");
assert.equal(shortId(""), "未识别");

assert.equal(planLabel("chatgptplus"), "chatgptplus");
assert.equal(planLabel("plus"), "Plus");
assert.equal(planLabel("enterprise"), "Enterprise");
assert.equal(planLabel(""), "未知");
assert.equal(planClass("chatgptplus"), "plan-plus");
assert.equal(planClass(""), "plan-unknown");

assert.equal(formatTokenTime(new Date("invalid")), "未知");
assert.equal(formatResetTime("not-a-date"), "重置未知");
assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(2048), "2 KB");
assert.equal(formatBytes(1024 * 1024 * 2.5), "2.5 MB");

assert.equal(errorSeverity("账号不可用，请检查是否被停用"), "bad");
assert.equal(errorSeverity("rate limit"), "warn");
assert.equal(errorSeverity(""), "neutral");

console.log("format-core verification passed");
