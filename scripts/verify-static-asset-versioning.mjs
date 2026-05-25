import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const publicDir = join(repoRoot, "cloud-worker", "public");

const sourceAssets = [
  "index.html",
  "account-core.js",
  "platform-clients.js",
  "format-core.js",
  "progress-ui.js",
  "shell-ui.js",
  "dialog-ui.js",
  "settings-ui.js",
  "account-list-ui.js",
  "account-detail-ui.js",
  "audit-core.js",
  "admin-ui.js",
  "panels-ui.js",
  "import-core.js",
  "import-ui.js",
  "oauth-core.js",
  "app.js",
  "styles.css",
];
const versionedAssets = new Set(sourceAssets.filter((file) => file !== "index.html"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function expectedVersion() {
  const hash = createHash("sha256");
  for (const file of sourceAssets) {
    const bytes = await readFile(join(repoRoot, file));
    hash.update(file);
    hash.update("\0");
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, 12);
}

const manifest = JSON.parse(await readFile(join(publicDir, "asset-manifest.json"), "utf8"));
assert.equal(manifest.version, await expectedVersion(), "asset manifest version should be derived from current source assets");

const index = await readFile(join(publicDir, "index.html"), "utf8");
const refs = [...index.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?v=([^"]+))?)"/g)]
  .map((match) => ({ raw: match[1], file: match[1].split("?")[0], version: match[2] || "" }))
  .filter((ref) => versionedAssets.has(ref.file));

assert.equal(refs.length, versionedAssets.size, "index should reference every versioned JS/CSS asset exactly once");
assert.deepEqual(new Set(refs.map((ref) => ref.file)), versionedAssets, "index references should match source assets");
assert.deepEqual(new Set(refs.map((ref) => ref.version)), new Set([manifest.version]), "all JS/CSS references should use the manifest version");
assert.doesNotMatch(index, /20260525-oauth-primary2/, "built index should not keep the old hand-written asset version");

const entries = new Map((manifest.assets || []).map((entry) => [entry.file, entry]));
for (const file of sourceAssets) {
  assert.ok(entries.has(file), `manifest should include ${file}`);
  const sourceBytes = await readFile(join(repoRoot, file));
  assert.equal(entries.get(file).sha256, sha256(sourceBytes), `${file} manifest hash should match source`);
  if (file !== "index.html") {
    assert.equal(sha256(await readFile(join(publicDir, file))), entries.get(file).sha256, `${file} public hash should match manifest`);
  }
}

assert.ok(manifest.helper, "manifest should include the Helper download entry when dist helper exists");
const helperPath = join(publicDir, manifest.helper.file);
const helperStat = await stat(helperPath);
assert.equal(helperStat.size, manifest.helper.bytes, "Helper size should match manifest");
assert.equal(sha256(await readFile(helperPath)), manifest.helper.sha256, "Helper hash should match manifest");

console.log("static asset versioning verification passed");
