const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const context = {
  TextDecoder,
  Uint8Array,
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  crypto: { randomUUID: () => "test-id" },
};
context.window = context;
vm.createContext(context);
vm.runInContext(readFileSync("account-core.js", "utf8"), context);

const accessToken = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-team-shared",
    chatgpt_account_user_id: "user-team-shared",
    chatgpt_plan_type: "team",
  },
  "https://api.openai.com/profile": {
    email: "team@example.com",
  },
});

const parsed = context.CodexAccountCore.parseImportEntries({
  accounts: [{
    email: "team@example.com",
    tokens: {
      access_token: accessToken,
      refresh_token: "rt-team",
      account_id: "acct-team-a",
    },
  }],
});

assert.equal(parsed.length, 1);
assert.equal(parsed[0].ok, true);
assert.equal(parsed[0].session.tokens.account_id, "acct-team-a");
assert.equal(parsed[0].session.email, "team@example.com");
assert.equal(parsed[0].session.accountUserId, "user-team-shared");
assert.equal(parsed[0].session.accountScopeId, "acct-team-shared");
assert.equal(parsed[0].session.accountIdentityKey, "account:user-team-shared|scope:acct-team-shared");

const secondAccessToken = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-team-shared",
    chatgpt_account_user_id: "user-team-other",
    chatgpt_plan_type: "team",
  },
  "https://api.openai.com/profile": {
    email: "other-team@example.com",
  },
});
const teamEntries = context.CodexAccountCore.parseImportEntries({
  accounts: [
    { tokens: { access_token: accessToken, refresh_token: "rt-a", account_id: "acct-team-shared" } },
    { tokens: { access_token: secondAccessToken, refresh_token: "rt-b", account_id: "acct-team-shared" } },
  ],
});
assert.equal(new Set(teamEntries.map((entry) => entry.session.accountIdentityKey)).size, 2);

const normalizedTeamUsage = context.CodexAccountCore.normalizeUsage({
  plan_type: "team",
  fetched_at: 1,
  primary_window: { used_percent: 12, limit_window_seconds: 2628000 },
});
assert.equal(normalizedTeamUsage.primary_window.remaining_percent, 88);
assert.equal(normalizedTeamUsage.primary_window.window_seconds, 2628000);

console.log("account-core verification passed");
