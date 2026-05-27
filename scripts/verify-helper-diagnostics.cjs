const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const helperSource = fs
  .readdirSync(path.join(repoRoot, "native-helper"))
  .filter((name) => name.endsWith(".cs"))
  .sort()
  .map((name) => fs.readFileSync(path.join(repoRoot, "native-helper", name), "utf8"))
  .join("\n");
const helperMainSource = fs.readFileSync(path.join(repoRoot, "native-helper", "CodexPlusLocalHelper.cs"), "utf8");
const runtimeStatusSource = fs.readFileSync(path.join(repoRoot, "native-helper", "CodexRuntimeStatus.cs"), "utf8");
const desktopUiSource = fs.readFileSync(path.join(repoRoot, "native-helper", "HelperDesktopUi.cs"), "utf8");
const helperBuildScript = fs.readFileSync(path.join(repoRoot, "native-helper", "build-helper.ps1"), "utf8");
const expectedHelperVersion = "0.4.9";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function helperPatchAtLeast(version, minimumPatch) {
  const match = String(version || "").match(/^0\.4\.(\d+)$/);
  return Boolean(match) && Number(match[1]) >= minimumPatch;
}

async function appendFileWithRetry(filePath, text) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.appendFileSync(filePath, text, "utf8");
      return true;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) throw error;
      await wait(120 + attempt * 80);
    }
  }
  throw lastError;
}

assert.match(helperSource, /\/api\/diagnostics\/export/);
assert.match(helperSource, /\/api\/tray\/repair/);
assert.match(helperSource, new RegExp(`HelperVersion\\s*=\\s*"${expectedHelperVersion.replace(/\./g, "\\.")}"`));
assert.match(helperSource, /\/api\/update\/check/);
assert.match(helperSource, /\/api\/update\/open-download/);
assert.match(helperSource, /\/api\/lifecycle\/self-test/);
assert.match(helperSource, /LifecycleStatusJson/);
assert.match(helperSource, /LifecycleSelfTestJson/);
assert.match(helperSource, /SimulateLogViewFaultForSelfTest/);
assert.match(helperSource, /log_view_fault_recovered/);
assert.match(helperSource, /SimulateRecoverForSelfTest/);
assert.match(helperSource, /RunOnUiAndWait/);
assert.match(helperSource, /main_window_visible/);
assert.match(helperSource, /log_view_needs_reload/);
assert.match(helperSource, /recent_log_count/);
assert.match(helperSource, /CheckHelperUpdate/);
assert.match(helperSource, /LatestHelperDownloadUrl/);
assert.match(helperSource, /BeginHelperUpdateCheckFromUi/);
assert.match(helperSource, /检查更新/);
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
assert.match(helperSource, /PendingSwitchReason/);
assert.match(helperSource, /PendingSwitchAuthFingerprint/);
assert.match(helperSource, /RestorePersistedAutoSwitchPendingState/);
assert.match(helperSource, /PersistAutoSwitchPending/);
assert.match(helperSource, /ClearPersistedAutoSwitchPending/);
assert.match(helperSource, /pending_revalidation/);
assert.match(helperSource, /SetAutoSwitchStage\("draining-active-turn", "保护当前任务"\)/);
assert.match(helperSource, /SetAutoSwitchStage\("candidate-selecting", "请求候选账号"\)/);
assert.match(helperSource, /SetAutoSwitchStage\("payload-issued", "已取得切换载荷"\)/);
assert.match(helperSource, /SetAutoSwitchStage\("writing-auth", "写入 auth"\)/);
assert.match(helperSource, /SetAutoSwitchStage\("restarting-codex", "重启 Codex"\)/);
assert.match(helperSource, /SetAutoSwitchStage\("restoring-window", "恢复窗口"\)/);
assert.match(helperSource, /RunSwitchJob\(nextAuth, true, true, true\)/);
assert.match(helperSource, /internal sealed class AutoSwitchConfig/);
assert.match(helperSource, /public AutoSwitchConfig Clamp\(\)/);
assert.match(helperSource, /internal sealed class AuthWriteResult/);
assert.match(helperSource, /internal sealed class ProcessRecord/);
assert.match(helperSource, /internal sealed class CodexRestoreTarget/);
assert.match(helperSource, /internal sealed class ProtocolProbeResult/);
assert.match(runtimeStatusSource, /internal sealed class CodexRuntimeStatus/);
assert.match(runtimeStatusSource, /public static CodexRuntimeStatus FromProtocol/);
assert.match(runtimeStatusSource, /public string ToJson\(\)/);
assert.match(runtimeStatusSource, /private static string JsonEscape/);
assert.doesNotMatch(helperMainSource, /private sealed class CodexRuntimeStatus/);
assert.match(desktopUiSource, /internal static class HelperDesktopUi/);
assert.match(desktopUiSource, /internal sealed class RoundedTrayMenu/);
assert.match(desktopUiSource, /internal sealed class SafeLogRichTextBox/);
assert.match(desktopUiSource, /internal sealed class OperationProgressForm/);
assert.match(desktopUiSource, /internal sealed class SoftButton/);
assert.match(desktopUiSource, /internal enum SoftButtonGlyph/);
assert.match(desktopUiSource, /SimulateRecoverForSelfTest/);
for (const movedClass of [
  "LogDisplayStyle",
  "RoundedTrayMenu",
  "SurfacePanel",
  "InfoBox",
  "SoftButton",
  "CloseGlyphButton",
  "RoundedProgressBar",
  "SafeLogRichTextBox",
  "OperationProgressForm",
]) {
  assert.doesNotMatch(helperMainSource, new RegExp(`private sealed class ${movedClass}`));
}
assert.ok(helperSource.includes("\\\\bAuthorization\\\\s*:\\\\s*Bearer"));
assert.match(helperSource, /cdh_\[REDACTED\]/);
assert.match(helperBuildScript, /CodexDockHelper-release\.json/);
assert.match(helperBuildScript, /portable\.zip/);
assert.match(helperBuildScript, /Compress-Archive/);
assert.match(helperBuildScript, /Get-ChildItem -LiteralPath \$PSScriptRoot -Filter "\*\.cs"/);
assert.match(helperBuildScript, /CodexAppServerProxy\.cs/);

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
  const healthBody = await health.clone().json().catch(() => ({}));

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
    await appendFileWithRetry(
      path.join(logDir, "helper.log"),
      `[diagnostics-redaction-test] access_token=${fakeSecrets[0]} refresh_token=${fakeSecrets[1]} deviceToken=${fakeSecrets[2]} Authorization: Bearer ${fakeSecrets[3]} url=http://localhost/callback?code=${fakeSecrets[4]}&state=${fakeSecrets[5]} jwt=${fakeSecrets[6]}\n`,
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
  if (helperPatchAtLeast(healthBody.version, 7)) {
    assert.equal(typeof body.lifecycle?.main_window_visible, "boolean");
    assert.equal(typeof body.lifecycle?.recent_log_count, "number");
  }
  assert.ok(Array.isArray(body.recent_logs));
  const text = JSON.stringify(body);
  for (const secret of fakeSecrets) {
    assert.equal(text.includes(secret), false, `diagnostics export leaked ${secret}`);
  }

  if (helperPatchAtLeast(healthBody.version, 7)) {
    const lifecycleResponse = await fetch("http://127.0.0.1:18766/api/lifecycle/self-test", {
      method: "POST",
      headers: { Origin: "https://codex.woai.pro" },
    });
    assert.equal(lifecycleResponse.status, 200);
    const lifecycle = await lifecycleResponse.json();
    assert.equal(lifecycle.ok, true);
    assert.match(lifecycle.marker || "", /^lifecycle-self-test-/);
    assert.equal(lifecycle.log_found, true);
    assert.equal(typeof lifecycle.log_view_fault_tested, "boolean");
    assert.equal(typeof lifecycle.log_view_fault_recovered, "boolean");
    if (lifecycle.log_view_fault_tested) assert.equal(lifecycle.log_view_fault_recovered, true);
    assert.equal(typeof lifecycle.tray?.visible, "boolean");
    assert.equal(typeof lifecycle.lifecycle?.helper_log_exists, "boolean");

    const updateResponse = await fetch("http://127.0.0.1:18766/api/update/check", {
      headers: { Origin: "https://codex.woai.pro" },
    });
    assert.equal(updateResponse.status, 200);
    const update = await updateResponse.json();
    assert.equal(update.ok, true);
    assert.equal(update.current_version, healthBody.version);
    assert.match(update.latest_version || "", /^\d+\.\d+\.\d+$/);
    assert.equal(typeof update.update_available, "boolean");
    assert.match(update.download_url || "", /^https:\/\/codex\.woai\.pro\/downloads\/CodexDockHelper\.exe$/);
    assert.match(update.sha256 || "", /^[A-F0-9]{64}$/);
  }
  console.log("helper-diagnostics live verification passed");
}

verifyLiveHelper().catch((error) => {
  console.error(error);
  process.exit(1);
});
