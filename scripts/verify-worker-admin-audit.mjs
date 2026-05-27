import assert from "node:assert/strict";
import {
  assertAdmin,
  ensureAnotherAdmin,
  handleAdmin,
  likeTerm,
} from "../cloud-worker/worker-admin.js";
import {
  handleAudit,
  writeAudit,
} from "../cloud-worker/worker-audit.js";

class FakeD1 {
  constructor() {
    this.users = [
      { id: "admin-1", email: "admin@example.com", role: "admin", status: "active", created_at: "2026-01-01", updated_at: "2026-01-01", last_login_at: "" },
      { id: "user-1", email: "user@example.com", role: "user", status: "active", created_at: "2026-01-02", updated_at: "2026-01-02", last_login_at: "" },
    ];
    this.accounts = [
      { id: "acct-1", user_id: "user-1", name: "Account One", email: "acct@example.com", last_switch_at: "", updated_at: "" },
      { id: "acct-2", user_id: "user-1", name: "AT Only", email: "at@example.com", has_refresh_token: 0, expires_at: "2020-01-01T00:00:00.000Z", last_switch_at: "", updated_at: "" },
    ];
    this.usageSnapshots = [
      { id: "usage-1", account_id: "acct-1", user_id: "user-1", ok: 1, error: "", refresh_source: "helper", created_at: "2026-01-02T01:00:00.000Z" },
      { id: "usage-2", account_id: "acct-2", user_id: "user-1", ok: 0, error: "quota failed", refresh_source: "cloud-worker", created_at: "2026-01-02T02:00:00.000Z" },
    ];
    this.sessions = [
      { id: "sess-1", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z", last_seen_at: "2026-01-02" },
    ];
    const recentSeenAt = new Date().toISOString();
    const staleSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    this.devices = [
      { id: "dev-1", user_id: "user-1", device_key: "desktop", name: "Dock Agent", helper_online: 1, helper_base: "http://127.0.0.1:18766", helper_version: "0.4.3", helper_build_date: "2026-05-26", created_at: "", last_seen_at: recentSeenAt },
      { id: "dev-stale", user_id: "user-1", device_key: "desktop-stale", name: "Stale Agent", helper_online: 1, helper_base: "http://127.0.0.1:18766", helper_version: "0.4.3", helper_build_date: "2026-05-26", created_at: "", last_seen_at: staleSeenAt },
    ];
    this.auditLogs = [];
    this.deletionEvents = [{ id: "deletion-1", created_at: new Date().toISOString() }];
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
    const sql = this.sql;
    if (sql.includes("SUM(CASE WHEN status")) {
      return {
        total: this.db.users.length,
        active: this.db.users.filter((item) => item.status === "active").length,
      };
    }
    if (sql.includes("LEFT JOIN usage_snapshots us ON us.id")) {
      return {
        total: this.db.accounts.length,
        rt_ready: this.db.accounts.filter((item) => item.has_refresh_token !== 0).length,
        at_only: this.db.accounts.filter((item) => item.has_refresh_token === 0).length,
        expired: this.db.accounts.filter((item) => item.expires_at && item.expires_at <= this.params[0]).length,
        unrefreshed: this.db.accounts.filter((account) => !this.db.usageSnapshots.some((snapshot) => snapshot.account_id === account.id)).length,
        usage_ok: this.db.usageSnapshots.filter((item) => item.ok === 1).length,
        usage_failed: this.db.usageSnapshots.filter((item) => item.ok === 0).length,
      };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM accounts WHERE user_id")) {
      const [userId] = this.params;
      return { total: this.db.accounts.filter((item) => item.user_id === userId).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM accounts")) {
      return { total: this.db.accounts.length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM sessions WHERE user_id")) {
      const [userId] = this.params;
      return { total: this.db.sessions.filter((item) => item.user_id === userId).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM sessions WHERE expires_at")) {
      return { total: this.db.sessions.length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM devices WHERE user_id")) {
      const [userId] = this.params;
      return { total: this.db.devices.filter((item) => item.user_id === userId).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM audit_logs WHERE action")) {
      return { total: this.db.auditLogs.length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM usage_snapshots WHERE ok = 0")) {
      return { total: this.db.usageSnapshots.filter((item) => item.ok === 0).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM account_deletion_events")) {
      return { total: this.db.deletionEvents.length };
    }
    if (sql.includes("SELECT id, email, role, status, created_at")) {
      const [userId] = this.params;
      return this.db.users.find((item) => item.id === userId) || null;
    }
    if (sql.includes("SELECT id, email, role, status FROM users WHERE id")) {
      const [userId] = this.params;
      return this.db.users.find((item) => item.id === userId) || null;
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'")) {
      const [targetUserId] = this.params;
      return {
        total: this.db.users.filter((item) => item.id !== targetUserId && item.role === "admin" && item.status === "active").length,
      };
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async all() {
    const sql = this.sql;
    if (sql.includes("FROM users") && sql.includes("GROUP BY users.id")) {
      return {
        results: this.db.users.map((user) => ({
          ...user,
          account_count: this.db.accounts.filter((item) => item.user_id === user.id).length,
          session_count: this.db.sessions.filter((item) => item.user_id === user.id).length,
          last_seen_at: "",
        })),
      };
    }
    if (sql.trim() === "SELECT * FROM devices") {
      return { results: this.db.devices };
    }
    if (sql.includes("GROUP BY helper_version")) {
      const [freshCutoff] = this.params;
      const versions = new Map();
      for (const device of this.db.devices) {
        const version = device.helper_version || "未上报";
        const current = versions.get(version) || { helper_version: version, total: 0, online: 0, stale: 0, last_seen_at: "" };
        current.total += 1;
        if (device.helper_online && device.last_seen_at && device.last_seen_at > freshCutoff) current.online += 1;
        if (device.helper_online && (!device.last_seen_at || device.last_seen_at <= freshCutoff)) current.stale += 1;
        current.last_seen_at = current.last_seen_at || device.last_seen_at || "";
        versions.set(version, current);
      }
      return { results: [...versions.values()] };
    }
    if (sql.includes("substr(created_at, 1, 13) AS bucket")) {
      const buckets = new Map();
      for (const log of this.db.auditLogs) {
        const bucket = String(log.created_at || "").slice(0, 13);
        const current = buckets.get(bucket) || { bucket, total: 0, failures: 0 };
        current.total += 1;
        if (/error|fail|no-candidate|unmatched|denied|失败/i.test(log.result || "")) current.failures += 1;
        buckets.set(bucket, current);
      }
      return { results: [...buckets.values()] };
    }
    if (sql.includes("SELECT devices.*, users.email AS user_email")) {
      return {
        results: this.db.devices.map((device) => ({
          ...device,
          user_email: this.db.users.find((user) => user.id === device.user_id)?.email || "",
        })),
      };
    }
    if (sql.includes("FROM audit_logs") && sql.includes("LEFT JOIN users")) {
      return {
        results: this.db.auditLogs.map((log) => ({
          ...log,
          user_email: this.db.users.find((user) => user.id === log.user_id)?.email || "",
          account_name: this.db.accounts.find((account) => account.id === log.account_id)?.name || "",
        })),
      };
    }
    if (sql.includes("SELECT audit_logs.*, accounts.name AS account_name")) {
      const [userId] = this.params;
      return {
        results: this.db.auditLogs
          .filter((log) => log.user_id === userId)
          .map((log) => ({
            ...log,
            account_name: this.db.accounts.find((account) => account.id === log.account_id)?.name || "",
          })),
      };
    }
    if (sql.includes("SELECT action, result, created_at FROM audit_logs")) {
      const [userId] = this.params;
      return { results: this.db.auditLogs.filter((log) => log.user_id === userId).slice(0, 8) };
    }
    if (sql.includes("FROM accounts a")) {
      const [userId] = this.params;
      return {
        results: this.db.accounts
          .filter((account) => account.user_id === userId)
          .map((account) => ({
            ...account,
            group_name: "默认",
            priority: "normal",
            plan_type: "plus",
            has_refresh_token: 1,
            usage_json: JSON.stringify({ plan_type: "plus" }),
            usage_created_at: "2026-01-02T01:00:00.000Z",
          })),
      };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    if (sql.includes("INSERT INTO audit_logs")) {
      const [id, userId, accountId, action, result, deviceKey, metadataJson, createdAt] = this.params;
      this.db.auditLogs.push({
        id,
        user_id: userId,
        account_id: accountId,
        action,
        result,
        device_key: deviceKey,
        metadata_json: metadataJson,
        created_at: createdAt,
      });
      return { success: true };
    }
    if (sql.includes("UPDATE accounts SET last_switch_at")) {
      const [lastSwitchAt, updatedAt, accountId, userId] = this.params;
      const account = this.db.accounts.find((item) => item.id === accountId && item.user_id === userId);
      if (account) {
        account.last_switch_at = lastSwitchAt;
        account.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE users SET role = ?, status = ?")) {
      const [role, status, updatedAt, userId] = this.params;
      const user = this.db.users.find((item) => item.id === userId);
      if (user) {
        user.role = role;
        user.status = status;
        user.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE users SET password_hash")) {
      const [passwordHash, passwordSalt, updatedAt, userId] = this.params;
      const user = this.db.users.find((item) => item.id === userId);
      if (user) {
        user.password_hash = passwordHash;
        user.password_salt = passwordSalt;
        user.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.includes("DELETE FROM sessions WHERE user_id")) {
      const [userId] = this.params;
      this.db.sessions = this.db.sessions.filter((item) => item.user_id !== userId);
      return { success: true };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

function request(path, method = "GET", body = null) {
  const init = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://codex.example.test${path}`, init);
}

const env = { DB: new FakeD1() };
const waitUntilTasks = [];
const admin = {
  id: "admin-1",
  role: "admin",
  requestContext: {
    requestId: "req-admin",
    method: "POST",
    path: "/api/admin/users/user-1",
    ctx: { waitUntil: (task) => waitUntilTasks.push(task) },
  },
};
const user = { id: "user-1", role: "user" };

assert.equal(assertAdmin(admin), true);
assert.equal(assertAdmin(user), false);
assert.equal(likeTerm("A%_B"), "%ab%");
assert.equal(await ensureAnotherAdmin(env, "admin-1"), false);

await writeAudit(env, admin, {
  accountId: "acct-1",
  action: "manual",
  result: "ok",
  deviceKey: "desktop",
});
assert.equal(env.DB.auditLogs.length, 1);
assert.equal(JSON.parse(env.DB.auditLogs[0].metadata_json).requestId, "req-admin");
await Promise.all(waitUntilTasks);

const auditList = await handleAudit(request("/api/audit"), env, admin, "/api/audit");
assert.equal(auditList.status, 200);
const auditListBody = await auditList.json();
assert.equal(auditListBody.audit[0].requestId, "req-admin");
assert.equal(auditListBody.audit[0].accountName, "Account One");

const auditPost = await handleAudit(request("/api/audit", "POST", {
  accountId: "acct-1",
  action: "switch",
  result: "ok",
}), env, user, "/api/audit");
assert.equal(auditPost.status, 200);
assert.notEqual(env.DB.accounts[0].last_switch_at, "");

const denied = await handleAdmin(request("/api/admin/summary"), env, user, "/api/admin/summary");
assert.equal(denied.status, 403);

env.DB.auditLogs.push({
  id: "audit-fail",
  user_id: "user-1",
  account_id: "acct-2",
  action: "usage-refresh",
  result: "error",
  device_key: "desktop",
  metadata_json: "{}",
  created_at: "2026-01-02T03:00:00.000Z",
});
const summary = await handleAdmin(request("/api/admin/summary"), env, admin, "/api/admin/summary");
assert.equal(summary.status, 200);
const summaryBody = await summary.json();
assert.equal(summaryBody.summary.users, 2);
assert.equal(summaryBody.summary.accounts, 2);
assert.equal(summaryBody.summary.accountHealth.rtReady, 1);
assert.equal(summaryBody.summary.accountHealth.atOnly, 1);
assert.equal(summaryBody.summary.accountHealth.usageFailed, 1);
assert.equal(summaryBody.summary.failureTotals.usageRefreshFailures24h, 1);
assert.equal(summaryBody.summary.deletions24h, 1);
assert.ok(summaryBody.summary.failureTrend.some((bucket) => bucket.failures >= 1));
assert.equal(summaryBody.summary.helperVersions[0].version, "0.4.3");
assert.equal(summaryBody.summary.helperVersions[0].total, 2);
assert.equal(summaryBody.summary.helperVersions[0].online, 1);
assert.equal(summaryBody.summary.helperVersions[0].stale, 1);
assert.equal(summaryBody.summary.deviceHealth.online, 1);
assert.equal(summaryBody.summary.deviceHealth.offline, 1);
assert.equal(summaryBody.summary.deviceHealth.stale, 1);
assert.equal(summaryBody.summary.deviceHealth.outdated, 0);

const devices = await handleAdmin(request("/api/admin/devices"), env, admin, "/api/admin/devices");
const deviceBody = await devices.json();
const freshDevice = deviceBody.devices.find((item) => item.id === "dev-1");
const staleDevice = deviceBody.devices.find((item) => item.id === "dev-stale");
assert.equal(freshDevice.helperVersion, "0.4.3");
assert.equal(freshDevice.helperBuildDate, "2026-05-26");
assert.equal(freshDevice.helperOnline, true);
assert.equal(staleDevice.helperReportedOnline, true);
assert.equal(staleDevice.helperOnline, false);
assert.equal(staleDevice.helperStale, true);

const guard = await handleAdmin(request("/api/admin/users/admin-1", "PATCH", {
  role: "user",
  status: "active",
}), env, admin, "/api/admin/users/admin-1", { writeAudit });
assert.equal(guard.status, 400);

env.DB.users.push({ id: "admin-2", email: "admin2@example.com", role: "admin", status: "active", created_at: "", updated_at: "", last_login_at: "" });
const updateUser = await handleAdmin(request("/api/admin/users/user-1", "PATCH", {
  role: "user",
  status: "disabled",
}), env, admin, "/api/admin/users/user-1", { writeAudit });
assert.equal(updateUser.status, 200);
assert.equal(env.DB.users.find((item) => item.id === "user-1").status, "disabled");
assert.equal(env.DB.sessions.find((item) => item.user_id === "user-1"), undefined);
assert.equal(env.DB.auditLogs.at(-1).action, "admin-update-user");

const reset = await handleAdmin(request("/api/admin/users/user-1/reset-password", "POST", {}), env, admin, "/api/admin/users/user-1/reset-password", { writeAudit });
assert.equal(reset.status, 200);
assert.match((await reset.json()).temporaryPassword, /^CodexTemp-/);
assert.equal(env.DB.auditLogs.at(-1).action, "admin-reset-password");

console.log("worker-admin-audit verification passed");

