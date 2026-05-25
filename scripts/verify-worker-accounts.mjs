import assert from "node:assert/strict";
import {
  accountSummary,
  assertSwitchableSession,
  candidateDecision,
  candidateDiagnostic,
  candidateReasons,
  accountCodexStatus,
  handleAccounts,
  isSwitchTriggerUsage,
  normalizeSession,
  normalizeUsage,
  summarizeCandidateBlocks,
  syncCurrentAuthSecret,
  switchPayloadForAccount,
  usageFresh,
} from "../cloud-worker/worker-accounts.js";
import {
  ApiError,
  encryptSecret,
} from "../cloud-worker/worker-shared.js";

function jwt(payload) {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const accessToken = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-cloud-1",
    chatgpt_plan_type: "chatgptplus",
  },
  "https://api.openai.com/profile": {
    email: "plan@example.com",
  },
});
const expiredToken = jwt({ exp: Math.floor(Date.now() / 1000) - 60 });

const session = normalizeSession({
  tokens: {
    access_token: accessToken,
    refresh_token: "rt-live",
  },
  profile: { plan: "free" },
});
assert.equal(session.email, "plan@example.com");
assert.equal(session.profile.plan, "plus");
assert.equal(session.tokens.account_id, "acct-cloud-1");
assert.equal(session.tokens.refresh_token, "rt-live");

assert.throws(
  () => normalizeSession({ tokens: { refresh_token: "rt-only" } }),
  /missing access_token/,
);

assert.equal(normalizeUsage(null, "plus").status, "未刷新");
const usage = normalizeUsage({
  planType: "pro",
  fiveHour: { usedPercent: 97 },
  oneWeek: { remainingPercent: 72 },
}, "plus");
assert.equal(usage.plan_type, "pro");
assert.deepEqual(isSwitchTriggerUsage(usage, "", { fiveHourThreshold: 5, oneWeekThreshold: 5 }), {
  yes: true,
  reason: "5H 剩余 3%",
});
assert.deepEqual(isSwitchTriggerUsage(normalizeUsage({ error: "429 rate limit" }), "", { fiveHourThreshold: 5, oneWeekThreshold: 5 }), {
  yes: true,
  reason: "当前账号不可用或已限流",
});
assert.deepEqual(isSwitchTriggerUsage(normalizeUsage({ error: "Your access token could not be refreshed because your refresh token was already used." }), "", { fiveHourThreshold: 5, oneWeekThreshold: 5 }), {
  yes: true,
  reason: "当前账号不可用或已限流",
});
assert.deepEqual(isSwitchTriggerUsage(normalizeUsage({ error: "额度已耗尽" }), "", { fiveHourThreshold: 5, oneWeekThreshold: 5 }), {
  yes: true,
  reason: "当前账号不可用或已限流",
});
assert.deepEqual(isSwitchTriggerUsage(normalizeUsage({ fiveHour: { remainingPercent: 66 } }), "", { fiveHourThreshold: 5, oneWeekThreshold: 5 }), {
  yes: false,
  reason: "",
});

const settings = {
  paidOnly: true,
  allowAt: false,
  showExperimentalAt: false,
  avoidCurrent: true,
  avoidLow5h: true,
  avoidLow7d: true,
  fiveHourThreshold: 5,
  oneWeekThreshold: 5,
  cooldownMinutes: 10,
  preferRt: true,
};
const experimentalSettings = { ...settings, allowAt: true, showExperimentalAt: true };
const secretUpdatedAt = new Date(Date.now() - 10_000).toISOString();
const freshUsageAt = new Date(Date.now() - 60_000).toISOString();
const staleUsageAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
const viable = accountSummary({
  id: "a1",
  name: "Primary",
  email: "primary@example.com",
  group_name: "默认",
  priority: "primary",
  chatgpt_account_id: "acct-a1",
  plan_type: "plus",
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  has_refresh_token: 1,
  created_at: "created",
  updated_at: "updated",
  secret_updated_at: secretUpdatedAt,
  last_switch_at: "",
}, {
  refreshed_at: freshUsageAt,
  plan_type: "plus",
  five_hour: { remainingPercent: 86 },
  one_week: { usedPercent: 10 },
});
assert.equal(viable.credentialKind, "rt");
assert.equal(viable.codexUsable, true);
assert.equal(viable.codexBlockReason, "");
const current = { ...viable, id: "current", accountId: "acct-current" };
const free = { ...viable, id: "free", planType: "free", accountId: "acct-free" };
const low = { ...viable, id: "low", accountId: "acct-low", usage: normalizeUsage({ refreshed_at: freshUsageAt, fiveHour: { remainingPercent: 1 } }) };
const staleLow = { ...viable, id: "stale-low", accountId: "acct-stale-low", usage: normalizeUsage({ refreshed_at: staleUsageAt, fiveHour: { remainingPercent: 1 } }) };
const expiredAtOnly = { ...viable, id: "expired", accountId: "acct-expired", hasRefreshToken: false, expiresAt: new Date(Date.now() - 1000).toISOString() };
const switchedRt = { ...viable, id: "switched-rt", accountId: "acct-switched", secretUpdatedAt: new Date(Date.now() - 1_200_000).toISOString(), lastSwitchAt: new Date(Date.now() - 900_000).toISOString() };
const invalidRt = { ...viable, id: "invalid-rt", accountId: "acct-invalid", usage: normalizeUsage({ error: "invalid_grant" }) };
const hardFailed = { ...viable, id: "failed", accountId: "acct-failed", usage: normalizeUsage({ error: "account suspended" }) };
const chineseHardFailed = { ...viable, id: "cn-failed", accountId: "acct-cn-failed", usage: normalizeUsage({ error: "账号已停用" }) };
const cooldown = { ...viable, id: "cooldown", accountId: "acct-cooldown", secretUpdatedAt: new Date(Date.now() + 1000).toISOString(), lastSwitchAt: new Date().toISOString() };

assert.equal(candidateDecision(viable, settings, { currentAccountId: "other" }).eligible, true);
assert.match(candidateReasons(viable, settings), /PLUS、可用 RT、5H 86%/);
assert.equal(candidateDecision(current, settings, { currentAccountId: "acct-current" }).blocked, "避开当前账号");
assert.equal(candidateDecision(free, settings, {}).blocked, "已开启仅付费账号");
assert.equal(candidateDecision(low, settings, {}).blocked, "5H 剩余 1%");
assert.equal(usageFresh(staleLow.usage), false);
assert.equal(candidateDecision(staleLow, settings, {}).eligible, true);
assert.match(candidateReasons(staleLow, settings), /额度待刷新/);
assert.equal(accountCodexStatus(expiredAtOnly).codexBlockReason, "at_unsupported");
assert.equal(candidateDecision(expiredAtOnly, settings, {}).blocked, "AT 账号当前不支持 Codex 使用");
assert.equal(candidateDecision(expiredAtOnly, experimentalSettings, {}).blocked, "Token 已过期且无 RT");
assert.equal(accountCodexStatus(switchedRt).codexBlockReason, "");
assert.equal(candidateDecision(switchedRt, settings, {}).eligible, true);
assert.equal(candidateDecision(invalidRt, settings, {}).blocked, "RT 已失效");
assert.equal(candidateDecision(hardFailed, settings, {}).blocked, "账号不可用或已失效");
assert.equal(candidateDecision(chineseHardFailed, settings, {}).blocked, "账号不可用或已失效");
assert.equal(candidateDecision(cooldown, settings, {}).blocked, "切换冷却 10 分钟内");

const decisions = [viable, free, low, expiredAtOnly].map((account) => candidateDecision(account, settings, {}));
assert.match(summarizeCandidateBlocks(decisions), /可用 1/);
assert.match(summarizeCandidateBlocks(decisions), /已开启仅付费账号 1/);
const diagnostic = candidateDiagnostic(candidateDecision(low, settings, {}));
assert.equal(diagnostic.fiveHour, 1);
assert.equal(diagnostic.blocked, "5H 剩余 1%");
assert.equal(diagnostic.credentialKind, "rt");
const staleDiagnostic = candidateDiagnostic(candidateDecision(staleLow, settings, {}));
assert.equal(staleDiagnostic.usageFresh, false);
assert.equal(staleDiagnostic.fiveHour, 1);
assert.equal(staleDiagnostic.blocked, "");

assert.throws(
  () => assertSwitchableSession(normalizeSession({ tokens: { access_token: expiredToken } })),
  (error) => error instanceof ApiError && error.status === 409 && error.code === "account_token_expired",
);

class SecretDB {
  constructor(row) {
    this.row = row;
  }

  prepare(sql) {
    assert.match(sql, /FROM account_secrets/);
    return {
      bind: () => ({
        first: async () => this.row,
      }),
    };
  }
}

const env = { TOKEN_ENCRYPTION_KEY: "worker-account-secret", DB: null };
env.DB = new SecretDB({
  ...viable,
  group_name: viable.group,
  chatgpt_account_id: viable.accountId,
  plan_type: viable.planType,
  expires_at: viable.expiresAt,
  has_refresh_token: 1,
  secret_updated_at: secretUpdatedAt,
  encrypted_auth_json: await encryptSecret(env, { session }),
});
const payload = await switchPayloadForAccount(env, { id: "user-1" }, "a1");
assert.equal(payload.tokens.access_token, accessToken);
assert.equal(payload.tokens.refresh_token, "rt-live");
assert.equal(payload.tokens.account_id, "acct-cloud-1");

const atOnlySession = normalizeSession({ tokens: { access_token: accessToken } });
env.DB = new SecretDB({
  ...viable,
  id: "at-only",
  has_refresh_token: 0,
  secret_updated_at: secretUpdatedAt,
  encrypted_auth_json: await encryptSecret(env, { session: atOnlySession }),
});
await assert.rejects(
  () => switchPayloadForAccount(env, { id: "user-1" }, "at-only"),
  (error) => error instanceof ApiError && error.code === "account_at_not_supported",
);
const atPayload = await switchPayloadForAccount(env, { id: "user-1" }, "at-only", { allowAtExperimental: true });
assert.equal(atPayload.tokens.refresh_token, "rt_mock_token");

class RouteDB {
  constructor(rows, settings = {}) {
    this.rows = rows;
    this.settings = settings;
  }

  prepare(sql) {
    if (/SELECT auto_switch_json FROM user_settings/.test(sql)) {
      return {
        bind: () => ({
          first: async () => (this.settings.auto_switch_json ? this.settings : null),
        }),
      };
    }
    if (/SELECT \* FROM accounts/.test(sql)) {
      return {
        bind: (accountId, userId) => ({
          first: async () => this.rows.find((row) => row.id === accountId && row.user_id === userId) || null,
        }),
      };
    }
    if (/FROM account_secrets/.test(sql)) {
      return {
        bind: (accountId, userId) => ({
          first: async () => this.rows.find((row) => row.id === accountId && row.user_id === userId) || null,
        }),
      };
    }
    throw new Error(`unexpected route SQL: ${sql}`);
  }
}

function post(path, body) {
  return new Request(`https://codex.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

const routeAudits = [];
const writeAudit = async (_env, auditUser, body) => {
  routeAudits.push({ userId: auditUser.id, ...body });
};
const rtRouteRow = {
  ...viable,
  user_id: "user-1",
  group_name: viable.group,
  chatgpt_account_id: viable.accountId,
  plan_type: viable.planType,
  expires_at: viable.expiresAt,
  has_refresh_token: 1,
  secret_updated_at: secretUpdatedAt,
  usage_json: JSON.stringify(viable.usage),
  encrypted_auth_json: await encryptSecret(env, { session }),
};
env.DB = new RouteDB([rtRouteRow]);
const manualPayload = await handleAccounts(post("/api/accounts/a1/switch-payload", {
  deviceKey: "desktop-1",
}), env, { id: "user-1" }, "/api/accounts/a1/switch-payload", { writeAudit });
assert.equal(manualPayload.status, 200);
const manualPayloadBody = await manualPayload.json();
assert.equal(manualPayloadBody.ok, true);
assert.equal(manualPayloadBody.allowAtExperimental, false);
assert.equal(manualPayloadBody.authJson.tokens.refresh_token, "rt-live");
assert.equal(routeAudits.at(-1).action, "switch-payload");
assert.equal(routeAudits.at(-1).result, "payload-issued");
assert.equal(routeAudits.at(-1).accountId, "a1");
assert.equal(routeAudits.at(-1).metadata.allowAtExperimental, false);
assert.doesNotMatch(JSON.stringify(routeAudits.at(-1)), /rt-live|access_token|refresh_token/i);

const atRouteRow = {
  ...rtRouteRow,
  id: "at-only",
  has_refresh_token: 0,
  encrypted_auth_json: await encryptSecret(env, { session: atOnlySession }),
};
env.DB = new RouteDB([atRouteRow]);
await assert.rejects(
  () => handleAccounts(post("/api/accounts/at-only/switch-payload", {}), env, { id: "user-1" }, "/api/accounts/at-only/switch-payload", { writeAudit }),
  (error) => error instanceof ApiError && error.code === "account_at_not_supported",
);

env.DB = new RouteDB([atRouteRow], {
  auto_switch_json: JSON.stringify({ allowAt: true, showExperimentalAt: true }),
});
const experimentalPayload = await handleAccounts(post("/api/accounts/at-only/switch-payload", {
  allowAtExperimental: true,
}), env, { id: "user-1" }, "/api/accounts/at-only/switch-payload", { writeAudit });
assert.equal(experimentalPayload.status, 200);
const experimentalPayloadBody = await experimentalPayload.json();
assert.equal(experimentalPayloadBody.allowAtExperimental, true);
assert.equal(experimentalPayloadBody.authJson.tokens.refresh_token, "rt_mock_token");
assert.equal(routeAudits.at(-1).metadata.allowAtExperimental, true);

class SyncDB {
  constructor(row) {
    this.row = row;
    this.updatedArgs = null;
    this.secretArgs = null;
  }

  prepare(sql) {
    if (/SELECT a\.id/.test(sql)) {
      return {
        bind: () => ({
          first: async () => this.row,
        }),
      };
    }
    if (/UPDATE accounts/.test(sql)) {
      return {
        bind: (...args) => ({
          run: async () => {
            this.updatedArgs = args;
          },
        }),
      };
    }
    if (/INSERT INTO account_secrets/.test(sql)) {
      return {
        bind: (...args) => ({
          run: async () => {
            this.secretArgs = args;
          },
        }),
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

const oldRtSession = normalizeSession({ tokens: { access_token: accessToken, refresh_token: "rt-old" } });
const lastSwitchAt = new Date().toISOString();
const earlyLocalUpdatedAt = lastSwitchAt;
const sameRtDb = new SyncDB({
  id: "a1",
  plan_type: "plus",
  last_switch_at: lastSwitchAt,
  encrypted_auth_json: await encryptSecret(env, { session: oldRtSession }),
});
env.DB = sameRtDb;
const sameRtSync = await syncCurrentAuthSecret(env, { id: "user-1" }, {
  tokens: { access_token: accessToken, refresh_token: "rt-old" },
}, { localUpdatedAt: earlyLocalUpdatedAt });
assert.equal(sameRtSync.synced, false);
assert.equal(sameRtSync.reason, "本机 auth 与云端 RT 相同，无需同步");
assert.equal(sameRtDb.updatedArgs, null);

const sameLateDb = new SyncDB({
  id: "a1",
  plan_type: "plus",
  last_switch_at: lastSwitchAt,
  encrypted_auth_json: await encryptSecret(env, { session: oldRtSession }),
});
env.DB = sameLateDb;
const sameLateSync = await syncCurrentAuthSecret(env, { id: "user-1" }, {
  tokens: { access_token: accessToken, refresh_token: "rt-old" },
}, { localUpdatedAt: new Date(Date.now() + 60_000).toISOString() });
assert.equal(sameLateSync.synced, false);
assert.equal(sameLateSync.reason, "本机 auth 与云端 RT 相同，无需同步");
assert.equal(sameLateDb.updatedArgs, null);

const newRtDb = new SyncDB({
  id: "a1",
  plan_type: "plus",
  last_switch_at: lastSwitchAt,
  encrypted_auth_json: await encryptSecret(env, { session: oldRtSession }),
});
env.DB = newRtDb;
const newRtSync = await syncCurrentAuthSecret(env, { id: "user-1" }, {
  tokens: { access_token: accessToken, refresh_token: "rt-new" },
}, { localUpdatedAt: earlyLocalUpdatedAt });
assert.equal(newRtSync.synced, true);
assert.ok(newRtDb.updatedArgs);
assert.ok(newRtDb.secretArgs);

console.log("worker-accounts verification passed");
