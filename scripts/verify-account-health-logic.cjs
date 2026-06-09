const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");

assert.match(app, /function usageAccessAuthExpiredText\(text\)/);
assert.match(app, /额度刷新授权过期，可切换/);
assert.match(app, /return !quotaAuthFailureCanStillSwitch\(account\)/);
assert.match(app, /function quotaAuthFailureCanStillSwitch\(account\)/);
assert.match(app, /function hardAccountFailureText\(value\)/);
assert.match(app, /if \(refreshTokenInvalidText\(text\)\) return true/);
assert.match(app, /if \(usageAuthFailure\(account\)\) return true/);
assert.doesNotMatch(app, /if \(usageIssue\(account\)\) return true/);
assert.doesNotMatch(app, /const currentEmail = currentEmailValue\(current\);[\s\S]*currentEmailValue\(account\) === currentEmail/);
assert.match(app, /const currentFingerprint = state\.localAuthFingerprint \|\| accountFingerprint\(current\);[\s\S]*if \(state\.currentAuthKey\)/);

console.log("account-health logic verification passed");
