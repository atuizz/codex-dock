import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/generate-release-evidence-report.mjs", "--json"], {
  encoding: "utf8",
  shell: false,
});

if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);

const report = JSON.parse(result.stdout);
assert.equal(report.mode, "candidate");
assert.equal(report.ok, true);
assert.equal(report.candidate_ok, true);
assert.equal(report.helper.version, "0.4.10");
assert.equal(report.helper.lifecycle.health_ok, true);
assert.equal(report.helper.lifecycle.self_test_ok, true);
assert.equal(report.helper.lifecycle.self_test_log_found, true);
assert.equal(report.helper.consistency.version_matches_manifest, true);
assert.equal(report.helper.consistency.exe_sha_matches_manifest, true);
assert.equal(typeof report.helper.consistency.version_matches_production, "boolean");
assert.equal(typeof report.helper.consistency.exe_sha_matches_production, "boolean");
assert.equal(typeof report.helper.consistency.package_sha_matches_production, "boolean");
assert.equal(typeof report.production_parity_ok, "boolean");
assert.equal(report.cloudflare.production_url, "https://codex.woai.pro");
assert.match(report.cloudflare.static_asset_version, /^[a-f0-9]{12}$/);
assert.match(report.git.remote_main, /^[a-f0-9]{12}$/);
assert.match(report.git.remote_branch, /^[a-f0-9]{12}$/);
assert.equal(report.ci_cd.ci_workflow_configured, true);
assert.equal(report.ci_cd.deploy_workflow_configured, true);
assert.equal(report.ci_cd.workflow_dispatch_configured, true);
assert.equal(report.ci_cd.production_surface_command, "npm run smoke:production:surface");
assert.equal(report.ci_cd.github_ci_command, "npm run release:github-ci");
assert.equal(report.ci_cd.github_readiness_command, "npm run release:github-readiness");
if (report.ci_cd.github_readiness) {
  assert.equal(report.ci_cd.github_readiness.repository, "atuizz/codex-dock");
  assert.match(report.ci_cd.github_readiness.sha, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(report.ci_cd.github_readiness.gaps));
  assert.ok(Array.isArray(report.ci_cd.github_readiness.warnings));
}
if (report.ci_cd.github_ci_dispatch) {
  assert.equal(report.ci_cd.github_ci_dispatch.repository, "atuizz/codex-dock");
  assert.match(report.ci_cd.github_ci_dispatch.sha, /^[a-f0-9]{40}$/);
  assert.match(report.ci_cd.github_ci_dispatch.run_url, /^https:\/\/github\.com\/atuizz\/codex-dock\/actions\/runs\/\d+/);
}
assert.equal(report.docs.release_doc_has_quality_gates, true);
assert.equal(report.docs.release_doc_mentions_helper, true);
assert.equal(report.docs.package_has_release_report, true);
assert.equal(report.docs.package_has_github_ci_dispatch, true);
assert.equal(report.docs.package_has_github_readiness, true);
assert.equal(report.evidence.required_count, 28);
assert.equal(report.evidence.present_count, 28);
assert.deepEqual(report.evidence.missing, []);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /access_token|refresh_token|device_key|Authorization: Bearer/i);

console.log("release evidence report verification passed");
