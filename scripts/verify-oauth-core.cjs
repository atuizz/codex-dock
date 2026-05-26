const assert = require("node:assert/strict");
const oauth = require("../oauth-core.js");

const redirect = "http://localhost:1455/auth/callback";

assert.equal(
  oauth.normalizeOauthCallbackValue("localhost:1455/auth/callback?code=abc&state=s1", redirect),
  "http://localhost:1455/auth/callback?code=abc&state=s1",
);
assert.equal(
  oauth.normalizeOauthCallbackValue("code=abc&state=s1", redirect),
  "http://localhost:1455/auth/callback?code=abc&state=s1",
);
assert.equal(
  oauth.normalizeOauthCallbackValue("授权返回：http://localhost:1455/auth/callback?code=abc&amp;state=s1。", redirect),
  "http://localhost:1455/auth/callback?code=abc&state=s1",
);
assert.equal(
  oauth.normalizeOauthCallbackValue("error=access_denied&error_description=User%20cancelled&state=s1", redirect),
  "http://localhost:1455/auth/callback?error=access_denied&error_description=User%20cancelled&state=s1",
);
assert.equal(
  oauth.callbackParams("http://localhost:1455/auth/callback#access_token=at&refresh_token=rt", redirect).get("refresh_token"),
  "rt",
);

const mismatch = oauth.callbackStateStatus("http://localhost:1455/auth/callback?code=abc&state=old", "fresh", redirect);
assert.equal(mismatch.ok, false);
assert.equal(mismatch.code, "oauth_state_mismatch");
assert.match(mismatch.message, /重新打开授权页面/);
const missingState = oauth.callbackStateStatus("http://localhost:1455/auth/callback?code=abc", "fresh", redirect);
assert.equal(missingState.ok, false);
assert.equal(missingState.code, "oauth_state_missing");
assert.match(missingState.message, /重新打开授权页面/);
assert.equal(oauth.callbackStateStatus("http://localhost:1455/auth/callback?code=abc&state=fresh", "fresh", redirect).ok, true);
assert.equal(oauth.callbackStateStatus("http://localhost:1455/auth/callback?access_token=at", "", redirect).ok, true);

const providerDenied = oauth.providerErrorStatus("http://localhost:1455/auth/callback?error=access_denied&error_description=User%20cancelled&state=fresh", redirect);
assert.equal(providerDenied.ok, false);
assert.equal(providerDenied.code, "oauth_provider_error");
assert.match(providerDenied.message, /授权未完成/);
assert.match(providerDenied.message, /重新打开授权页面/);
assert.doesNotMatch(providerDenied.message, /没有收到有效授权结果/);
const providerGeneric = oauth.providerErrorStatus("error=server_error&error_description=Temporary%20outage", redirect);
assert.equal(providerGeneric.ok, false);
assert.match(providerGeneric.message, /Temporary outage/);
assert.equal(oauth.providerErrorStatus("code=abc&state=fresh", redirect).ok, true);

assert.equal(oauth.exchangeFailureMessage("invalid_grant: code already used"), "授权回调已失效、已被使用，或和当前授权链接不匹配");
assert.equal(oauth.exchangeFailureMessage("network down"), "network down");
assert.match(oauth.emptyCallbackMessage(false), /打开授权页面/);
assert.doesNotMatch(oauth.emptyCallbackMessage(false), /没有 token 或 code/);
assert.match(oauth.emptyCallbackMessage(true), /没有换到可用授权/);

const now = Date.now();
const resumable = oauth.oauthFlowSnapshotStatus({
  active: true,
  phase: "opening",
  state: "fresh-state",
  authUrl: "https://auth.openai.com/oauth/authorize?client_id=app&state=fresh-state",
  startedAt: now - 1000,
  expiresAt: now + 60_000,
}, now);
assert.equal(resumable.ok, true);
assert.equal(resumable.code, "oauth_flow_resumable");
assert.equal(resumable.flow.phase, "waiting");
assert.equal(resumable.flow.state, "fresh-state");
assert.equal(oauth.oauthFlowSnapshotStatus({ active: true, phase: "success" }, now).code, "oauth_flow_not_resumable");
assert.equal(oauth.oauthFlowSnapshotStatus({ active: true, phase: "waiting", state: "s", authUrl: "https://example.com/oauth/authorize", startedAt: now, expiresAt: now + 1 }, now).code, "oauth_authorize_url_invalid");
assert.equal(oauth.oauthFlowSnapshotStatus({ active: true, phase: "waiting", state: "s", authUrl: "https://auth.openai.com/oauth/authorize", startedAt: now - 10_000, expiresAt: now - 1 }, now).code, "oauth_flow_expired");
assert.equal(oauth.oauthFlowSnapshotStatus("{bad-json", now).code, "oauth_flow_missing");

console.log("oauth-core verification passed");
