import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cloudRoot = resolve(here, "..");
const repoRoot = resolve(cloudRoot, "..");
const publicDir = join(cloudRoot, "public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

const assetFiles = ["index.html", "account-core.js", "platform-clients.js", "format-core.js", "progress-ui.js", "shell-ui.js", "dialog-ui.js", "settings-ui.js", "account-list-ui.js", "account-detail-ui.js", "audit-core.js", "admin-ui.js", "panels-ui.js", "import-core.js", "import-ui.js", "oauth-core.js", "app.js", "styles.css"];
const versionedAssets = assetFiles.filter((file) => file !== "index.html");
const assetEntries = [];
const versionHash = createHash("sha256");

async function hashFile(file) {
  const bytes = await readFile(join(repoRoot, file));
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  versionHash.update(file);
  versionHash.update("\0");
  versionHash.update(bytes);
  assetEntries.push({ file, bytes: bytes.length, sha256: digest });
  return bytes;
}

for (const file of assetFiles) {
  const bytes = await hashFile(file);
  if (file !== "index.html") {
    await writeFile(join(publicDir, file), bytes);
  }
}

const assetVersion = versionHash.digest("hex").slice(0, 12);
const indexSource = await readFile(join(repoRoot, "index.html"), "utf8");
const versionedIndex = indexSource.replace(
  /(href|src)="((?:[A-Za-z0-9_-]+)\.(?:css|js))(?:\?v=[^"]*)?"/g,
  (match, attr, file) => versionedAssets.includes(file) ? `${attr}="${file}?v=${assetVersion}"` : match,
);
await writeFile(join(publicDir, "index.html"), versionedIndex);

const helperSource = join(repoRoot, "dist", "CodexDockHelper", "CodexDockHelper.exe");
const legacyHelperSource = join(repoRoot, "dist", "CodexPlusLocalHelper", "CodexPlusLocalHelper.exe");
let helperEntry = null;
try {
  let source = helperSource;
  let helperStat = await stat(source).catch(() => null);
  if (!helperStat) {
    source = legacyHelperSource;
    helperStat = await stat(source);
  }
  if (helperStat.size > 0) {
    const downloadsDir = join(publicDir, "downloads");
    await mkdir(downloadsDir, { recursive: true });
    const helperBytes = await readFile(source);
    helperEntry = {
      file: "downloads/CodexDockHelper.exe",
      bytes: helperBytes.length,
      sha256: createHash("sha256").update(helperBytes).digest("hex").toUpperCase(),
    };
    await writeFile(join(downloadsDir, "CodexDockHelper.exe"), helperBytes);
  }
} catch {
  // The cloud console can still build without a local helper binary.
}

await writeFile(join(publicDir, "asset-manifest.json"), JSON.stringify({
  version: assetVersion,
  assets: assetEntries.sort((a, b) => a.file.localeCompare(b.file)),
  helper: helperEntry,
}, null, 2) + "\n");

console.log(`Built static assets in ${publicDir}`);
console.log(`Asset version: ${assetVersion}`);
