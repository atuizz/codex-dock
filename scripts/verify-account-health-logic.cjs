const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");

assert.match(app, /function usageAccessAuthExpiredText\(text\)/);
assert.match(app, /额度刷新授权过期，可切换/);
assert.match(app, /hasUsableRefreshToken\(account\) && usageAccessAuthExpiredText\(text\)\) return false/);
assert.match(app, /if \(refreshTokenInvalidText\(text\)\) return true/);
assert.match(app, /if \(usageAuthFailure\(account\)\) return true/);
assert.doesNotMatch(app, /if \(usageIssue\(account\)\) return true/);

console.log("account-health logic verification passed");
