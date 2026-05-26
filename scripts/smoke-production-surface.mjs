import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = (process.env.CODEX_DOCK_SMOKE_BASE_URL || "https://codex.woai.pro").replace(/\/+$/, "");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outputPath = outIndex >= 0 ? args[outIndex + 1] : "";

async function request(path) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url);
  const text = await response.text();
  return { url, response, text };
}

async function requestJson(path) {
  const result = await request(path);
  assert.equal(result.response.status, 200, `${path} should return 200`);
  return { ...result, data: JSON.parse(result.text) };
}

function versionedRefs(indexHtml) {
  return [...indexHtml.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?v=([^"]+))?)"/g)]
    .map((match) => ({ file: match[1].split("?")[0].replace(/^\/+/, ""), version: match[2] || "" }));
}

function assertPublicSurfaceHasNoSecretMaterial(label, text) {
  assert.doesNotMatch(text, /gho_[A-Za-z0-9_]+/i, `${label} should not expose GitHub tokens`);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9_-]{16,}/i, `${label} should not expose API keys`);
  assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9._-]{12,}/i, `${label} should not expose bearer tokens`);
  assert.doesNotMatch(text, /refresh_token"\s*:\s*"[^"]+"/i, `${label} should not expose refresh token values`);
  assert.doesNotMatch(text, /access_token"\s*:\s*"[^"]+"/i, `${label} should not expose access token values`);
}

const index = await request("/");
assert.equal(index.response.status, 200, "production index should load");
assert.match(index.text, /<title>Codex Dock<\/title>/);
assert.match(index.text, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
assert.match(index.text, /id="manualSwitchRiskModal"[\s\S]*aria-modal="true"/);
assert.match(index.text, /data-import-mode="oauth"[\s\S]*登录导入 RT 账号/);
assert.match(index.text, /id="devicePanel"/);
assert.match(index.text, /id="adminSummary"/);
assertPublicSurfaceHasNoSecretMaterial("index", index.text);

const manifest = await requestJson("/asset-manifest.json");
assert.match(manifest.data.version || "", /^[a-f0-9]{12}$/i, "asset manifest should contain content version");
assert.equal(manifest.data.helper?.version, "0.4.6", "production manifest should expose current Helper version");
assert.match(manifest.data.helper?.sha256 || "", /^[A-F0-9]{64}$/i, "production manifest should expose Helper SHA-256");
assert.ok(manifest.data.helper?.package?.file?.includes("0.4.6"), "production manifest should expose current portable package");
assertPublicSurfaceHasNoSecretMaterial("asset manifest", manifest.text);

const refs = versionedRefs(index.text);
const assetFiles = new Set((manifest.data.assets || []).map((asset) => asset.file));
const relevantRefs = refs.filter((ref) => assetFiles.has(ref.file) && ref.file !== "index.html");
assert.ok(relevantRefs.length >= 16, "index should reference all split frontend modules");
assert.deepEqual(new Set(relevantRefs.map((ref) => ref.version)), new Set([manifest.data.version]), "all frontend assets should share manifest version");

const requiredAssets = {
  "app.js": [
    /manualSwitchRiskModal/,
    /maybeRunPendingManualSwitchAfterBoundary/,
    /refreshStaleUsageInBackground/,
    /usageRefreshMode === "manual"/,
  ],
  "styles.css": [
    /@media \(max-width: 1180px\)/,
    /@media \(max-width: 860px\)/,
    /@media \(max-width: 460px\)/,
    /overflow-x:\s*hidden/,
    /\.drawer-panel/,
  ],
  "shell-ui.js": [
    /renderHealthCenter/,
    /账号健康/,
  ],
  "panels-ui.js": [
    /helperDiagnostic/,
    /autoSwitchStage/,
    /下载 portable 包/,
  ],
  "settings-ui.js": [
    /usageRefreshMode/,
    /本机 Helper（推荐）/,
    /仅手动刷新/,
  ],
  "dialog-ui.js": [
    /renderManualSwitchRisk/,
    /任务仍在运行/,
  ],
  "admin-ui.js": [
    /Helper 版本分布/,
    /失败趋势/,
    /需重连 Helper/,
  ],
  "oauth-core.js": [
    /oauth_provider_error/,
    /oauth_state_mismatch/,
    /重新打开授权页面/,
  ],
};

const fetchedAssets = [];
for (const [file, checks] of Object.entries(requiredAssets)) {
  const ref = relevantRefs.find((item) => item.file === file);
  assert.ok(ref, `${file} should be referenced by index`);
  const asset = await request(`/${file}?v=${manifest.data.version}`);
  assert.equal(asset.response.status, 200, `${file} should load with manifest version`);
  for (const check of checks) assert.match(asset.text, check, `${file} should include ${check}`);
  assertPublicSurfaceHasNoSecretMaterial(file, asset.text);
  fetchedAssets.push({ file, bytes: Number(asset.response.headers.get("content-length") || asset.text.length) });
}

const report = {
  ok: true,
  baseUrl,
  checked_at: new Date().toISOString(),
  asset_version: manifest.data.version,
  helper_version: manifest.data.helper?.version || "",
  helper_sha256: manifest.data.helper?.sha256 || "",
  referenced_assets: relevantRefs.length,
  fetched_assets: fetchedAssets,
};

if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
