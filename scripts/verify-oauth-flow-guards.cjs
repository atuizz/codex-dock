const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const appSource = readFileSync(join(__dirname, "..", "app.js"), "utf8");

function includes(fragment, label) {
  assert.ok(appSource.includes(fragment), `missing OAuth guard: ${label}`);
}

function ordered(fragments, label) {
  let offset = -1;
  for (const fragment of fragments) {
    const next = appSource.indexOf(fragment, offset + 1);
    assert.ok(next > offset, `OAuth guard order failed for ${label}: ${fragment}`);
    offset = next;
  }
}

includes('const oauthPkceHistoryStorage = "codex-dock-oauth-pkce-history-v1";', "PKCE history storage key");
includes('const oauthFlowStorage = "codex-dock-oauth-flow-v1";', "resumable OAuth flow storage key");
includes("function readOauthPkceHistory()", "PKCE history reader");
includes("if (isFreshOauthPkce(payload)) history[key] = payload;", "history keeps only fresh PKCE entries");
includes(".slice(0, 12)", "history is bounded to prevent unbounded localStorage growth");
includes("history[stateValue] = payload;", "new authorization is stored by state");
includes("if (stateValue) return readOauthPkceHistory()[stateValue] || {};", "exchange resolves PKCE by returned state");
includes('throw new Error("OAuth code 已收到，但找不到对应授权链接的 PKCE 记录。请点“打开授权页面”重新授权，不要复用旧回调。");', "missing PKCE has one recovery action");
includes("forgetOauthPkce(returnedState || pkce.state);", "used OAuth code clears its PKCE record");
includes("function persistOauthFlow(flow = state.oauthFlow)", "waiting OAuth flow is persisted for page refresh");
includes("oauthCore.oauthFlowSnapshotStatus(flow, Date.now())", "flow persistence uses shared validation");
includes("function restoreOauthFlow()", "refresh/reopen restores unfinished OAuth flow");
includes("oauthCore.oauthFlowSnapshotStatus(localStorage.getItem(oauthFlowStorage), Date.now())", "restore reads validated snapshot");
includes("const pkce = oauthPkce(status.flow.state);", "restore requires matching PKCE verifier");
includes('toast("已恢复未完成的 OAuth 导入，本页继续等待回调。");', "restore explains resumed wait to users");
includes("restoreOauthFlow();", "init resumes OAuth flow after render");
includes("function oauthCallbackMatchesActiveFlow(callbackUrl)", "active-flow callback matcher");
includes("return oauthCore.callbackStateStatus(callbackUrl, expectedState, oauthRedirectUri).ok;", "callback matcher verifies state");
includes("function rejectMismatchedOauthCallback()", "mismatched callback rejection");
includes("收到的授权回调不属于当前这次登录", "mismatched callback copy explains stale flow");
includes("helperClient().oauthCallbackLatest(stateValue)", "Helper polling asks for the active state first");
includes("const latest = await latestOauthCallbackAny();", "polling inspects latest callback before accepting stale pending result");
includes("receivedAt >= startedAt - 3000", "polling ignores callbacks older than the current flow");
includes("isTrustedOauthCallbackOrigin(event.origin)", "postMessage callback origin is restricted");
includes('origin === "http://localhost:1455" || origin === "http://127.0.0.1:1455"', "only local Helper callback origins are trusted");

ordered([
  "const stateStatus = oauthCore.callbackStateStatus",
  "if (!stateStatus.ok) throw new Error(stateStatus.message);",
  "const providerError = oauthCore.providerErrorStatus(params, oauthRedirectUri);",
  "if (!providerError.ok) throw new Error(providerError.message);",
  "let usedOauthCode = false;",
], "state and provider error checks run before token exchange");

ordered([
  "const pkce = returnedState ? oauthPkce(returnedState) : oauthPkce();",
  "if (!pkce.verifier) throw new Error",
  "token = await exchangeOauthCode(code, pkce);",
  "forgetOauthPkce(returnedState || pkce.state);",
], "OAuth code exchange is bound to the matching PKCE record");

ordered([
  "state.oauthFlow = { ...state.oauthFlow, ...patch };",
  "renderOauthFlow();",
  "persistOauthFlow();",
], "OAuth flow persistence is updated when UI state changes");

ordered([
  "state.oauthFlow = { ...state.oauthFlow, ...status.flow, phase: \"waiting\" };",
  "setDrawer(true, { mode: \"oauth\" });",
  "startOauthFlowTimer();",
  "startOauthCallbackPolling();",
], "restored OAuth flow reopens the import drawer and resumes polling");

ordered([
  "if (!oauthCallbackMatchesActiveFlow(data.url))",
  "rejectMismatchedOauthCallback();",
  "stopOauthCallbackPolling();",
  "await handleOauthCallbackUrl(data.url, { autoImport: true });",
], "postMessage callbacks reject stale state before auto import");

console.log("oauth-flow guards verification passed");
