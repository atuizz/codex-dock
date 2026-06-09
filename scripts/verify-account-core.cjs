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
assert.equal(parsed[0].session.accountIdentityKey, "account:acct-team-a");

console.log("account-core verification passed");
