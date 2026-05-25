import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const scriptsDir = new URL("scripts/", root);
const nodeBin = process.execPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootPath,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const printable = [command, ...args].join(" ");
    throw new Error(`${printable} exited with ${result.status}`);
  }
}

function quoteCmdArg(value) {
  const text = String(value);
  return /[\s&()^|<>]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function runNpm(args) {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npm", ...args].map(quoteCmdArg).join(" ")]);
    return;
  }
  run("npm", args);
}

console.log("Building Cloudflare static assets");
runNpm(["--prefix", "cloud-worker", "run", "build"]);

const files = (await readdir(scriptsDir))
  .filter((name) => /^verify-.*\.(?:cjs|mjs)$/.test(name))
  .filter((name) => name !== "verify-production-smoke.mjs")
  .sort();

for (const file of files) {
  console.log(`Running ${file}`);
  run(nodeBin, [join("scripts", file)]);
}

console.log(`Local verification passed (${files.length} scripts)`);
