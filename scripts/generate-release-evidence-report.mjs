import { spawnSync } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const args = new Set(process.argv.slice(2));
const requireProductionParity = args.has("--require-production-parity");

const requiredEvidence = [
  "artifacts/design/codex-dock-commercial-interface-reference-board-v1.png",
  "artifacts/verification/codex-dock-helper-diagnostics-desktop.png",
  "artifacts/verification/codex-dock-settings-usage-channel-desktop.png",
  "artifacts/verification/codex-dock-smart-switch-protection-desktop.png",
  "artifacts/verification/codex-dock-smart-switch-tablet.png",
  "artifacts/verification/codex-dock-helper-mobile.png",
  "artifacts/verification/codex-dock-import-primary-drawer-desktop.png",
  "artifacts/verification/codex-dock-import-primary-drawer-mobile.png",
  "artifacts/verification/codex-dock-account-detail-diagnostics-local.png",
  "artifacts/verification/oauth-flow-resume-local.png",
  "artifacts/verification/oauth-flow-resume-production.png",
  "artifacts/verification/codex-dock-admin-ops-summary-browser.png",
  "artifacts/verification/account-health-production-preview.png",
  "artifacts/verification/account-cleanup-modal-production.png",
  "artifacts/verification/helper-release-card-production.png",
  "artifacts/verification/helper-portable-release-production.png",
  "artifacts/verification/usage-refresh-scheduler-settings-local.png",
  "artifacts/verification/usage-refresh-scheduler-settings-production.png",
  "artifacts/verification/manual-switch-risk-local.png",
  "artifacts/verification/helper-lifecycle-health-local-result.json",
  "artifacts/verification/helper-lifecycle-self-test-local-result.json",
  "artifacts/verification/helper-pending-revalidation-local-result.json",
  "artifacts/verification/helper-pending-revalidation-local.png",
  "artifacts/verification/auto-switch-stage-production.png",
  "artifacts/verification/helper-stale-reconnect-production.png",
  "artifacts/verification/oauth-provider-error-production-result.json",
  "artifacts/verification/helper-update-release-production-result.json",
  "artifacts/verification/production-surface-result.json",
];

async function readText(relativePath) {
  return readFile(join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readText(relativePath));
  } catch {
    return null;
  }
}

async function fileInfo(relativePath) {
  try {
    const info = await stat(join(repoRoot, relativePath));
    return { path: relativePath, ok: info.size > 0, bytes: info.size };
  } catch {
    return { path: relativePath, ok: false, bytes: 0 };
  }
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function runGh(ghArgs) {
  const result = spawnSync("gh", ghArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function githubRepo() {
  const repo = runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return repo || "atuizz/codex-dock";
}

function remoteHead(ref) {
  const output = runGit(["ls-remote", "origin", ref]);
  const sha = output.split(/\s+/)[0] || "";
  if (sha) return sha.slice(0, 12);

  const match = ref.match(/^refs\/heads\/(.+)$/);
  if (!match) return "";
  const apiSha = runGh(["api", `repos/${githubRepo()}/git/ref/heads/${match[1]}`, "--jq", ".object.sha"]);
  return apiSha ? apiSha.slice(0, 12) : "";
}

function extractWorkerVersion(releaseDoc) {
  const latest = releaseDoc.match(/Latest production release verified[\s\S]*?Worker version `([^`]+)`/);
  return latest ? latest[1] : "";
}

const [
  assetManifest,
  helperRelease,
  localUpdate,
  productionUpdate,
  lifecycleHealth,
  lifecycleSelfTest,
  productionSurface,
  githubReadiness,
  githubCiDispatch,
  releaseDoc,
  packageJson,
  ciWorkflow,
  deployWorkflow,
] = await Promise.all([
  readJson("cloud-worker/public/asset-manifest.json"),
  readJson("dist/CodexDockHelper/CodexDockHelper-release.json"),
  readJson("artifacts/verification/helper-update-local-result.json"),
  readJson("artifacts/verification/helper-update-release-production-result.json"),
  readJson("artifacts/verification/helper-lifecycle-health-local-result.json"),
  readJson("artifacts/verification/helper-lifecycle-self-test-local-result.json"),
  readJson("artifacts/verification/production-surface-result.json"),
  readJson("artifacts/verification/github-release-readiness-result.json"),
  readJson("artifacts/verification/github-ci-dispatch-result.json"),
  readText("docs/release-and-verification.md").catch(() => ""),
  readJson("package.json"),
  readText(".github/workflows/ci.yml").catch(() => ""),
  readText(".github/workflows/cloudflare-deploy.yml").catch(() => ""),
]);

const evidence = await Promise.all(requiredEvidence.map(fileInfo));
const missingEvidence = evidence.filter((item) => !item.ok).map((item) => item.path);
const productionHelper = productionUpdate?.helper || {};
const releasePackage = helperRelease?.package || {};
const productionPackage = productionHelper.package || productionUpdate?.release_package || {};

const helperConsistency = {
  version_matches_manifest: helperRelease?.version === assetManifest?.helper?.version,
  version_matches_production: helperRelease?.version === productionHelper.version,
  exe_sha_matches_manifest: helperRelease?.files?.some((file) => file.file === "CodexDockHelper.exe" && file.sha256 === assetManifest?.helper?.sha256) || false,
  exe_sha_matches_production: helperRelease?.files?.some((file) => file.file === "CodexDockHelper.exe" && file.sha256 === productionHelper.sha256) || false,
  package_sha_matches_production: Boolean(releasePackage.sha256 && releasePackage.sha256 === productionPackage.sha256),
};
const candidateOk = missingEvidence.length === 0
  && helperConsistency.version_matches_manifest
  && helperConsistency.exe_sha_matches_manifest
  && lifecycleHealth?.ok === true
  && lifecycleSelfTest?.ok === true
  && lifecycleSelfTest?.log_found === true
  && productionSurface?.ok === true;
const productionParityOk = productionUpdate?.ok === true
  && helperConsistency.version_matches_production
  && helperConsistency.exe_sha_matches_production
  && helperConsistency.package_sha_matches_production;

const report = {
  mode: requireProductionParity ? "post-deploy" : "candidate",
  ok: candidateOk && (!requireProductionParity || productionParityOk),
  candidate_ok: candidateOk,
  production_parity_ok: productionParityOk,
  generated_at: new Date().toISOString(),
  git: {
    branch: runGit(["branch", "--show-current"]),
    commit: runGit(["rev-parse", "--short=12", "HEAD"]),
    status_short: runGit(["status", "--short"]).split(/\r?\n/).filter(Boolean),
    remote_main: remoteHead("refs/heads/main") || runGit(["rev-parse", "--short=12", "origin/main"]),
    remote_branch: remoteHead("refs/heads/codex/commercial-productization") || runGit(["rev-parse", "--short=12", "origin/codex/commercial-productization"]),
  },
  cloudflare: {
    production_url: "https://codex.woai.pro",
    worker_version: extractWorkerVersion(releaseDoc),
    static_asset_version: assetManifest?.version || "",
    production_manifest_verified_at: productionUpdate?.verified_at || "",
    production_surface_checked_at: productionSurface?.checked_at || "",
  },
  helper: {
    version: helperRelease?.version || "",
    build_date: helperRelease?.build_date || "",
    exe: helperRelease?.files?.find((file) => file.file === "CodexDockHelper.exe") || null,
    package: releasePackage,
    consistency: helperConsistency,
    local_update: {
      current_version: localUpdate?.current_version || "",
      latest_version: localUpdate?.latest_version || "",
      update_available: localUpdate?.update_available ?? null,
      sha256: localUpdate?.sha256 || "",
    },
    lifecycle: {
      health_ok: lifecycleHealth?.ok === true,
      tray_visible: lifecycleHealth?.tray?.visible ?? null,
      helper_log_exists: lifecycleHealth?.lifecycle?.helper_log_exists ?? null,
      self_test_ok: lifecycleSelfTest?.ok === true,
      self_test_log_found: lifecycleSelfTest?.log_found === true,
    },
  },
  ci_cd: {
    preflight_command: "npm run preflight",
    production_smoke_command: "npm run smoke:production",
    production_surface_command: "npm run smoke:production:surface",
    release_report_command: "npm run release:report",
    github_ci_command: "npm run release:github-ci",
    github_readiness_command: "npm run release:github-readiness",
    ci_workflow_configured: /npm run preflight/.test(ciWorkflow) && /actions\/upload-artifact/.test(ciWorkflow),
    deploy_workflow_configured: /wrangler deploy/.test(deployWorkflow) && /npm run smoke:production/.test(deployWorkflow),
    workflow_dispatch_configured: /workflow_dispatch/.test(deployWorkflow),
    github_readiness: githubReadiness ? {
      ok: githubReadiness.ok === true,
      checked_at: githubReadiness.checked_at || "",
      repository: githubReadiness.repository || "",
      sha: githubReadiness.sha || "",
      gaps: Array.isArray(githubReadiness.gaps) ? githubReadiness.gaps : [],
      warnings: Array.isArray(githubReadiness.warnings) ? githubReadiness.warnings : [],
    } : null,
    github_ci_dispatch: githubCiDispatch ? {
      ok: githubCiDispatch.ok === true,
      checked_at: githubCiDispatch.checked_at || "",
      repository: githubCiDispatch.repository || "",
      sha: githubCiDispatch.sha || "",
      run_url: githubCiDispatch.run?.url || "",
      conclusion: githubCiDispatch.run?.conclusion || "",
    } : null,
  },
  evidence: {
    required_count: requiredEvidence.length,
    present_count: evidence.length - missingEvidence.length,
    missing: missingEvidence,
    artifacts: evidence,
  },
  docs: {
    release_doc_has_quality_gates: /## Commercial Quality Gates/.test(releaseDoc),
    release_doc_mentions_helper: new RegExp(`(?:Helper|Agent) \`${helperRelease?.version || "0.0.0"}\``).test(releaseDoc),
    package_has_release_report: Boolean(packageJson?.scripts?.["release:report"]),
    package_has_github_ci_dispatch: Boolean(packageJson?.scripts?.["release:github-ci"]),
    package_has_github_readiness: Boolean(packageJson?.scripts?.["release:github-readiness"]),
  },
};

console.log(JSON.stringify(report, null, 2));
if (!args.has("--json") && !report.ok) {
  process.exitCode = 1;
}
