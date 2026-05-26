const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts", "check-github-release-readiness.mjs"), "utf8");
const dispatchScript = fs.readFileSync(path.join(root, "scripts", "run-github-ci.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDoc = fs.readFileSync(path.join(root, "docs", "release-and-verification.md"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

assert.equal(
  packageJson.scripts["release:github-readiness"],
  "node ./scripts/check-github-release-readiness.mjs --out artifacts/verification/github-release-readiness-result.json",
);
assert.equal(
  packageJson.scripts["release:github-ci"],
  "node ./scripts/run-github-ci.mjs --out artifacts/verification/github-ci-dispatch-result.json",
);

assert.match(script, /CLOUDFLARE_API_TOKEN/);
assert.match(script, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(script, /CHECKOUT_TOKEN/);
assert.match(script, /current-sha-push-ci-green/);
assert.match(script, /workflow_dispatch/);
assert.match(script, /check-suites/);
assert.doesNotMatch(script, /gh auth token|process\.env\.CLOUDFLARE_API_TOKEN/);

assert.match(dispatchScript, /gh", \["workflow", "run"/);
assert.match(dispatchScript, /workflow_dispatch/);
assert.match(dispatchScript, /headSha === sha/);
assert.match(dispatchScript, /conclusion === "success"/);
assert.doesNotMatch(dispatchScript, /gh auth token|process\.env\.CLOUDFLARE_API_TOKEN/);

assert.match(releaseDoc, /release:github-readiness/);
assert.match(releaseDoc, /release:github-ci/);
assert.match(releaseDoc, /push-triggered CI/);
assert.match(readme, /release:github-readiness/);
assert.match(readme, /release:github-ci/);

console.log("github readiness script verification passed");
