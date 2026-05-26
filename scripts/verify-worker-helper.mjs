import assert from "node:assert/strict";
import {
  DEVICE_TOKEN_ROTATE_AFTER_SECONDS,
  DEVICE_TOKEN_TTL_SECONDS,
  HELPER_HEARTBEAT_SECONDS,
  handleDeviceRoutes,
  handleHelperAutoSwitch,
  helperTokenNeedsRotation,
  helperTokenStatus,
  insertDeviceToken,
  requireHelperDevice,
} from "../cloud-worker/worker-helper.js";
import {
  normalizeAutoSwitchSettings,
  readAutoSwitchSettings,
  saveAutoSwitchSettings,
} from "../cloud-worker/worker-settings.js";
import {
  encryptSecret,
  sha256,
} from "../cloud-worker/worker-shared.js";

class FakeD1 {
  constructor() {
    this.users = [{
      id: "user-1",
      email: "owner@example.com",
      role: "user",
      status: "active",
      created_at: "created",
      updated_at: "updated",
      last_login_at: "login",
    }];
    this.devices = [];
    this.deviceTokens = [];
    this.userSettings = [];
    this.accounts = [];
    this.accountSecrets = [];
    this.usageSnapshots = [];
    this.queries = [];
  }

  prepare(sql) {
    this.queries.push(sql);
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
    const sql = this.sql;
    if (sql.includes("SELECT auto_switch_json FROM user_settings")) {
      const [userId] = this.params;
      return this.db.userSettings.find((item) => item.user_id === userId) || null;
    }
    if (sql.includes("FROM device_tokens") && sql.includes("JOIN users")) {
      const [tokenHash] = this.params;
      const token = this.db.deviceTokens.find((item) => (
        item.token_hash === tokenHash
        && ["active", "retiring"].includes(item.status)
        && item.revoked_at === ""
      ));
      if (!token) return null;
      const user = this.db.users.find((item) => item.id === token.user_id);
      if (!user) return null;
      return {
        token_id: token.id,
        device_key: token.device_key,
        device_name: token.name,
        token_status: token.status,
        token_created_at: token.created_at,
        token_last_seen_at: token.last_seen_at,
        token_expires_at: token.expires_at,
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at,
      };
    }
    if (sql.includes("FROM account_secrets s") && sql.includes("JOIN accounts a")) {
      const [accountId, userId] = this.params;
      const secret = this.db.accountSecrets.find((item) => item.account_id === accountId && item.user_id === userId);
      const account = this.db.accounts.find((item) => item.id === accountId && item.user_id === userId);
      if (!secret || !account) return null;
      const usage = latestUsageSnapshot(this.db, accountId);
      return {
        ...account,
        encrypted_auth_json: secret.encrypted_auth_json,
        secret_updated_at: secret.updated_at,
        usage_json: usage?.usage_json || null,
        usage_created_at: usage?.created_at || "",
      };
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async all() {
    const sql = this.sql;
    if (sql.includes("SELECT * FROM devices")) {
      const [userId] = this.params;
      return { results: this.db.devices.filter((item) => item.user_id === userId) };
    }
    if (sql.includes("FROM accounts a")) {
      const [userId] = this.params;
      return {
        results: this.db.accounts
          .filter((item) => item.user_id === userId)
          .map((account) => {
            const secret = this.db.accountSecrets.find((item) => item.account_id === account.id && item.user_id === account.user_id);
            const usage = latestUsageSnapshot(this.db, account.id);
            return {
              ...account,
              secret_updated_at: secret?.updated_at || "",
              usage_json: usage?.usage_json || null,
              usage_created_at: usage?.created_at || "",
            };
          }),
      };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    if (sql.includes("INSERT INTO user_settings")) {
      const [userId, settingsJson, createdAt, updatedAt] = this.params;
      const existing = this.db.userSettings.find((item) => item.user_id === userId);
      if (existing) {
        existing.auto_switch_json = settingsJson;
        existing.updated_at = updatedAt;
      } else {
        this.db.userSettings.push({ user_id: userId, auto_switch_json: settingsJson, created_at: createdAt, updated_at: updatedAt });
      }
      return { success: true };
    }
    if (sql.includes("INSERT INTO device_tokens")) {
      const [id, userId, deviceKey, tokenHash, name, createdAt, lastSeenAt, expiresAt, rotatedFrom] = this.params;
      this.db.deviceTokens.push({
        id,
        user_id: userId,
        device_key: deviceKey,
        token_hash: tokenHash,
        name,
        status: "active",
        created_at: createdAt,
        last_seen_at: lastSeenAt,
        expires_at: expiresAt,
        rotated_from: rotatedFrom,
        revoked_at: "",
      });
      return { success: true };
    }
    if (sql.includes("INSERT INTO devices")) {
      const [id, userId, deviceKey, name, helperOnline, helperBase, helperVersion, helperBuildDate, createdAt, lastSeenAt] = this.params;
      const existing = this.db.devices.find((item) => item.user_id === userId && item.device_key === deviceKey);
      if (existing) {
        existing.name = name;
        existing.helper_online = helperOnline;
        existing.helper_base = helperBase;
        existing.helper_version = helperVersion;
        existing.helper_build_date = helperBuildDate;
        existing.last_seen_at = lastSeenAt;
      } else {
        this.db.devices.push({
          id,
          user_id: userId,
          device_key: deviceKey,
          name,
          helper_online: helperOnline,
          helper_base: helperBase,
          helper_version: helperVersion,
          helper_build_date: helperBuildDate,
          created_at: createdAt,
          last_seen_at: lastSeenAt,
        });
      }
      return { success: true };
    }
    if (sql.includes("UPDATE device_tokens SET status = 'revoked'")) {
      const [revokedAt, userId, deviceKey] = this.params;
      for (const token of this.db.deviceTokens) {
        if (token.user_id === userId && token.device_key === deviceKey && ["active", "retiring"].includes(token.status)) {
          token.status = "revoked";
          token.revoked_at = revokedAt;
        }
      }
      return { success: true };
    }
    if (sql.includes("UPDATE device_tokens SET status = 'retiring'")) {
      const [expiresAt, tokenId] = this.params;
      const token = this.db.deviceTokens.find((item) => item.id === tokenId && item.status === "active");
      if (token) {
        token.status = "retiring";
        token.expires_at = expiresAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE device_tokens SET status = 'expired'")) {
      const [revokedAt, tokenId] = this.params;
      const token = this.db.deviceTokens.find((item) => item.id === tokenId);
      if (token) {
        token.status = "expired";
        token.revoked_at = revokedAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE device_tokens SET last_seen_at = ?, expires_at = ?")) {
      const [lastSeenAt, expiresAt, tokenId] = this.params;
      const token = this.db.deviceTokens.find((item) => item.id === tokenId);
      if (token) {
        token.last_seen_at = lastSeenAt;
        token.expires_at = expiresAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE devices SET helper_online = 0")) {
      const [lastSeenAt, userId, deviceKey] = this.params;
      const device = this.db.devices.find((item) => item.user_id === userId && item.device_key === deviceKey);
      if (device) {
        device.helper_online = 0;
        device.last_seen_at = lastSeenAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE devices SET helper_online = 1")) {
      const [lastSeenAt, userId, deviceKey] = this.params;
      const device = this.db.devices.find((item) => item.user_id === userId && item.device_key === deviceKey);
      if (device) {
        device.helper_online = 1;
        device.last_seen_at = lastSeenAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE accounts SET last_switch_at = ?, updated_at = ?")) {
      const [lastSwitchAt, updatedAt, accountId, userId] = this.params;
      const account = this.db.accounts.find((item) => item.id === accountId && item.user_id === userId);
      if (account) {
        account.last_switch_at = lastSwitchAt;
        account.updated_at = updatedAt;
      }
      return { success: true };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

function latestUsageSnapshot(db, accountId) {
  return db.usageSnapshots
    .filter((item) => item.account_id === accountId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}

function request(path, body, headers = {}) {
  return new Request(`https://codex.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function jsonRequest(method, path, body, headers = {}) {
  return new Request(`https://codex.example.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`;
}

const env = { DB: new FakeD1(), TOKEN_ENCRYPTION_KEY: "verify-worker-helper-secret" };
const user = { id: "user-1", email: "owner@example.com" };
const audits = [];
const writeAudit = async (_env, auditUser, body) => {
  audits.push({ userId: auditUser.id, ...body });
};

const normalized = normalizeAutoSwitchSettings({
  enabled: "true",
  showExperimentalAt: "true",
  idleSeconds: 1,
  pollSeconds: 2,
  cpuBusyPercent: 99,
});
assert.equal(normalized.enabled, true);
assert.equal(normalized.showExperimentalAt, true);
assert.equal(normalized.idleSeconds, 10);
assert.equal(normalized.pollSeconds, 10);
assert.equal(normalized.cpuBusyPercent, 80);
assert.equal(normalizeAutoSwitchSettings({}).showExperimentalAt, false);

await saveAutoSwitchSettings(env, user, { enabled: true, cooldownMinutes: 2 });
const settings = await readAutoSwitchSettings(env, user);
assert.equal(settings.enabled, true);
assert.equal(settings.cooldownMinutes, 2);

const issue = await handleDeviceRoutes(request("/api/devices/auto-switch-token", {
  deviceKey: "desktop-1",
  name: "Dock Helper",
  helperBase: "http://127.0.0.1:18766",
  helperVersion: "0.4.3",
  helperBuildDate: "2026-05-26",
}), env, user, "/api/devices/auto-switch-token", { writeAudit });
assert.equal(issue.status, 200);
const issueBody = await issue.json();
assert.equal(issueBody.ok, true);
assert.match(issueBody.deviceToken, /^cdh_/);
assert.equal(issueBody.heartbeatSeconds, HELPER_HEARTBEAT_SECONDS);
assert.equal(issueBody.settings.enabled, true);
assert.equal(env.DB.devices.length, 1);
assert.equal(env.DB.devices[0].helper_version, "0.4.3");
assert.equal(env.DB.deviceTokens.length, 1);
assert.equal(audits.at(-1).result, "issued");

const token = issueBody.deviceToken;
const helper = await requireHelperDevice(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(token),
}), env);
assert.equal(helper.user.id, "user-1");
assert.equal(helper.deviceKey, "desktop-1");
assert.equal(env.DB.deviceTokens[0].expires_at, helper.tokenExpiresAt);
assert.equal(env.DB.devices[0].helper_online, 1);

const status = helperTokenStatus({
  tokenStatus: "active",
  tokenCreatedAt: new Date(1_000).toISOString(),
  tokenLastSeenAt: new Date(2_000).toISOString(),
  tokenExpiresAt: new Date(11_000).toISOString(),
}, 6_000);
assert.equal(status.expiresInSeconds, 5);
assert.equal(status.rotateAfterSeconds, DEVICE_TOKEN_ROTATE_AFTER_SECONDS);

assert.equal(helperTokenNeedsRotation({
  tokenStatus: "active",
  tokenCreatedAt: new Date(Date.now() - 1000).toISOString(),
  tokenExpiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_SECONDS * 1000).toISOString(),
}), false);
assert.equal(helperTokenNeedsRotation({
  tokenStatus: "active",
  tokenCreatedAt: new Date(Date.now() - (DEVICE_TOKEN_ROTATE_AFTER_SECONDS + 1) * 1000).toISOString(),
  tokenExpiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_SECONDS * 1000).toISOString(),
}), true);

env.DB.deviceTokens[0].created_at = new Date(Date.now() - (DEVICE_TOKEN_ROTATE_AFTER_SECONDS + 60) * 1000).toISOString();
const config = await handleHelperAutoSwitch(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(token),
}), env, "/api/helper/auto-switch/config", { requestId: "req-helper" }, { writeAudit });
assert.equal(config.status, 200);
const configBody = await config.json();
assert.equal(configBody.ok, true);
assert.match(configBody.replacementDeviceToken, /^cdh_/);
assert.equal(env.DB.deviceTokens[0].status, "retiring");
assert.equal(env.DB.deviceTokens.length, 2);
assert.equal(audits.at(-1).result, "rotated");

const next = await handleHelperAutoSwitch(request("/api/helper/auto-switch/next", {
  force: true,
  triggerType: "quota",
  triggerReason: "额度耗尽，任务结束后切换",
  boundaryConfirmed: true,
  runtimeState: "idle",
  boundaryEvidence: "连续 15 秒没有任务类日志",
}, authHeaders(configBody.replacementDeviceToken)), env, "/api/helper/auto-switch/next", { requestId: "req-next" }, { writeAudit });
assert.equal(next.status, 200);
const nextBody = await next.json();
assert.equal(nextBody.shouldSwitch, false);
assert.equal(nextBody.reason, "没有可用候选账号");
assert.equal(nextBody.candidateCount, 0);
assert.equal(nextBody.eligibleCount, 0);
assert.equal(nextBody.blockedSummary, "");
assert.equal(audits.at(-1).result, "no-candidate");
assert.equal(audits.at(-1).metadata.trigger, "额度耗尽，任务结束后切换");
assert.equal(audits.at(-1).metadata.candidateCount, 0);
assert.equal(audits.at(-1).metadata.eligibleCount, 0);
assert.equal(audits.at(-1).metadata.boundaryConfirmed, true);

const held = await handleHelperAutoSwitch(request("/api/helper/auto-switch/next", {
  force: true,
  triggerType: "quota",
  triggerReason: "额度耗尽，当前轮仍在执行",
}, authHeaders(configBody.replacementDeviceToken)), env, "/api/helper/auto-switch/next", { requestId: "req-held" }, { writeAudit });
assert.equal((await held.json()).reason, "等待 Helper 确认安全轮次边界");

const switchAccountId = "acct-ready-row";
const cloudAccountId = "chatgpt-ready";
const accessToken = jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": {
    chatgpt_account_id: cloudAccountId,
    chatgpt_plan_type: "chatgptplus",
  },
  "https://api.openai.com/profile": {
    email: "ready-plus@example.com",
  },
});
const importedAt = new Date().toISOString();
env.DB.accounts.push({
  id: switchAccountId,
  user_id: "user-1",
  name: "Ready Plus",
  email: "ready-plus@example.com",
  group_name: "默认",
  priority: "primary",
  usage_note: "",
  expiry_note: "",
  chatgpt_account_id: cloudAccountId,
  plan_type: "plus",
  expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  has_refresh_token: 1,
  created_at: importedAt,
  updated_at: importedAt,
  last_switch_at: "",
});
env.DB.accountSecrets.push({
  account_id: switchAccountId,
  user_id: "user-1",
  encrypted_auth_json: await encryptSecret(env, {
    session: {
      email: "ready-plus@example.com",
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      profile: { plan: "plus" },
      tokens: {
        access_token: accessToken,
        id_token: accessToken,
        refresh_token: "rt-ready-plus",
        account_id: cloudAccountId,
      },
    },
    importedAt,
    source: "verify-worker-helper",
  }),
  created_at: importedAt,
  updated_at: importedAt,
});
env.DB.usageSnapshots.push({
  id: "usage-ready",
  account_id: switchAccountId,
  user_id: "user-1",
  usage_json: JSON.stringify({
    plan_type: "plus",
    five_hour: { remainingPercent: 88 },
    one_week: { remainingPercent: 91 },
  }),
  ok: 1,
  error: "",
  created_at: importedAt,
});

const payloadResponse = await handleHelperAutoSwitch(request("/api/helper/auto-switch/next", {
  force: true,
  triggerType: "quota",
  triggerReason: "5H 剩余 1%",
  boundaryConfirmed: true,
  runtimeState: "idle",
  boundaryEvidence: "连续 15 秒没有任务类日志",
  currentAccountId: "chatgpt-current",
  currentUsageSummary: "5H 1%，7D 84%",
}, authHeaders(configBody.replacementDeviceToken)), env, "/api/helper/auto-switch/next", { requestId: "req-payload" }, { writeAudit });
assert.equal(payloadResponse.status, 200);
const payloadBody = await payloadResponse.json();
assert.equal(payloadBody.shouldSwitch, true);
assert.equal(payloadBody.candidateCount, 1);
assert.equal(payloadBody.eligibleCount, 1);
assert.equal(payloadBody.account.id, switchAccountId);
assert.equal(payloadBody.account.accountId, cloudAccountId);
assert.equal(payloadBody.authJson.tokens.refresh_token, "rt-ready-plus");
assert.equal(payloadBody.authJson.tokens.account_id, cloudAccountId);
assert.equal(env.DB.accounts.find((item) => item.id === switchAccountId).last_switch_at, "");
assert.equal(audits.at(-1).action, "auto-switch");
assert.equal(audits.at(-1).result, "payload-issued");
assert.equal(audits.at(-1).accountId, switchAccountId);
assert.equal(audits.at(-1).metadata.boundaryConfirmed, true);
assert.equal(audits.at(-1).metadata.candidateCount, 1);
assert.equal(audits.at(-1).metadata.eligibleCount, 1);

const switchedAudit = await handleHelperAutoSwitch(request("/api/helper/auto-switch/audit", {
  accountId: switchAccountId,
  result: "switched",
  metadata: {
    reason: "5H 剩余 1%",
    target: "ready-plus@example.com",
  },
}, authHeaders(configBody.replacementDeviceToken)), env, "/api/helper/auto-switch/audit", { requestId: "req-switched" }, { writeAudit });
assert.equal(switchedAudit.status, 200);
assert.equal((await switchedAudit.json()).ok, true);
const switchedAccount = env.DB.accounts.find((item) => item.id === switchAccountId);
assert.ok(switchedAccount.last_switch_at);
assert.ok(new Date(switchedAccount.last_switch_at).getTime() > 0);
assert.equal(audits.at(-1).action, "auto-switch-helper");
assert.equal(audits.at(-1).result, "switched");
assert.equal(audits.at(-1).accountId, switchAccountId);

const revoked = await handleDeviceRoutes(jsonRequest("DELETE", "/api/devices/auto-switch-token", {
  deviceKey: "desktop-1",
}), env, user, "/api/devices/auto-switch-token", { writeAudit });
assert.equal(revoked.status, 200);
assert.equal((await revoked.json()).ok, true);
assert.equal(audits.at(-1).action, "helper-token");
assert.equal(audits.at(-1).result, "revoked");
assert.equal(audits.at(-1).deviceKey, "desktop-1");
assert.doesNotMatch(JSON.stringify(audits.at(-1)), /cdh_|token_hash|replacementDeviceToken/i);
assert.equal(await requireHelperDevice(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(token),
}), env), null);
assert.equal(await requireHelperDevice(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(configBody.replacementDeviceToken),
}), env), null);
const revokedHelper = await handleHelperAutoSwitch(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(configBody.replacementDeviceToken),
}), env, "/api/helper/auto-switch/config", { requestId: "req-revoked" }, { writeAudit });
assert.equal(revokedHelper.status, 401);
assert.equal((await revokedHelper.json()).error, "Helper 授权已失效，请重新授权");
assert.ok(env.DB.deviceTokens.filter((item) => item.device_key === "desktop-1").every((item) => item.status === "revoked" && item.revoked_at));

const expiredToken = await insertDeviceToken(env, "user-1", "desktop-expired", "Dock Helper", new Date(Date.now() - 1000).toISOString());
env.DB.devices.push({
  id: "device-expired",
  user_id: "user-1",
  device_key: "desktop-expired",
  name: "Dock Helper",
  helper_online: 1,
  helper_base: "",
  created_at: "",
  last_seen_at: "",
});
const expired = await requireHelperDevice(new Request("https://codex.example.test/api/helper/auto-switch/config", {
  headers: authHeaders(expiredToken),
}), env);
assert.equal(expired, null);
const expiredHash = await sha256(expiredToken);
const expiredRow = env.DB.deviceTokens.find((item) => item.token_hash === expiredHash);
assert.equal(expiredRow.status, "expired");
assert.equal(env.DB.devices.find((item) => item.device_key === "desktop-expired").helper_online, 0);

console.log("worker-helper verification passed");

