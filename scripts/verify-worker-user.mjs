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
    if (sql.includes("SELECT auto_switch_json FROM user_settings")) {
      const [userId] = this.params;
      return this.db.userSettings.find((item) => item.user_id === userId) || null;
    }
    if (sql.includes("SELECT password_hash, password_salt FROM users")) {
      const [userId] = this.params;
      const user = this.db.users.find((item) => item.id === userId);
      return user ? { password_hash: user.password_hash, password_salt: user.password_salt } : null;
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
    password_hash: await passwordHash("old-password", salt),
    password_salt: salt,
    updated_at: "",
  }),
};
const user = { id: "user-1" };
const audits = [];
const writeAudit = async (_env, auditUser, body) => {
  audits.push({ userId: auditUser.id, ...body });
};

const settingsGet = await handleUserRoutes(request("/api/settings/auto-switch"), env, user, "/api/settings/auto-switch", { writeAudit });
assert.equal(settingsGet.status, 200);
assert.equal((await settingsGet.json()).settings.enabled, false);

const settingsPatch = await handleUserRoutes(request("/api/settings/auto-switch", "PATCH", {
  settings: { enabled: true, idleSeconds: 1, cooldownMinutes: 3 },
}), env, user, "/api/settings/auto-switch", { writeAudit });
assert.equal(settingsPatch.status, 200);
const settingsPatchBody = await settingsPatch.json();
assert.equal(settingsPatchBody.settings.enabled, true);
assert.equal(settingsPatchBody.settings.idleSeconds, 10);
assert.equal(settingsPatchBody.settings.cooldownMinutes, 3);
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

console.log("worker-user verification passed");
