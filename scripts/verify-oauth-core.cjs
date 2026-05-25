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

assert.equal(oauth.exchangeFailureMessage("invalid_grant: code already used"), "授权回调已失效、已被使用，或和当前授权链接不匹配");
assert.equal(oauth.exchangeFailureMessage("network down"), "network down");
assert.match(oauth.emptyCallbackMessage(false), /打开授权页面/);
assert.doesNotMatch(oauth.emptyCallbackMessage(false), /没有 token 或 code/);
assert.match(oauth.emptyCallbackMessage(true), /没有换到可用授权/);

console.log("oauth-core verification passed");
