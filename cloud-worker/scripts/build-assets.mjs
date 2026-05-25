import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cloudRoot = resolve(here, "..");
const repoRoot = resolve(cloudRoot, "..");
const publicDir = join(cloudRoot, "public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

for (const file of ["index.html", "account-core.js", "platform-clients.js", "format-core.js", "progress-ui.js", "shell-ui.js", "dialog-ui.js", "settings-ui.js", "account-list-ui.js", "account-detail-ui.js", "audit-core.js", "admin-ui.js", "panels-ui.js", "import-core.js", "import-ui.js", "app.js", "styles.css"]) {
  await copyFile(join(repoRoot, file), join(publicDir, file));
}

const helperSource = join(repoRoot, "dist", "CodexDockHelper", "CodexDockHelper.exe");
const legacyHelperSource = join(repoRoot, "dist", "CodexPlusLocalHelper", "CodexPlusLocalHelper.exe");
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
    await copyFile(source, join(downloadsDir, "CodexDockHelper.exe"));
  }
} catch {
  // The cloud console can still build without a local helper binary.
}

console.log(`Built static assets in ${publicDir}`);
