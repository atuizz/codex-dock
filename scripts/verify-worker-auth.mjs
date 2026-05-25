import assert from "node:assert/strict";
import {
  handleAuth,
  publicUser,
  requireUser,
} from "../cloud-worker/worker-auth.js";
import {
  passwordHash,
  randomToken,
  sha256,
} from "../cloud-worker/worker-shared.js";

class FakeD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
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
    if (sql.includes("SELECT id FROM users WHERE email")) {
      const [email] = this.params;
      const user = this.db.users.find((item) => item.email === email);
      return user ? { id: user.id } : null;
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM users")) {
      return { total: this.db.users.length };
    }
    if (sql.includes("FROM users WHERE email = ?")) {
      const [email] = this.params;
      return this.db.users.find((item) => item.email === email) || null;
    }
    if (sql.includes("FROM sessions") && sql.includes("JOIN users")) {
      const [sessionHash, now] = this.params;
      const session = this.db.sessions.find((item) => item.session_hash === sessionHash && item.expires_at > now);
      if (!session) return null;
      const user = this.db.users.find((item) => item.id === session.user_id);
      if (!user) return null;
      return {
        session_id: session.id,
        expires_at: session.expires_at,
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at,
      };
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    if (sql.includes("INSERT INTO users")) {
      const [id, email, passwordHashValue, passwordSalt, role, status, lastLoginAt, createdAt, updatedAt] = this.params;
      this.db.users.push({
        id,
        email,
        password_hash: passwordHashValue,
        password_salt: passwordSalt,
        role,
        status,
        last_login_at: lastLoginAt,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.includes("INSERT INTO sessions")) {
      const [id, userId, sessionHash, userAgent, ip, expiresAt, createdAt, lastSeenAt] = this.params;
      this.db.sessions.push({
        id,
        user_id: userId,
        session_hash: sessionHash,
        user_agent: userAgent,
        ip,
        expires_at: expiresAt,
        created_at: createdAt,
        last_seen_at: lastSeenAt,
      });
      return { success: true };
    }
    if (sql.includes("UPDATE users SET last_login_at")) {
      const [lastLoginAt, updatedAt, id] = this.params;
      const user = this.db.users.find((item) => item.id === id);
      if (user) {
        user.last_login_at = lastLoginAt;
        user.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.includes("UPDATE sessions SET last_seen_at")) {
      const [lastSeenAt, sessionHash] = this.params;
      const session = this.db.sessions.find((item) => item.session_hash === sessionHash);
      if (session) session.last_seen_at = lastSeenAt;
      return { success: true };
    }
    if (sql.includes("DELETE FROM sessions WHERE session_hash")) {
      const [sessionHash] = this.params;
      this.db.sessions = this.db.sessions.filter((item) => item.session_hash !== sessionHash);
      return { success: true };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

function jsonRequest(path, body, headers = {}) {
  return new Request(`https://codex.example.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "auth-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const env = { DB: new FakeD1() };

assert.deepEqual(publicUser({
  id: "u1",
  email: "user@example.com",
  role: "admin",
  status: "active",
  created_at: "created",
  updated_at: "updated",
  last_login_at: "login",
}), {
  id: "u1",
  email: "user@example.com",
  role: "admin",
  status: "active",
  createdAt: "created",
  updatedAt: "updated",
  lastLoginAt: "login",
});

const register = await handleAuth(jsonRequest("/api/auth/register", {
  email: "Owner@Example.com",
  password: "password-123",
}), env, "/api/auth/register");
assert.equal(register.status, 200);
assert.match(register.headers.get("Set-Cookie"), /codex_session=/);
const registered = await register.json();
assert.equal(registered.ok, true);
assert.equal(registered.user.email, "owner@example.com");
assert.equal(registered.user.role, "admin");
assert.equal(env.DB.users.length, 1);
assert.equal(env.DB.sessions.length, 1);

const duplicate = await handleAuth(jsonRequest("/api/auth/register", {
  email: "owner@example.com",
  password: "password-123",
}), env, "/api/auth/register");
assert.equal(duplicate.status, 409);

const login = await handleAuth(jsonRequest("/api/auth/login", {
  email: "owner@example.com",
  password: "password-123",
}), env, "/api/auth/login");
assert.equal(login.status, 200);
const loginCookie = login.headers.get("Set-Cookie");
assert.match(loginCookie, /codex_session=/);
assert.equal(env.DB.sessions.length, 2);

const token = decodeURIComponent(loginCookie.match(/codex_session=([^;]+)/)[1]);
const authed = await requireUser(new Request("https://codex.example.test/api/me", {
  headers: { Cookie: `codex_session=${encodeURIComponent(token)}` },
}), env);
assert.equal(authed.email, "owner@example.com");
assert.equal(authed.sessionHash, await sha256(token));

const badLogin = await handleAuth(jsonRequest("/api/auth/login", {
  email: "owner@example.com",
  password: "wrong-password",
}), env, "/api/auth/login");
assert.equal(badLogin.status, 401);

const logout = await handleAuth(new Request("https://codex.example.test/api/auth/logout", {
  method: "POST",
  headers: { Cookie: `codex_session=${encodeURIComponent(token)}` },
}), env, "/api/auth/logout");
assert.equal(logout.status, 200);
assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
assert.equal(await requireUser(new Request("https://codex.example.test/api/me", {
  headers: { Cookie: `codex_session=${encodeURIComponent(token)}` },
}), env), null);

const disabledSalt = randomToken(18);
env.DB.users.push({
  id: "disabled",
  email: "disabled@example.com",
  password_hash: await passwordHash("password-123", disabledSalt),
  password_salt: disabledSalt,
  role: "user",
  status: "disabled",
  last_login_at: "",
  created_at: "",
  updated_at: "",
});
const disabledLogin = await handleAuth(jsonRequest("/api/auth/login", {
  email: "disabled@example.com",
  password: "password-123",
}), env, "/api/auth/login");
assert.equal(disabledLogin.status, 403);

const tooLarge = await handleAuth(jsonRequest("/api/auth/login", {
  email: "owner@example.com",
  password: "password-123",
}, { "Content-Length": String(5 * 1024 * 1024) }), env, "/api/auth/login").catch((error) => error);
assert.match(tooLarge.message, /request body too large/);

console.log("worker-auth verification passed");
