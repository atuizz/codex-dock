const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts", "check-github-release-readiness.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDoc = fs.readFileSync(path.join(root, "docs", "release-and-verification.md"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

assert.equal(
  packageJson.scripts["release:github-readiness"],
  "node ./scripts/check-github-release-readiness.mjs --out artifacts/verification/github-release-readiness-result.json",
);

assert.match(script, /CLOUDFLARE_API_TOKEN/);
assert.match(script, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(script, /CHECKOUT_TOKEN/);
assert.match(script, /current-sha-push-ci-green/);
assert.match(script, /workflow_dispatch/);
assert.match(script, /check-suites/);
assert.doesNotMatch(script, /gh auth token|process\.env\.CLOUDFLARE_API_TOKEN/);

assert.match(releaseDoc, /release:github-readiness/);
assert.match(releaseDoc, /push-triggered CI/);
assert.match(readme, /release:github-readiness/);

console.log("github readiness script verification passed");
