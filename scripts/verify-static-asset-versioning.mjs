import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listStoreZipEntries,
} from "./helper-release-utils.mjs";

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

async function readNormalizedTextBytes(filePath) {
  const text = await readFile(filePath, "utf8");
  return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

async function expectedVersion() {
  const hash = createHash("sha256");
  for (const file of sourceAssets) {
    const bytes = await readNormalizedTextBytes(join(repoRoot, file));
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
assert.match(index, /id="repairTrayBtn"/, "Helper page should expose tray repair action");
assert.match(index, /id="settingsRepairTrayBtn"/, "settings page should expose tray repair action");

const entries = new Map((manifest.assets || []).map((entry) => [entry.file, entry]));
for (const file of sourceAssets) {
  assert.ok(entries.has(file), `manifest should include ${file}`);
  const sourceBytes = await readNormalizedTextBytes(join(repoRoot, file));
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
const helperSource = await readFile(join(repoRoot, "native-helper", "CodexPlusLocalHelper.cs"), "utf8");
assert.equal(manifest.helper.version, helperSource.match(/HelperVersion\s*=\s*"([^"]+)"/)?.[1], "Helper version should match source");
assert.equal(manifest.helper.build_date, helperSource.match(/HelperBuildDate\s*=\s*"([^"]+)"/)?.[1], "Helper build date should match source");
assert.ok(manifest.helper.release_manifest, "manifest should expose the Helper release manifest");
assert.ok(manifest.helper.package?.file, "manifest should expose the Helper portable package");
assert.match(manifest.helper.package.file, /CodexDockHelper-\d+\.\d+\.\d+-portable\.zip$/, "Helper package should be versioned");
const releaseManifest = JSON.parse(await readFile(join(publicDir, manifest.helper.release_manifest), "utf8"));
assert.equal(releaseManifest.version, manifest.helper.version, "Helper release manifest version should match asset manifest");
assert.equal(releaseManifest.files.find((file) => file.file === "CodexDockHelper.exe")?.sha256, manifest.helper.sha256, "release manifest should include the exe hash");
assert.equal(releaseManifest.package.sha256, manifest.helper.package.sha256, "release manifest package hash should match asset manifest");
const helperPackagePath = join(publicDir, manifest.helper.package.file);
const helperPackageStat = await stat(helperPackagePath);
assert.equal(helperPackageStat.size, manifest.helper.package.bytes, "Helper package size should match manifest");
const helperPackageBytes = await readFile(helperPackagePath);
assert.equal(sha256(helperPackageBytes), manifest.helper.package.sha256, "Helper package hash should match manifest");
const zipNames = new Set(listStoreZipEntries(helperPackageBytes).map((entry) => entry.name));
assert.ok(zipNames.has("CodexDockHelper/CodexDockHelper.exe"), "Helper package should include the exe");
assert.ok(zipNames.has("CodexDockHelper/CodexDockHelper.ico"), "Helper package should include the icon");
assert.ok(zipNames.has("CodexDockHelper/README.md"), "Helper package should include install docs");
assert.ok(zipNames.has("CodexDockHelper/CodexDockHelper-release.json"), "Helper package should include release manifest");
const distReleaseManifest = JSON.parse(await readFile(join(repoRoot, "dist", "CodexDockHelper", "CodexDockHelper-release.json"), "utf8"));
assert.equal(distReleaseManifest.version, manifest.helper.version, "dist release manifest version should match asset manifest");
assert.equal(distReleaseManifest.files.find((file) => file.file === "CodexDockHelper.exe")?.sha256, manifest.helper.sha256, "dist release manifest should match the committed Helper exe");
assert.equal(distReleaseManifest.files.find((file) => file.file === "README.md")?.sha256, sha256(await readNormalizedTextBytes(join(repoRoot, "dist", "CodexDockHelper", "README.md"))), "dist release manifest should match bundled README");
assert.equal(basename(distReleaseManifest.package.file || ""), basename(manifest.helper.package.file), "dist release manifest package name should match asset manifest");
assert.equal(distReleaseManifest.package.sha256, manifest.helper.package.sha256, "dist release manifest package hash should match asset manifest");

console.log("static asset versioning verification passed");
