import assert from "node:assert/strict";
import {
  handleUserRoutes,
} from "../cloud-worker/worker-user.js";
import {
  passwordHash,
  randomToken,
} from "../cloud-worker/worker-shared.js";

class FakeD1 {
  constructor(user) {
    this.users = [user];
    this.userSettings = [];
    this.accounts = [{ id: "acct-delete", user_id: user.id }];
    this.devices = [{ id: "dev-delete", user_id: user.id }];
    this.deviceTokens = [{ id: "token-delete", user_id: user.id }];
    this.sessions = [{ id: "session-delete", user_id: user.id }];
    this.deletionEvents = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
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
    if (sql.includes("SELECT password_hash, password_salt FROM users")) {
      const [userId] = this.params;
      const user = this.db.users.find((item) => item.id === userId);
      return user ? { password_hash: user.password_hash, password_salt: user.password_salt } : null;
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'")) {
      const [userId] = this.params;
      return { total: this.db.users.filter((item) => item.id !== userId && item.role === "admin" && item.status === "active").length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM accounts WHERE user_id")) {
      return { total: this.db.accounts.filter((item) => item.user_id === this.params[0]).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM devices WHERE user_id")) {
      return { total: this.db.devices.filter((item) => item.user_id === this.params[0]).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM device_tokens WHERE user_id")) {
      return { total: this.db.deviceTokens.filter((item) => item.user_id === this.params[0]).length };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM sessions WHERE user_id")) {
      return { total: this.db.sessions.filter((item) => item.user_id === this.params[0]).length };
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
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
    if (sql.includes("UPDATE users SET password_hash")) {
      const [passwordHashValue, passwordSalt, updatedAt, userId] = this.params;
      const user = this.db.users.find((item) => item.id === userId);
      if (user) {
        user.password_hash = passwordHashValue;
        user.password_salt = passwordSalt;
        user.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.includes("DELETE FROM users WHERE id")) {
      const [userId] = this.params;
      this.db.users = this.db.users.filter((item) => item.id !== userId);
      this.db.userSettings = this.db.userSettings.filter((item) => item.user_id !== userId);
      this.db.accounts = this.db.accounts.filter((item) => item.user_id !== userId);
      this.db.devices = this.db.devices.filter((item) => item.user_id !== userId);
      this.db.deviceTokens = this.db.deviceTokens.filter((item) => item.user_id !== userId);
      this.db.sessions = this.db.sessions.filter((item) => item.user_id !== userId);
      return { success: true };
    }
    if (sql.includes("INSERT INTO account_deletion_events")) {
      const [id, reason, formerRole, removedJson, requestId, createdAt] = this.params;
      this.db.deletionEvents.push({ id, reason, former_role: formerRole, removed_json: removedJson, request_id: requestId, created_at: createdAt });
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

const salt = randomToken(18);
const env = {
  DB: new FakeD1({
    id: "user-1",
    email: "owner@example.com",
    role: "user",
    status: "active",
    password_hash: await passwordHash("old-password", salt),
    password_salt: salt,
    updated_at: "",
  }),
};
const user = { id: "user-1", email: "owner@example.com", role: "user", requestContext: { requestId: "req-user" } };
const audits = [];
const writeAudit = async (_env, auditUser, body) => {
  audits.push({ userId: auditUser.id, ...body });
};

const settingsGet = await handleUserRoutes(request("/api/settings/auto-switch"), env, user, "/api/settings/auto-switch", { writeAudit });
assert.equal(settingsGet.status, 200);
assert.equal((await settingsGet.json()).settings.enabled, false);

const settingsPatch = await handleUserRoutes(request("/api/settings/auto-switch", "PATCH", {
  settings: { enabled: true, idleSeconds: 1, cooldownMinutes: 3, onlyWhenIdle: false },
}), env, user, "/api/settings/auto-switch", { writeAudit });
assert.equal(settingsPatch.status, 200);
const settingsPatchBody = await settingsPatch.json();
assert.equal(settingsPatchBody.settings.enabled, true);
assert.equal(settingsPatchBody.settings.idleSeconds, 10);
assert.equal(settingsPatchBody.settings.cooldownMinutes, 3);
assert.equal(settingsPatchBody.settings.onlyWhenIdle, true);
assert.equal(audits.at(-1).action, "auto-switch-settings");
assert.equal(audits.at(-1).result, "enabled");

const missing = await handleUserRoutes(request("/api/unknown"), env, user, "/api/unknown", { writeAudit });
assert.equal(missing, null);

const weak = await handleUserRoutes(request("/api/auth/change-password", "POST", {
  currentPassword: "old-password",
  nextPassword: "short",
}), env, user, "/api/auth/change-password", { writeAudit });
assert.equal(weak.status, 400);

const wrong = await handleUserRoutes(request("/api/auth/change-password", "POST", {
  currentPassword: "wrong-password",
  nextPassword: "new-password",
}), env, user, "/api/auth/change-password", { writeAudit });
assert.equal(wrong.status, 401);

const changed = await handleUserRoutes(request("/api/auth/change-password", "POST", {
  currentPassword: "old-password",
  nextPassword: "new-password",
}), env, user, "/api/auth/change-password", { writeAudit });
assert.equal(changed.status, 200);
assert.equal(await passwordHash("new-password", env.DB.users[0].password_salt), env.DB.users[0].password_hash);
assert.equal(audits.at(-1).action, "change-password");

const wrongEmail = await handleUserRoutes(request("/api/me", "DELETE", {
  confirmEmail: "wrong@example.com",
  currentPassword: "new-password",
}), env, user, "/api/me", { writeAudit });
assert.equal(wrongEmail.status, 400);
assert.equal(env.DB.users.length, 1);

const wrongDeletePassword = await handleUserRoutes(request("/api/me", "DELETE", {
  confirmEmail: "owner@example.com",
  currentPassword: "wrong-password",
}), env, user, "/api/me", { writeAudit });
assert.equal(wrongDeletePassword.status, 401);
assert.equal(env.DB.users.length, 1);

const deleted = await handleUserRoutes(request("/api/me", "DELETE", {
  confirmEmail: "owner@example.com",
  currentPassword: "new-password",
}), env, user, "/api/me", { writeAudit });
assert.equal(deleted.status, 200);
assert.match(deleted.headers.get("Set-Cookie") || "", /Max-Age=0/);
const deletedBody = await deleted.json();
assert.deepEqual(deletedBody.removed, { accounts: 1, devices: 1, deviceTokens: 1, sessions: 1 });
assert.equal(env.DB.users.length, 0);
assert.equal(env.DB.accounts.length, 0);
assert.equal(env.DB.devices.length, 0);
assert.equal(env.DB.deviceTokens.length, 0);
assert.equal(env.DB.sessions.length, 0);
assert.equal(env.DB.deletionEvents.length, 1);
assert.equal(env.DB.deletionEvents[0].request_id, "req-user");
assert.doesNotMatch(JSON.stringify(env.DB.deletionEvents[0]), /owner@example|user-1/i);
assert.equal(audits.at(-1).action, "delete-account");

const adminSalt = randomToken(18);
const soleAdminEnv = {
  DB: new FakeD1({
    id: "admin-1",
    email: "admin@example.com",
    role: "admin",
    status: "active",
    password_hash: await passwordHash("admin-password", adminSalt),
    password_salt: adminSalt,
  }),
};
const soleAdminDelete = await handleUserRoutes(request("/api/me", "DELETE", {
  confirmEmail: "admin@example.com",
  currentPassword: "admin-password",
}), soleAdminEnv, { id: "admin-1", email: "admin@example.com", role: "admin" }, "/api/me", { writeAudit });
assert.equal(soleAdminDelete.status, 409);
assert.equal(soleAdminEnv.DB.users.length, 1);
assert.equal(soleAdminEnv.DB.deletionEvents.length, 0);

console.log("worker-user verification passed");
