const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const helperSource = fs.readFileSync(path.join(repoRoot, "native-helper", "CodexPlusLocalHelper.cs"), "utf8");

assert.match(helperSource, /\/api\/diagnostics\/export/);
assert.match(helperSource, /\/api\/tray\/repair/);
assert.match(helperSource, /TrayStatusJson/);
assert.match(helperSource, /RepairTrayIconFromAnyThread/);
assert.match(helperSource, /EnsureTrayIconHeartbeat[\s\S]*EnsureTrayIcon\("托盘心跳", false\)/);
assert.match(helperSource, /protected override void WndProc\(ref Message m\)/);
assert.match(helperSource, /RecoverRichTextState\(ex\)/);
assert.match(helperSource, /RedactDiagnosticText/);
assert.match(helperSource, /AutoSwitchFailureBackoffSeconds/);
assert.match(helperSource, /AutoSwitchFailurePauseThreshold\s*=\s*3/);
assert.match(helperSource, /AutoSwitchFailurePauseSeconds\s*=\s*1800/);
assert.match(helperSource, /AutoSwitchFailureBackoffActive/);
assert.match(helperSource, /AutoSwitchFailurePauseActive/);
assert.match(helperSource, /ArmAutoSwitchFailureBackoff/);
assert.match(helperSource, /\/api\/auto-switch\/resume/);
assert.match(helperSource, /failure_count/);
assert.match(helperSource, /failure_pause_until/);
assert.match(helperSource, /failure_pause_reason/);
assert.match(helperSource, /SetAutoSwitchStage\("failure-paused", "自动暂停"\)/);
assert.match(helperSource, /AutoSwitchFailureStageLabel/);
assert.ok(helperSource.includes("\\\\bAuthorization\\\\s*:\\\\s*Bearer"));
assert.match(helperSource, /cdh_\[REDACTED\]/);

async function verifyLiveHelper() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  let health;
  try {
    health = await fetch("http://127.0.0.1:18766/api/health", { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    console.log("helper-diagnostics source verification passed; live Helper not running, skipped live export check");
    return;
  }
  clearTimeout(timer);
  if (!health.ok) {
    console.log("helper-diagnostics source verification passed; live Helper unhealthy, skipped live export check");
    return;
  }

  const fakeJwt = "eyJaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccc";
  const fakeSecrets = [
    "fake-access-123",
    "fake-refresh-456",
    "cdh_fakeDeviceToken1234567890",
    "fake-bearer-789",
    "fake-code-1",
    "fake-state-2",
    fakeJwt,
  ];
  const logDir = path.join(process.env.APPDATA || "", "CodexDock");
  if (logDir && fs.existsSync(logDir)) {
    fs.appendFileSync(
      path.join(logDir, "helper.log"),
      `[diagnostics-redaction-test] access_token=${fakeSecrets[0]} refresh_token=${fakeSecrets[1]} deviceToken=${fakeSecrets[2]} Authorization: Bearer ${fakeSecrets[3]} url=http://localhost/callback?code=${fakeSecrets[4]}&state=${fakeSecrets[5]} jwt=${fakeSecrets[6]}\n`,
      "utf8",
    );
  }

  const response = await fetch("http://127.0.0.1:18766/api/diagnostics/export", {
    headers: { Origin: "https://codex.woai.pro" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.redaction?.applied, true);
  assert.equal(typeof body.tray?.visible, "boolean");
  assert.ok(Array.isArray(body.recent_logs));
  const text = JSON.stringify(body);
  for (const secret of fakeSecrets) {
    assert.equal(text.includes(secret), false, `diagnostics export leaked ${secret}`);
  }
  console.log("helper-diagnostics live verification passed");
}

verifyLiveHelper().catch((error) => {
  console.error(error);
  process.exit(1);
});
