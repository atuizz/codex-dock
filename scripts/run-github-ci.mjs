import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const args = { repo: "", branch: "", sha: "", workflow: "ci.yml", out: "", timeoutSeconds: 900, pollSeconds: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index] || "";
    else if (arg === "--branch") args.branch = argv[++index] || "";
    else if (arg === "--sha") args.sha = argv[++index] || "";
    else if (arg === "--workflow") args.workflow = argv[++index] || args.workflow;
    else if (arg === "--out") args.out = argv[++index] || "";
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(argv[++index] || args.timeoutSeconds);
    else if (arg === "--poll-seconds") args.pollSeconds = Number(argv[++index] || args.pollSeconds);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/run-github-ci.mjs [--repo owner/name] [--branch branch] [--sha sha] [--workflow ci.yml] [--out file]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootPath,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function outputOf(command, args) {
  const result = run(command, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr}`);
  }
  return (result.stdout || "").trim();
}

function ghJson(args) {
  const text = outputOf("gh", args);
  return text ? JSON.parse(text) : null;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function writeEvidence(out, evidence) {
  if (!out) return;
  const outPath = resolve(rootPath, out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function findRun(runs, sha, branch) {
  return runs.find((run) => (
    run.workflowName === "CI"
    && run.event === "workflow_dispatch"
    && run.headSha === sha
    && run.headBranch === branch
  ));
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const evidence = {
  ok: false,
  checked_at: new Date().toISOString(),
  repository: "",
  branch: "",
  sha: "",
  workflow: args.workflow,
  run: null,
  error: "",
};

try {
  evidence.branch = args.branch || outputOf("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  evidence.sha = args.sha || outputOf("git", ["rev-parse", "HEAD"]);
  const repoInfo = args.repo
    ? ghJson(["repo", "view", args.repo, "--json", "nameWithOwner"])
    : ghJson(["repo", "view", "--json", "nameWithOwner"]);
  evidence.repository = repoInfo.nameWithOwner;

  const beforeRuns = ghJson([
    "run",
    "list",
    "--repo",
    evidence.repository,
    "--branch",
    evidence.branch,
    "--limit",
    "20",
    "--json",
    "databaseId,conclusion,event,headBranch,headSha,status,workflowName,createdAt,url",
  ]) || [];
  const existing = findRun(beforeRuns, evidence.sha, evidence.branch);
  if (existing?.status === "completed" && existing.conclusion === "success") {
    evidence.ok = true;
    evidence.run = existing;
    await writeEvidence(args.out, evidence);
    console.log(`GitHub CI already passed: ${existing.url}`);
    process.exit(0);
  }

  console.log(`Dispatching ${args.workflow} for ${evidence.repository}@${evidence.branch} (${evidence.sha.slice(0, 12)})`);
  outputOf("gh", ["workflow", "run", args.workflow, "--repo", evidence.repository, "--ref", evidence.branch]);

  let runInfo = null;
  while (Date.now() - startedAt < args.timeoutSeconds * 1000) {
    await sleep(Math.max(1, args.pollSeconds) * 1000);
    const runs = ghJson([
      "run",
      "list",
      "--repo",
      evidence.repository,
      "--branch",
      evidence.branch,
      "--limit",
      "20",
      "--json",
      "databaseId,conclusion,event,headBranch,headSha,status,workflowName,createdAt,url",
    ]) || [];
    runInfo = findRun(runs, evidence.sha, evidence.branch) || runInfo;
    if (!runInfo) continue;
    console.log(`GitHub CI ${runInfo.databaseId}: ${runInfo.status}${runInfo.conclusion ? `/${runInfo.conclusion}` : ""}`);
    if (runInfo.status === "completed") break;
  }

  if (!runInfo) throw new Error("workflow_dispatch run was not created before timeout");

  if (runInfo.status !== "completed") {
    evidence.run = runInfo;
    throw new Error(`GitHub CI did not complete before timeout: ${runInfo.url}`);
  }

  evidence.run = runInfo;
  evidence.ok = runInfo.conclusion === "success";
  if (!evidence.ok) throw new Error(`GitHub CI completed with ${runInfo.conclusion}: ${runInfo.url}`);

  await writeEvidence(args.out, evidence);
  console.log(`GitHub CI passed: ${runInfo.url}`);
} catch (error) {
  evidence.error = String(error.message || error);
  await writeEvidence(args.out, evidence);
  console.error(evidence.error);
  process.exit(1);
}
