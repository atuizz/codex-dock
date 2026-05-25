import assert from "node:assert/strict";
import {
  DEFAULT_USAGE_REFRESH_SETTINGS,
  ensureCloudRefreshAllowance,
  handleUsageRoutes,
  mapCloudUsagePayload,
  normalizeUsageRefreshSettings,
} from "../cloud-worker/worker-usage.js";
import {
  ApiError,
  encryptSecret,
} from "../cloud-worker/worker-shared.js";

function jwt(payload) {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function request(path, method = "GET", body = null) {
  const init = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://codex.example.test${path}`, init);
}

class FakeD1 {
  constructor(account) {
    this.account = account;
    this.userSettings = null;
    this.snapshots = [];
    this.accountPlan = account.plan_type;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("SELECT usage_refresh_json FROM user_settings")) {
      return this.db.userSettings ? { usage_refresh_json: this.db.userSettings } : null;
    }
    if (this.sql.includes("SELECT COUNT(*) AS total FROM usage_snapshots")) {
      const [userId, startAt] = this.params;
      const total = this.db.snapshots.filter((snapshot) => (
        snapshot.user_id === userId
        && ["cloud-worker", "auto-cloud-fallback"].includes(snapshot.refresh_source)
        && snapshot.created_at >= startAt
      )).length;
      return { total };
    }
    if (this.sql.includes("FROM accounts a") && this.sql.includes("JOIN account_secrets")) {
      const [accountId] = this.params;
      return accountId === this.db.account.id ? this.db.account : null;
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO user_settings")) {
      this.db.userSettings = this.params[1];
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO usage_snapshots")) {
      const [id, accountId, userId, usageJson, ok, error, source, kind, createdAt] = this.params;
      this.db.snapshots.push({
        id,
        account_id: accountId,
        user_id: userId,
        usage_json: usageJson,
        ok,
        error,
        refresh_source: source,
        refresh_kind: kind,
        created_at: createdAt,
      });
      return { success: true };
    }
    if (this.sql.includes("UPDATE accounts SET plan_type")) {
      this.db.accountPlan = this.params[0] || this.db.accountPlan;
      return { success: true };
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`);
  }
}

const normalized = normalizeUsageRefreshSettings({
  usageRefreshMode: "bad",
  cloudUsageRefreshEnabled: "true",
  helperFallbackToCloud: 1,
  usageRefreshConcurrency: 20,
  usageRefreshIntervalMs: 10,
});
assert.equal(normalized.usageRefreshMode, "helper");
assert.equal(normalized.cloudUsageRefreshEnabled, true);
assert.equal(normalized.helperFallbackToCloud, true);
assert.equal(normalized.usageRefreshConcurrency, 3);
assert.equal(normalized.usageRefreshIntervalMs, 1000);
assert.equal(DEFAULT_USAGE_REFRESH_SETTINGS.cloudUsageRefreshEnabled, false);

const mapped = mapCloudUsagePayload({
  plan_type: "chatgptplus",
  windows: [
    { limit_window_seconds: 18000, used_percent: 31, reset_at: "five-reset" },
    { limit_window_seconds: 604800, used_percent: 47, reset_at: "week-reset" },
  ],
}, "", "cloud-worker");
assert.equal(mapped.plan_type, "plus");
assert.equal(mapped.five_hour.used_percent, 31);
assert.equal(mapped.one_week.used_percent, 47);
assert.equal(mapped.refresh_source, "cloud-worker");

const accessToken = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": { chatgpt_account_id: "upstream-account" },
});
const env = {
  TOKEN_ENCRYPTION_KEY: "worker-usage-test-secret",
  CLOUD_USAGE_REFRESH_DAILY_LIMIT: "2",
  DB: null,
};
env.DB = new FakeD1({
  id: "account-1",
  plan_type: "plus",
  encrypted_auth_json: await encryptSecret(env, {
    session: { tokens: { access_token: accessToken, account_id: "upstream-account", refresh_token: "rt-secret" } },
  }),
});
const user = { id: "user-1" };
const audits = [];
const writeAudit = async (_env, _user, entry) => audits.push(entry);
let upstreamAuthorization = "";
const fetchImpl = async (_url, init) => {
  upstreamAuthorization = init.headers.Authorization;
  return new Response(JSON.stringify({
    plan_type: "plus",
    windows: [
      { limit_window_seconds: 18000, used_percent: 12 },
      { limit_window_seconds: 604800, used_percent: 23 },
    ],
  }), { status: 200 });
};

const initial = await handleUsageRoutes(request("/api/settings/usage-refresh"), env, user, "/api/settings/usage-refresh", { writeAudit });
assert.equal((await initial.json()).settings.usageRefreshMode, "helper");

const saved = await handleUsageRoutes(request("/api/settings/usage-refresh", "PATCH", {
  settings: { usageRefreshMode: "auto", cloudUsageRefreshEnabled: true, helperFallbackToCloud: true },
}), env, user, "/api/settings/usage-refresh", { writeAudit });
assert.equal((await saved.json()).settings.helperFallbackToCloud, true);
assert.equal(audits.at(-1).action, "usage-refresh-settings");

const refreshed = await handleUsageRoutes(request("/api/accounts/account-1/usage/refresh-cloud", "POST", {
  autoFallback: true,
  audit: false,
}), env, user, "/api/accounts/account-1/usage/refresh-cloud", { writeAudit, fetchImpl });
assert.equal(refreshed.status, 200);
const refreshedBody = await refreshed.json();
assert.equal(refreshedBody.source, "auto-cloud-fallback");
assert.equal(refreshedBody.usage.refresh_source, "auto-cloud-fallback");
assert.equal(env.DB.snapshots[0].refresh_source, "auto-cloud-fallback");
assert.match(upstreamAuthorization, /^Bearer /);
assert.equal(audits.filter((item) => item.action === "usage-refresh").length, 0);

env.DB.snapshots.push({
  user_id: "user-1",
  refresh_source: "cloud-worker",
  created_at: new Date().toISOString(),
});
await assert.rejects(
  () => ensureCloudRefreshAllowance(env, user),
  (error) => error instanceof ApiError && error.code === "cloud_usage_daily_limit",
);

console.log("worker-usage verification passed");
