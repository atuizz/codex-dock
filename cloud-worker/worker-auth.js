import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  json,
  nowIso,
  parseCookies,
  passwordHash,
  randomToken,
  readJson,
  sessionCookie,
  sha256,
  timingSafeEqual,
} from "./worker-shared.js";

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role || "user",
    status: user.status || "active",
    createdAt: user.created_at || user.createdAt || "",
    updatedAt: user.updated_at || user.updatedAt || "",
    lastLoginAt: user.last_login_at || user.lastLoginAt || "",
  };
}

export async function requireUser(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const sessionHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT sessions.id AS session_id, sessions.expires_at,
            users.id, users.email, users.role, users.status, users.created_at, users.updated_at, users.last_login_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.session_hash = ? AND sessions.expires_at > ?`,
  ).bind(sessionHash, nowIso()).first();
  if (!row) return null;
  if ((row.status || "active") !== "active") {
    await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(sessionHash).run();
    return null;
  }
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_hash = ?").bind(nowIso(), sessionHash).run();
  return {
    id: row.id,
    email: row.email,
    role: row.role || "user",
    status: row.status || "active",
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
    lastLoginAt: row.last_login_at,
    last_login_at: row.last_login_at,
    sessionId: row.session_id,
    sessionHash,
  };
}

async function authResponse(request, env, user) {
  const token = randomToken(36);
  const sessionHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const loginAt = nowIso();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, session_hash, user_agent, ip, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    user.id,
    sessionHash,
    request.headers.get("User-Agent") || "",
    request.headers.get("CF-Connecting-IP") || "",
    expiresAt,
    loginAt,
    loginAt,
  ).run();
  await env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(loginAt, loginAt, user.id).run();
  return json({ ok: true, user: publicUser({ ...user, last_login_at: loginAt, updated_at: loginAt }) }, 200, {
    "Set-Cookie": sessionCookie(token, request),
  });
}

export async function handleOauthExchange(request) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const body = await readJson(request);
  const code = String(body.code || "").trim();
  const codeVerifier = String(body.codeVerifier || "").trim();
  const redirectUri = String(body.redirectUri || "").trim();
  const clientId = String(body.clientId || "").trim();
  if (!code || !codeVerifier || !redirectUri || !clientId) {
    return json({ ok: false, error: "缺少 OAuth code 或 PKCE 参数" }, 400);
  }
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const upstream = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const token = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const upstreamError = typeof token.error_description === "string"
      ? token.error_description
      : typeof token.error === "string"
        ? token.error
        : token.error?.message || `OAuth 换取 token 失败：${upstream.status}`;
    return json({
      ok: false,
      error: upstreamError,
      detail: token,
    }, 400);
  }
  return json({ ok: true, token });
}

export async function handleAuth(request, env, path) {
  if (request.method === "POST" && path === "/api/auth/register") {
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "邮箱格式不正确" }, 400);
    if (password.length < 8) return json({ ok: false, error: "密码至少 8 位" }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (exists) return json({ ok: false, error: "这个邮箱已注册" }, 409);
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
    const role = Number(countRow?.total || 0) === 0 ? "admin" : "user";
    const salt = randomToken(18);
    const hash = await passwordHash(password, salt);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, role, status, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, email, hash, salt, role, "active", "", nowIso(), nowIso()).run();
    return authResponse(request, env, { id, email, role, status: "active", created_at: nowIso(), updated_at: nowIso(), last_login_at: "" });
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await env.DB.prepare("SELECT id, email, password_hash, password_salt, role, status, created_at, updated_at, last_login_at FROM users WHERE email = ?").bind(email).first();
    if (!user) return json({ ok: false, error: "账号或密码不正确" }, 401);
    if ((user.status || "active") !== "active") return json({ ok: false, error: "账号已被禁用" }, 403);
    const hash = await passwordHash(password, user.password_salt);
    if (!timingSafeEqual(hash, user.password_hash)) return json({ ok: false, error: "账号或密码不正确" }, 401);
    return authResponse(request, env, user);
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await sha256(token)).run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }

  return null;
}
