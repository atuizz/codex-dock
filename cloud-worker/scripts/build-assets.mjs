import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStoreZip,
  sha256,
} from "../../scripts/helper-release-utils.mjs";

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
  const digest = sha256(bytes);
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
const helperSourceCode = join(repoRoot, "native-helper", "CodexPlusLocalHelper.cs");
const helperDistDir = join(repoRoot, "dist", "CodexDockHelper");
let helperEntry = null;

async function helperMetadata() {
  try {
    const source = await readFile(helperSourceCode, "utf8");
    return {
      version: source.match(/HelperVersion\s*=\s*"([^"]+)"/)?.[1] || "",
      build_date: source.match(/HelperBuildDate\s*=\s*"([^"]+)"/)?.[1] || "",
    };
  } catch {
    return { version: "", build_date: "" };
  }
}

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
    const metadata = await helperMetadata();
    const helperSha = sha256(helperBytes);
    const helperIcon = await readFile(join(helperDistDir, "CodexDockHelper.ico")).catch(() => null);
    const helperReadme = await readFile(join(helperDistDir, "README.md")).catch(() => null);
    const packageName = `CodexDockHelper-${metadata.version || "latest"}-portable.zip`;
    const releaseManifestName = "CodexDockHelper-release.json";
    const releaseFiles = [
      { file: "CodexDockHelper.exe", bytes: helperBytes.length, sha256: helperSha },
      ...(helperIcon ? [{ file: "CodexDockHelper.ico", bytes: helperIcon.length, sha256: sha256(helperIcon) }] : []),
      ...(helperReadme ? [{ file: "README.md", bytes: helperReadme.length, sha256: sha256(helperReadme) }] : []),
    ];
    const releaseManifest = {
      product: "Codex Dock Helper",
      kind: "portable-windows-helper",
      version: metadata.version,
      build_date: metadata.build_date,
      minimum_cloud_console: "https://codex.woai.pro",
      install: {
        mode: "portable",
        steps: [
          "关闭正在运行的 Codex Dock Helper。",
          "解压 CodexDockHelper portable 包到一个固定目录。",
          "运行 CodexDockHelper.exe，并在云控制台设备页完成授权。",
        ],
      },
      files: releaseFiles,
    };
    const releaseManifestBytes = Buffer.from(JSON.stringify(releaseManifest, null, 2) + "\n");
    const packageEntries = [
      { name: "CodexDockHelper/CodexDockHelper.exe", bytes: helperBytes },
      ...(helperIcon ? [{ name: "CodexDockHelper/CodexDockHelper.ico", bytes: helperIcon }] : []),
      ...(helperReadme ? [{ name: "CodexDockHelper/README.md", bytes: helperReadme }] : []),
      { name: `CodexDockHelper/${releaseManifestName}`, bytes: releaseManifestBytes },
    ];
    const packageBytes = createStoreZip(packageEntries, {
      date: new Date(`${metadata.build_date || "2026-01-01"}T00:00:00Z`),
    });
    releaseManifest.package = {
      file: `downloads/${packageName}`,
      format: "zip",
      bytes: packageBytes.length,
      sha256: sha256(packageBytes),
    };
    const finalReleaseManifestBytes = Buffer.from(JSON.stringify(releaseManifest, null, 2) + "\n");
    helperEntry = {
      file: "downloads/CodexDockHelper.exe",
      version: metadata.version,
      build_date: metadata.build_date,
      bytes: helperBytes.length,
      sha256: helperSha,
      release_manifest: `downloads/${releaseManifestName}`,
      package: releaseManifest.package,
    };
    await writeFile(join(downloadsDir, "CodexDockHelper.exe"), helperBytes);
    await writeFile(join(downloadsDir, packageName), packageBytes);
    await writeFile(join(downloadsDir, releaseManifestName), finalReleaseManifestBytes);
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
