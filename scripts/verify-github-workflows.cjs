const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const deploy = fs.readFileSync(path.join(root, ".github", "workflows", "cloudflare-deploy.yml"), "utf8");

assert.match(ci, /runs-on:\s*windows-latest/);
assert.match(ci, /npm ci/);
assert.match(ci, /npm run preflight/);
assert.match(ci, /actions\/upload-artifact@v4/);
assert.match(ci, /artifacts\/build\/CodexDockHelper\//);

assert.match(deploy, /verify:\s*\n\s*name:\s*Verify release candidate/);
assert.match(deploy, /runs-on:\s*windows-latest/);
assert.match(deploy, /npm run preflight/);
assert.match(deploy, /deploy:\s*\n\s*name:\s*Cloudflare/);
assert.match(deploy, /needs:\s*verify/);
assert.match(deploy, /wrangler deploy --dry-run/);
assert.match(deploy, /wrangler d1 migrations apply codex-cloud-console --remote/);
assert.match(deploy, /wrangler deploy/);
assert.match(deploy, /npm run smoke:production/);
assert.match(deploy, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);

console.log("github workflow verification passed");
