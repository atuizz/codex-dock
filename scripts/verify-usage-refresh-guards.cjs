const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");
const workerSource = fs.readFileSync(path.join(repoRoot, "cloud-worker", "worker-accounts.js"), "utf8");
const workerUsageSource = fs.readFileSync(path.join(repoRoot, "cloud-worker", "worker-usage.js"), "utf8");

assert.match(appSource, /usageFreshWindowMs\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
assert.match(appSource, /function usageFresh\(/);
assert.match(appSource, /function accountUsageNeedsRefresh\(/);
assert.match(appSource, /function usageRefreshSchedulerState\(/);
assert.match(appSource, /function refreshStaleUsageInBackground\(/);
assert.match(appSource, /usageRefreshMode === "manual"/);
assert.match(appSource, /window\.setInterval\(refreshStaleUsageInBackground,\s*backgroundUsageRefreshIntervalMs\)/);
assert.match(appSource, /refreshAccountUsage\(accounts\[index\]\.id,\s*\{\s*silent:\s*true,\s*batch:\s*true,\s*background:\s*true\s*\}\)/);
assert.match(appSource, /background:\s*Boolean\(options\.background\)/);
assert.match(appSource, /audit:\s*!options\.batch && !options\.background/);

assert.match(workerSource, /USAGE_STALE_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
assert.match(workerSource, /export function usageFresh\(/);
assert.match(workerSource, /freshUsage && settings\.avoidLow5h/);
assert.match(workerSource, /reasons\.push\("额度待刷新"\)/);
assert.match(workerSource, /us\.created_at AS usage_created_at/);
assert.match(workerSource, /body\.background \? "background" : body\.batch \? "batch" : "manual"/);
assert.match(workerUsageSource, /body\.background \? "background" : body\.batch \? "batch" : "manual"/);

console.log("usage-refresh guard verification passed");
