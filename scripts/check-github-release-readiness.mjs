import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const args = { out: "", repo: "", sha: "", branch: "", soft: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") args.out = argv[++index] || "";
    else if (arg === "--repo") args.repo = argv[++index] || "";
    else if (arg === "--sha") args.sha = argv[++index] || "";
    else if (arg === "--branch") args.branch = argv[++index] || "";
    else if (arg === "--soft") args.soft = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-github-release-readiness.mjs [--repo owner/name] [--sha sha] [--branch branch] [--out file] [--soft]");
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

function splitRepo(repo) {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub repository: ${repo}`);
  }
  return { owner: parts[0], name: parts[1] };
}

function addCheck(result, id, ok, severity, message, details = {}, failureMessage = "") {
  const check = { id, ok, severity, message: ok ? message : (failureMessage || message), details };
  result.checks.push(check);
  if (!ok && severity === "error") result.gaps.push(check.message);
  if (!ok && severity === "warning") result.warnings.push(check.message);
  return check;
}

function parseSecretNames(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
}

const args = parseArgs(process.argv.slice(2));
const result = {
  checked_at: new Date().toISOString(),
  ok: false,
  repository: null,
  branch: args.branch || "",
  sha: args.sha || "",
  checks: [],
  gaps: [],
  warnings: [],
  evidence: {},
};

try {
  result.branch ||= outputOf("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  result.sha ||= outputOf("git", ["rev-parse", "HEAD"]);
  addCheck(result, "git-context", true, "error", "Resolved local git branch and commit", {
    branch: result.branch,
    sha: result.sha,
  });
} catch (error) {
  addCheck(result, "git-context", false, "error", "Unable to resolve local git branch and commit", {
    error: String(error.message || error),
  });
}

try {
  const repoInfo = args.repo
    ? ghJson(["repo", "view", args.repo, "--json", "nameWithOwner,isPrivate,defaultBranchRef,viewerPermission"])
    : ghJson(["repo", "view", "--json", "nameWithOwner,isPrivate,defaultBranchRef,viewerPermission"]);
  result.repository = repoInfo.nameWithOwner;
  result.evidence.repository = {
    nameWithOwner: repoInfo.nameWithOwner,
    isPrivate: repoInfo.isPrivate,
    defaultBranch: repoInfo.defaultBranchRef?.name || "",
    viewerPermission: repoInfo.viewerPermission || "",
  };
  addCheck(result, "github-repository", true, "error", "Resolved GitHub repository", result.evidence.repository);
} catch (error) {
  addCheck(result, "github-repository", false, "error", "Unable to resolve GitHub repository through gh", {
    error: String(error.message || error),
  });
}

if (result.repository) {
  const { owner, name } = splitRepo(result.repository);

  try {
    const workflows = ghJson(["api", `repos/${owner}/${name}/actions/workflows`])?.workflows || [];
    result.evidence.workflows = workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
    }));
    const ci = workflows.find((workflow) => workflow.path === ".github/workflows/ci.yml" && workflow.state === "active");
    const deploy = workflows.find((workflow) => workflow.path === ".github/workflows/cloudflare-deploy.yml" && workflow.state === "active");
    addCheck(result, "ci-workflow-active", Boolean(ci), "error", "CI workflow is active", ci || {});
    addCheck(result, "cloudflare-deploy-workflow-active", Boolean(deploy), "error", "Cloudflare Deploy workflow is active", deploy || {});
  } catch (error) {
    addCheck(result, "github-workflows", false, "error", "Unable to inspect GitHub workflows", {
      error: String(error.message || error),
    });
  }

  try {
    const secretsText = outputOf("gh", ["secret", "list", "--repo", result.repository]);
    const secretNames = parseSecretNames(secretsText);
    const requiredSecrets = ["CHECKOUT_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
    result.evidence.secrets = {
      present: requiredSecrets.filter((name) => secretNames.has(name)),
      missing: requiredSecrets.filter((name) => !secretNames.has(name)),
    };
    addCheck(result, "checkout-token-secret", secretNames.has("CHECKOUT_TOKEN"), "warning", "CHECKOUT_TOKEN secret is present", {}, "CHECKOUT_TOKEN is missing; private-repository checkout fallback may fail");
    addCheck(result, "cloudflare-account-secret", secretNames.has("CLOUDFLARE_ACCOUNT_ID"), "error", "CLOUDFLARE_ACCOUNT_ID secret is present", {}, "CLOUDFLARE_ACCOUNT_ID is missing for GitHub-hosted Cloudflare deploys");
    addCheck(result, "cloudflare-api-token-secret", secretNames.has("CLOUDFLARE_API_TOKEN"), "error", "CLOUDFLARE_API_TOKEN secret is present", {}, "CLOUDFLARE_API_TOKEN is missing for GitHub-hosted Cloudflare deploys");
  } catch (error) {
    addCheck(result, "github-secrets", false, "error", "Unable to inspect repository secret names", {
      error: String(error.message || error),
    });
  }

  if (result.sha) {
    try {
      const events = ghJson(["api", `repos/${owner}/${name}/events`]) || [];
      const matchingPushEvents = events
        .filter((event) => event.type === "PushEvent" && event.payload?.head === result.sha)
        .map((event) => ({
          actor: event.actor?.login || "",
          created_at: event.created_at || "",
          ref: event.payload?.ref || "",
          before: event.payload?.before || "",
          head: event.payload?.head || "",
          push_id: event.payload?.push_id || null,
        }));
      result.evidence.push_events = matchingPushEvents;
      addCheck(result, "current-sha-push-event-observed", matchingPushEvents.length > 0, "warning", "GitHub recorded a PushEvent for the current commit", {
        push_events: matchingPushEvents,
      }, "No GitHub PushEvent was observed for the current commit");
    } catch (error) {
      addCheck(result, "github-push-events", false, "warning", "Unable to inspect repository PushEvents", {
        error: String(error.message || error),
      });
    }

    try {
      const runs = ghJson([
        "run",
        "list",
        "--repo",
        result.repository,
        "--commit",
        result.sha,
        "--limit",
        "20",
        "--json",
        "databaseId,conclusion,event,headBranch,headSha,status,workflowName,createdAt,url",
      ]) || [];
      result.evidence.runs = runs;
      const successfulCi = runs.find((run) => run.workflowName === "CI" && run.headSha === result.sha && run.status === "completed" && run.conclusion === "success");
      const successfulPushCi = runs.find((run) => run.workflowName === "CI" && run.headSha === result.sha && run.event === "push" && run.status === "completed" && run.conclusion === "success");
      const successfulManualCi = runs.find((run) => run.workflowName === "CI" && run.headSha === result.sha && run.event === "workflow_dispatch" && run.status === "completed" && run.conclusion === "success");
      const pushEventObserved = (result.evidence.push_events || []).length > 0;
      addCheck(result, "current-sha-ci-green", Boolean(successfulCi), "error", "Current commit has a successful CI run", successfulCi || {}, "No successful CI run exists for the current commit");
      addCheck(result, "current-sha-push-ci-green", Boolean(successfulPushCi), "error", "Current commit has a successful push-triggered CI run", successfulPushCi || {}, pushEventObserved
        ? "GitHub recorded a PushEvent for the current commit but no successful push-triggered CI run exists"
        : "No successful push-triggered CI run exists for the current commit");
      addCheck(result, "current-sha-manual-ci-green", Boolean(successfulManualCi), "warning", "Current commit has a successful manual CI run", successfulManualCi || {}, "No successful manual CI run exists for the current commit");
    } catch (error) {
      addCheck(result, "github-runs", false, "error", "Unable to inspect GitHub Actions runs for the current commit", {
        error: String(error.message || error),
      });
    }

    try {
      const suites = ghJson(["api", `repos/${owner}/${name}/commits/${result.sha}/check-suites`])?.check_suites || [];
      result.evidence.check_suites = suites.map((suite) => ({
        app: suite.app?.slug || suite.app?.name || "",
        status: suite.status,
        conclusion: suite.conclusion,
        latest_check_runs_count: suite.latest_check_runs_count,
      }));
      const queuedExternal = result.evidence.check_suites.filter((suite) => suite.app !== "github-actions" && suite.status !== "completed");
      addCheck(result, "external-check-suites-completed", queuedExternal.length === 0, "warning", "External check suites are completed", {
        queuedExternal,
      }, "External check suites are still queued or in progress");
    } catch (error) {
      addCheck(result, "github-check-suites", false, "warning", "Unable to inspect commit check suites", {
        error: String(error.message || error),
      });
    }
  }
}

result.ok = result.checks.every((check) => check.ok || check.severity === "warning");

if (args.out) {
  const outPath = resolve(rootPath, args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
}

const status = result.ok ? "ready" : "not ready";
console.log(`GitHub release readiness: ${status}`);
console.log(`Repository: ${result.repository || "(unknown)"}`);
console.log(`Commit: ${result.sha || "(unknown)"}`);
if (result.gaps.length) {
  console.log("Blocking gaps:");
  for (const gap of result.gaps) console.log(`- ${gap}`);
}
if (result.warnings.length) {
  console.log("Warnings:");
  for (const warning of result.warnings) console.log(`- ${warning}`);
}
if (args.out) console.log(`Evidence: ${args.out}`);

if (!result.ok && !args.soft) process.exit(1);
