const SESSION_COOKIE = "codex_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100000;
const DEFAULT_AUTO_SWITCH_SETTINGS = {
  enabled: false,
  fiveHourThreshold: 5,
  oneWeekThreshold: 5,
  pollSeconds: 15,
  idlePollSeconds: 300,
  paidOnly: true,
  preferRt: true,
  allowAt: true,
  avoidCurrent: true,
  avoidLow5h: true,
  avoidLow7d: true,
  cooldownMinutes: 10,
  globalCooldownSeconds: 180,
  onlyWhenIdle: true,
  idleSeconds: 180,
  activityQuietSeconds: 120,
  cpuQuietSeconds: 90,
  cpuBusyPercent: 3,
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function base64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256(value) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return base64Url(await crypto.subtle.digest("SHA-256", data));
}

function parseCookies(request) {
  const cookies = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

function publicUser(user) {
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

function temporaryPassword() {
  return `CodexTemp-${randomToken(8)}`;
}

async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: bytesFromBase64Url(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    material,
    256,
  );
  return base64Url(bits);
}

function timingSafeEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

function encryptionKeyMaterial(env) {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("Missing TOKEN_ENCRYPTION_KEY secret");
  }
  return new TextEncoder().encode(env.TOKEN_ENCRYPTION_KEY);
}

async function encryptionKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", encryptionKeyMaterial(env));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env, value) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    version: 1,
    alg: "AES-GCM-SHA256-key",
    iv: base64Url(iv),
    data: base64Url(encrypted),
  });
}

async function decryptSecret(env, encryptedJson) {
  const envelope = JSON.parse(encryptedJson);
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64Url(envelope.iv) },
    key,
    bytesFromBase64Url(envelope.data),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function decodeJwtPayload(token) {
  if (!token || !token.includes(".")) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytesFromBase64Url(token.split(".")[1])));
  } catch {
    return {};
  }
}

function pick(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "" && typeof source[key] !== "object") {
      return source[key];
    }
  }
  return "";
}

function objectAt(source, key) {
  return source && typeof source[key] === "object" && source[key] !== null ? source[key] : {};
}

function pickAny(sources, keys) {
  for (const source of sources) {
    const value = pick(source, keys);
    if (value) return value;
  }
  return "";
}

function canonicalPlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "chatgptplus") return "plus";
  if (["plus", "pro", "team", "enterprise", "free"].includes(plan)) return plan;
  return plan;
}

function planRank(value) {
  const plan = canonicalPlan(value);
  if (plan === "enterprise") return 5;
  if (plan === "team") return 4;
  if (plan === "pro") return 3;
  if (plan === "plus") return 2;
  if (plan === "free") return 1;
  return 0;
}

function bestPlan(...values) {
  let best = "";
  for (const value of values) {
    const plan = canonicalPlan(value);
    if (!plan) continue;
    if (!best || planRank(plan) > planRank(best)) best = plan;
  }
  return best;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["false", "0", "off", "no"].includes(value.toLowerCase());
  return fallback;
}

function normalizeAutoSwitchSettings(input = {}, base = DEFAULT_AUTO_SWITCH_SETTINGS) {
  const next = { ...DEFAULT_AUTO_SWITCH_SETTINGS, ...(base || {}), ...(input || {}) };
  return {
    enabled: boolValue(next.enabled, DEFAULT_AUTO_SWITCH_SETTINGS.enabled),
    fiveHourThreshold: clampNumber(next.fiveHourThreshold, DEFAULT_AUTO_SWITCH_SETTINGS.fiveHourThreshold, 1, 50),
    oneWeekThreshold: clampNumber(next.oneWeekThreshold, DEFAULT_AUTO_SWITCH_SETTINGS.oneWeekThreshold, 1, 50),
    pollSeconds: clampNumber(next.pollSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.pollSeconds, 10, 600),
    idlePollSeconds: clampNumber(next.idlePollSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.idlePollSeconds, 60, 1800),
    paidOnly: boolValue(next.paidOnly, DEFAULT_AUTO_SWITCH_SETTINGS.paidOnly),
    preferRt: boolValue(next.preferRt, DEFAULT_AUTO_SWITCH_SETTINGS.preferRt),
    allowAt: boolValue(next.allowAt, DEFAULT_AUTO_SWITCH_SETTINGS.allowAt),
    avoidCurrent: boolValue(next.avoidCurrent, DEFAULT_AUTO_SWITCH_SETTINGS.avoidCurrent),
    avoidLow5h: boolValue(next.avoidLow5h, DEFAULT_AUTO_SWITCH_SETTINGS.avoidLow5h),
    avoidLow7d: boolValue(next.avoidLow7d, DEFAULT_AUTO_SWITCH_SETTINGS.avoidLow7d),
    cooldownMinutes: clampNumber(next.cooldownMinutes, DEFAULT_AUTO_SWITCH_SETTINGS.cooldownMinutes, 0, 240),
    globalCooldownSeconds: clampNumber(next.globalCooldownSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.globalCooldownSeconds, 30, 1800),
    onlyWhenIdle: boolValue(next.onlyWhenIdle, DEFAULT_AUTO_SWITCH_SETTINGS.onlyWhenIdle),
    idleSeconds: clampNumber(next.idleSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.idleSeconds, 30, 1800),
    activityQuietSeconds: clampNumber(next.activityQuietSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.activityQuietSeconds, 30, 1800),
    cpuQuietSeconds: clampNumber(next.cpuQuietSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.cpuQuietSeconds, 15, 600),
    cpuBusyPercent: clampNumber(next.cpuBusyPercent, DEFAULT_AUTO_SWITCH_SETTINGS.cpuBusyPercent, 1, 80),
  };
}

async function readAutoSwitchSettings(env, user) {
  const row = await env.DB.prepare("SELECT auto_switch_json FROM user_settings WHERE user_id = ?").bind(user.id).first();
  if (!row?.auto_switch_json) return normalizeAutoSwitchSettings();
  try {
    return normalizeAutoSwitchSettings(JSON.parse(row.auto_switch_json));
  } catch {
    return normalizeAutoSwitchSettings();
  }
}

async function saveAutoSwitchSettings(env, user, patch) {
  const current = await readAutoSwitchSettings(env, user);
  const next = normalizeAutoSwitchSettings(patch, current);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, auto_switch_json, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       auto_switch_json = excluded.auto_switch_json,
       updated_at = excluded.updated_at`,
  ).bind(user.id, JSON.stringify(next), now, now).run();
  return next;
}

function usageRemaining(window) {
  if (!window || typeof window !== "object") return null;
  const direct = Number(window.remaining_percent ?? window.remainingPercent);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
  const used = Number(window.used_percent ?? window.usedPercent ?? window.used);
  if (Number.isFinite(used)) return Math.max(0, Math.min(100, 100 - used));
  return null;
}

function usageErrorText(usage, extra = "") {
  return String(extra || usage?.error || usage?.message || "").toLowerCase();
}

function isHardAccountFailure(usage, extra = "") {
  const text = usageErrorText(usage, extra);
  return /\b(deactivated|suspended|banned|封禁|封号|停用)\b/i.test(text);
}

function isSwitchTriggerUsage(usage, error, settings) {
  const text = usageErrorText(usage, error);
  const five = usageRemaining(usage?.five_hour || usage?.fiveHour || usage?.short_window || usage?.shortWindow);
  const week = usageRemaining(usage?.one_week || usage?.oneWeek || usage?.long_window || usage?.longWindow);
  if (Number.isFinite(five) && five <= settings.fiveHourThreshold) return { yes: true, reason: `5H 剩余 ${five}%` };
  if (Number.isFinite(week) && week <= settings.oneWeekThreshold) return { yes: true, reason: `7D 剩余 ${week}%` };
  if (/\b(401|429|quota|rate limit|usage limit|too many requests|token has been invalidated|invalidated|token expired|已失效|频率|额度)\b/i.test(text)) {
    return { yes: true, reason: "当前账号不可用或已限流" };
  }
  return { yes: false, reason: "" };
}

function normalizeSession(source) {
  const tokens = objectAt(source, "tokens");
  const auth = objectAt(source, "auth");
  const session = objectAt(source, "session");
  const user = objectAt(source, "user");
  const profile = objectAt(source, "profile");
  const accessToken = pickAny([source, tokens, auth, session], ["access_token", "accessToken"]);
  const idToken = pickAny([source, tokens, auth, session], ["id_token", "idToken"]) || accessToken;
  const refreshToken = pickAny([source, tokens, auth, session], ["refresh_token", "refreshToken"]);
  const sessionToken = pickAny([source, tokens, auth, session], ["session_token", "sessionToken", "__Secure-next-auth.session-token", "token"]);
  if (!accessToken) throw new Error("missing access_token");

  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);
  const authPayload = accessPayload["https://api.openai.com/auth"] || idPayload["https://api.openai.com/auth"] || {};
  const profilePayload = accessPayload["https://api.openai.com/profile"] || idPayload["https://api.openai.com/profile"] || {};
  const accountId = pickAny([source, tokens, auth, user], ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId", "id"])
    || authPayload.chatgpt_account_id
    || authPayload.chatgpt_account_user_id
    || "";
  const email = pickAny([source, user, profile], ["email", "mail"]) || profilePayload.email || "";
  const planType = bestPlan(
    pickAny([source, profile], ["plan_type", "planType", "chatgpt_plan_type", "chatgptPlanType", "plan"]),
    authPayload.chatgpt_plan_type,
  );
  const expiresAt = pick(source, ["expires", "expires_at", "expiresAt"]) || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");

  return {
    sourceType: source.sourceType || source.source_type || source.auth_mode || "import",
    email,
    expires: expiresAt,
    profile: { plan: planType },
    usage: source.usage || source.usage_snapshot || null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
      session_token: sessionToken,
    },
  };
}

function normalizeAuthPayload(session) {
  const tokens = session.tokens || {};
  const accessToken = tokens.access_token || "";
  if (!accessToken) throw new Error("account missing access_token");
  const refreshToken = tokens.refresh_token && tokens.refresh_token !== accessToken
    ? tokens.refresh_token
    : "rt_mock_token";
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: accessToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: tokens.account_id || "",
    },
    last_refresh: nowIso(),
  };
}

function normalizeUsage(raw, fallbackPlan = "") {
  if (!raw || typeof raw !== "object") {
    return {
      fetched_at: null,
      refreshed_at: "",
      plan_type: fallbackPlan || "",
      five_hour: null,
      one_week: null,
      credits: null,
      status: "未刷新",
      error: "",
    };
  }
  return {
    fetched_at: raw.fetched_at ?? raw.fetchedAt ?? null,
    refreshed_at: raw.refreshed_at || raw.refreshedAt || nowIso(),
    plan_type: bestPlan(raw.plan_type, raw.planType, fallbackPlan),
    five_hour: raw.five_hour || raw.fiveHour || raw.short_window || raw.shortWindow || null,
    one_week: raw.one_week || raw.oneWeek || raw.long_window || raw.longWindow || null,
    credits: raw.credits || null,
    status: raw.status || "已刷新",
    error: raw.error || "",
  };
}

function accountSummary(row, usage) {
  const planType = bestPlan(row.plan_type, usage?.plan_type, usage?.planType);
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    group: row.group_name || "默认",
    priority: row.priority || "normal",
    usageNote: row.usage_note || "",
    expiryNote: row.expiry_note || "",
    accountId: row.chatgpt_account_id || "",
    planType,
    expiresAt: row.expires_at || "",
    hasRefreshToken: Boolean(row.has_refresh_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSwitchAt: row.last_switch_at || "",
    usage: usage || null,
  };
}

function accountMatchesCurrent(account, body) {
  const currentId = String(body.currentAccountId || body.accountId || body.chatgptAccountId || "").trim();
  const currentEmail = String(body.currentEmail || body.email || "").trim().toLowerCase();
  const currentCloudId = String(body.currentCloudAccountId || body.cloudAccountId || "").trim();
  if (currentCloudId && account.id === currentCloudId) return true;
  if (currentId && account.accountId && account.accountId === currentId) return true;
  if (currentEmail && account.email && account.email.toLowerCase() === currentEmail) return true;
  return false;
}

function hasUsableRefresh(account) {
  return Boolean(account.hasRefreshToken);
}

function accountTokenExpired(account) {
  if (!account.expiresAt) return false;
  const time = new Date(account.expiresAt).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function candidateScore(account, settings, body) {
  const plan = canonicalPlan(account.planType);
  const usage = normalizeUsage(account.usage, plan);
  if (isHardAccountFailure(usage)) return -100000;
  if (settings.paidOnly && planRank(plan) < planRank("plus")) return -90000;
  if (!settings.allowAt && !hasUsableRefresh(account)) return -85000;
  if (settings.avoidCurrent && accountMatchesCurrent(account, body)) return -80000;
  if (accountTokenExpired(account) && !hasUsableRefresh(account)) return -78000;
  const five = usageRemaining(usage.five_hour);
  const week = usageRemaining(usage.one_week);
  if (settings.avoidLow5h && Number.isFinite(five) && five <= settings.fiveHourThreshold) return -76000;
  if (settings.avoidLow7d && Number.isFinite(week) && week <= settings.oneWeekThreshold) return -76000;
  const cooldown = Number(settings.cooldownMinutes || 0);
  if (cooldown && account.lastSwitchAt) {
    const last = new Date(account.lastSwitchAt).getTime();
    if (Number.isFinite(last) && Date.now() - last < cooldown * 60 * 1000) return -74000;
  }
  const priorityBoost = account.priority === "primary" ? 16 : account.priority === "reserve" ? -16 : 0;
  const rtBoost = settings.preferRt && hasUsableRefresh(account) ? 18 : 0;
  const paidBoost = Math.max(0, planRank(plan) - 1) * 12;
  const fiveScore = Number.isFinite(five) ? five * 0.9 : 38;
  const weekScore = Number.isFinite(week) ? week * 0.35 : 15;
  return 20 + paidBoost + rtBoost + priorityBoost + fiveScore + weekScore;
}

function candidateReasons(account, settings) {
  const usage = normalizeUsage(account.usage, account.planType);
  const reasons = [];
  const plan = canonicalPlan(account.planType);
  if (plan) reasons.push(plan.toUpperCase());
  reasons.push(hasUsableRefresh(account) ? "RT" : "AT");
  const five = usageRemaining(usage.five_hour);
  const week = usageRemaining(usage.one_week);
  if (Number.isFinite(five)) reasons.push(`5H ${five}%`);
  if (Number.isFinite(week)) reasons.push(`7D ${week}%`);
  if (settings.avoidCurrent) reasons.push("避开当前账号");
  return reasons.join("、");
}

async function switchPayloadForAccount(env, user, accountId) {
  const secret = await env.DB.prepare("SELECT encrypted_auth_json FROM account_secrets WHERE account_id = ? AND user_id = ?").bind(accountId, user.id).first();
  if (!secret) throw new Error("账号密钥不存在");
  const decrypted = await decryptSecret(env, secret.encrypted_auth_json);
  return normalizeAuthPayload(decrypted.session || decrypted.authJson || decrypted);
}

async function findCurrentAccount(env, user, body) {
  const currentId = String(body.currentAccountId || body.accountId || body.chatgptAccountId || "").trim();
  const currentEmail = String(body.currentEmail || body.email || "").trim().toLowerCase();
  if (!currentId && !currentEmail) return null;
  return env.DB.prepare(
    `SELECT * FROM accounts
     WHERE user_id = ? AND (
       (? != '' AND chatgpt_account_id = ?)
       OR (? != '' AND lower(email) = ?)
     )
     LIMIT 1`,
  ).bind(user.id, currentId, currentId, currentEmail, currentEmail).first();
}

async function requireUser(request, env) {
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

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 4 * 1024 * 1024) throw new Error("request body too large");
  return JSON.parse(text);
}

async function handleOauthExchange(request) {
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

async function handleAuth(request, env, path) {
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

async function listAccounts(env, user) {
  const rows = await env.DB.prepare(
    `SELECT a.*, us.usage_json
     FROM accounts a
     LEFT JOIN usage_snapshots us ON us.id = (
       SELECT id FROM usage_snapshots
       WHERE account_id = a.id
       ORDER BY created_at DESC
       LIMIT 1
     )
     WHERE a.user_id = ?
     ORDER BY a.updated_at DESC`,
  ).bind(user.id).all();
  return (rows.results || []).map((row) => accountSummary(row, row.usage_json ? JSON.parse(row.usage_json) : null));
}

async function upsertAccount(env, user, item) {
  const session = normalizeSession(item.session || item.authJson || item);
  const tokens = session.tokens || {};
  const accountId = tokens.account_id || "";
  const accessPayload = decodeJwtPayload(tokens.access_token || "");
  const planType = bestPlan(session.profile?.plan, item.usage?.plan_type, item.usage?.planType);
  const expiresAt = session.expires || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");
  const hasRefreshToken = Boolean(tokens.refresh_token && tokens.refresh_token !== tokens.access_token && tokens.refresh_token !== "rt_mock_token");
  const email = item.email || session.email || "";
  const now = nowIso();
  const existing = await env.DB.prepare(
    `SELECT id, plan_type FROM accounts
     WHERE user_id = ? AND (
       (chatgpt_account_id != '' AND chatgpt_account_id = ?)
       OR (email != '' AND email = ?)
     )
     LIMIT 1`,
  ).bind(user.id, accountId, email).first();
  const id = existing?.id || crypto.randomUUID();
  const name = item.name || email || accountId || "Unnamed Account";
  const resolvedPlanType = bestPlan(existing?.plan_type, planType);
  const encrypted = await encryptSecret(env, {
    session,
    importedAt: now,
    source: item.source || session.sourceType || "import",
  });

  if (existing) {
    await env.DB.prepare(
      `UPDATE accounts
       SET name = ?, email = ?, group_name = ?, priority = ?, usage_note = ?, expiry_note = ?,
           chatgpt_account_id = ?, plan_type = ?, expires_at = ?, has_refresh_token = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      name,
      email,
      item.group || item.groupName || "默认",
      item.priority || "normal",
      item.usageNote || item.usage_note || "",
      item.expiryNote || item.expiry_note || expiresAt || "",
      accountId,
      resolvedPlanType,
      expiresAt,
      hasRefreshToken ? 1 : 0,
      now,
      id,
      user.id,
    ).run();
    await env.DB.prepare(
      "UPDATE account_secrets SET encrypted_auth_json = ?, updated_at = ? WHERE account_id = ? AND user_id = ?",
    ).bind(encrypted, now, id, user.id).run();
    await env.DB.prepare("DELETE FROM usage_snapshots WHERE account_id = ? AND user_id = ?").bind(id, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO accounts
       (id, user_id, name, email, group_name, priority, usage_note, expiry_note, chatgpt_account_id, plan_type, expires_at, has_refresh_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      user.id,
      name,
      email,
      item.group || item.groupName || "默认",
      item.priority || "normal",
      item.usageNote || item.usage_note || "",
      item.expiryNote || item.expiry_note || expiresAt || "",
      accountId,
      resolvedPlanType,
      expiresAt,
      hasRefreshToken ? 1 : 0,
      now,
      now,
    ).run();
    await env.DB.prepare(
      "INSERT INTO account_secrets (account_id, user_id, encrypted_auth_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, user.id, encrypted, now, now).run();
  }

  if (item.usage) {
    await env.DB.prepare(
      "INSERT INTO usage_snapshots (id, account_id, user_id, usage_json, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), id, user.id, JSON.stringify(normalizeUsage(item.usage, resolvedPlanType)), 1, "", now).run();
  }
  return existing ? "updated" : "added";
}

async function handleAccounts(request, env, user, path) {
  if (request.method === "GET" && path === "/api/accounts") {
    return json({ ok: true, accounts: await listAccounts(env, user) });
  }

  if (request.method === "POST" && path === "/api/accounts/import") {
    const body = await readJson(request);
    const items = Array.isArray(body.accounts) ? body.accounts : [];
    if (!items.length) return json({ ok: false, error: "没有可导入账号" }, 400);
    let added = 0;
    let updated = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const result = await upsertAccount(env, user, item);
        if (result === "added") added++;
        else updated++;
      } catch {
        failed++;
      }
    }
    await writeAudit(env, user, {
      action: "import",
      result: `added:${added},updated:${updated},failed:${failed}`,
      metadata: { total: items.length },
    });
    return json({ ok: true, added, updated, failed });
  }

  if (request.method === "POST" && path === "/api/accounts/usage/refresh-all") {
    return json({ ok: true, accounts: await listAccounts(env, user) });
  }

  const match = path.match(/^\/api\/accounts\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const accountId = decodeURIComponent(match[1]);
  const action = match[2] || "";

  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?").bind(accountId, user.id).first();
  if (!account) return json({ ok: false, error: "账号不存在" }, 404);

  if (request.method === "DELETE" && !action) {
    await env.DB.prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?").bind(accountId, user.id).run();
    return json({ ok: true });
  }

  if (request.method === "PATCH" && !action) {
    const body = await readJson(request);
    await env.DB.prepare(
      `UPDATE accounts
       SET name = COALESCE(?, name), email = COALESCE(?, email), group_name = COALESCE(?, group_name),
           priority = COALESCE(?, priority), usage_note = COALESCE(?, usage_note), expiry_note = COALESCE(?, expiry_note),
           updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      body.name ?? null,
      body.email ?? null,
      body.group ?? body.groupName ?? null,
      body.priority ?? null,
      body.usageNote ?? body.usage_note ?? null,
      body.expiryNote ?? body.expiry_note ?? null,
      nowIso(),
      accountId,
      user.id,
    ).run();
    return json({ ok: true });
  }

  if (request.method === "POST" && action === "usage") {
    const body = await readJson(request);
    const usage = normalizeUsage(body.usage || body.usage_snapshot, account.plan_type || "");
    usage.plan_type = bestPlan(account.plan_type, usage.plan_type);
    if (body.error) usage.error = body.error;
    if (body.ok === false) usage.status = "刷新失败";
    await env.DB.prepare(
      "INSERT INTO usage_snapshots (id, account_id, user_id, usage_json, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), accountId, user.id, JSON.stringify(usage), body.ok === false ? 0 : 1, body.error || "", nowIso()).run();
    await env.DB.prepare("UPDATE accounts SET plan_type = COALESCE(?, plan_type), updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(usage.plan_type || null, nowIso(), accountId, user.id).run();
    return json({ ok: true, usage });
  }

  if (request.method === "POST" && action === "switch-payload") {
    const authJson = await switchPayloadForAccount(env, user, accountId);
    const now = nowIso();
    await env.DB.prepare("UPDATE accounts SET last_switch_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(now, now, accountId, user.id).run();
    const body = await readJson(request);
    if (body.audit !== false) {
      await writeAudit(env, user, {
        accountId,
        action: "switch-payload",
        result: "payload-issued",
        deviceKey: body.deviceKey || "",
        metadata: { source: "cloud" },
      });
    }
    return json({ ok: true, authJson });
  }

  return null;
}

async function writeAudit(env, user, body) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, user_id, account_id, action, result, device_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    user.id,
    body.accountId || body.account_id || "",
    body.action || "event",
    body.result || "",
    body.deviceKey || body.device_key || "",
    JSON.stringify(body.metadata || {}),
    nowIso(),
  ).run();
}

async function handleDevicesAndAudit(request, env, user, path) {
  if (request.method === "GET" && path === "/api/devices") {
    const rows = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC").bind(user.id).all();
    return json({ ok: true, devices: rows.results || [] });
  }

  if (request.method === "POST" && path === "/api/devices/auto-switch-token") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    const token = `cdh_${randomToken(36)}`;
    const tokenHash = await sha256(token);
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_key, name, helper_online, helper_base, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_key) DO UPDATE SET
         name = excluded.name,
         helper_online = excluded.helper_online,
         helper_base = excluded.helper_base,
         last_seen_at = excluded.last_seen_at`,
    ).bind(
      crypto.randomUUID(),
      user.id,
      key,
      String(body.name || "Dock Helper").slice(0, 120),
      1,
      String(body.helperBase || "").slice(0, 200),
      now,
      now,
    ).run();
    await env.DB.prepare("UPDATE device_tokens SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND device_key = ? AND status = 'active'")
      .bind(now, user.id, key).run();
    await env.DB.prepare(
      "INSERT INTO device_tokens (id, user_id, device_key, token_hash, name, status, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, '')",
    ).bind(crypto.randomUUID(), user.id, key, tokenHash, String(body.name || "Dock Helper").slice(0, 120), now, now).run();
    const settings = await readAutoSwitchSettings(env, user);
    await writeAudit(env, user, {
      action: "helper-token",
      result: "issued",
      deviceKey: key,
      metadata: { helperBase: body.helperBase || "" },
    });
    return json({ ok: true, deviceToken: token, settings, cloudBase: new URL(request.url).origin });
  }

  if (request.method === "DELETE" && path === "/api/devices/auto-switch-token") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    await env.DB.prepare("UPDATE device_tokens SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND device_key = ? AND status = 'active'")
      .bind(now, user.id, key).run();
    await writeAudit(env, user, { action: "helper-token", result: "revoked", deviceKey: key });
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "/api/devices/register") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_key, name, helper_online, helper_base, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_key) DO UPDATE SET
         name = excluded.name,
         helper_online = excluded.helper_online,
         helper_base = excluded.helper_base,
         last_seen_at = excluded.last_seen_at`,
    ).bind(
      crypto.randomUUID(),
      user.id,
      key,
      String(body.name || "Browser").slice(0, 120),
      body.helperOnline ? 1 : 0,
      String(body.helperBase || "").slice(0, 200),
      now,
      now,
    ).run();
    return json({ ok: true });
  }

  if (request.method === "GET" && path === "/api/audit") {
    const rows = await env.DB.prepare(
      `SELECT audit_logs.*, accounts.name AS account_name
       FROM audit_logs
       LEFT JOIN accounts ON accounts.id = audit_logs.account_id
       WHERE audit_logs.user_id = ?
       ORDER BY audit_logs.created_at DESC
       LIMIT 80`,
    ).bind(user.id).all();
    return json({
      ok: true,
      audit: (rows.results || []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        accountName: row.account_name || "",
        action: row.action,
        result: row.result,
        deviceKey: row.device_key || "",
        createdAt: row.created_at,
      })),
    });
  }

  if (request.method === "POST" && path === "/api/audit") {
    const body = await readJson(request);
    await writeAudit(env, user, body);
    return json({ ok: true });
  }

  return null;
}

async function handleUserSettings(request, env, user, path) {
  if (request.method === "GET" && path === "/api/settings/auto-switch") {
    return json({ ok: true, settings: await readAutoSwitchSettings(env, user) });
  }

  if (request.method === "PATCH" && path === "/api/settings/auto-switch") {
    const body = await readJson(request);
    const settings = await saveAutoSwitchSettings(env, user, body.settings || body);
    await writeAudit(env, user, { action: "auto-switch-settings", result: settings.enabled ? "enabled" : "updated" });
    return json({ ok: true, settings });
  }

  if (request.method === "POST" && path === "/api/auth/change-password") {
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword || "");
    const nextPassword = String(body.nextPassword || "");
    if (nextPassword.length < 8) return json({ ok: false, error: "新密码至少 8 位" }, 400);
    const row = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(user.id).first();
    if (!row) return json({ ok: false, error: "用户不存在" }, 404);
    const currentHash = await passwordHash(currentPassword, row.password_salt);
    if (!timingSafeEqual(currentHash, row.password_hash)) return json({ ok: false, error: "当前密码不正确" }, 401);
    const salt = randomToken(18);
    const hash = await passwordHash(nextPassword, salt);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, nowIso(), user.id).run();
    await writeAudit(env, user, { action: "change-password", result: "ok" });
    return json({ ok: true });
  }

  return null;
}

async function requireHelperDevice(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const tokenHash = await sha256(match[1].trim());
  const row = await env.DB.prepare(
    `SELECT device_tokens.id AS token_id, device_tokens.device_key, device_tokens.name AS device_name,
            users.id, users.email, users.role, users.status, users.created_at, users.updated_at, users.last_login_at
     FROM device_tokens
     JOIN users ON users.id = device_tokens.user_id
     WHERE device_tokens.token_hash = ?
       AND device_tokens.status = 'active'
       AND device_tokens.revoked_at = ''
     LIMIT 1`,
  ).bind(tokenHash).first();
  if (!row || (row.status || "active") !== "active") return null;
  const now = nowIso();
  await env.DB.prepare("UPDATE device_tokens SET last_seen_at = ? WHERE id = ?").bind(now, row.token_id).run();
  await env.DB.prepare("UPDATE devices SET helper_online = 1, last_seen_at = ? WHERE user_id = ? AND device_key = ?")
    .bind(now, row.id, row.device_key).run();
  return {
    user: {
      id: row.id,
      email: row.email,
      role: row.role || "user",
      status: row.status || "active",
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login_at: row.last_login_at,
    },
    deviceKey: row.device_key || "",
    tokenId: row.token_id,
    name: row.device_name || "Dock Helper",
  };
}

async function handleHelperAutoSwitch(request, env, path) {
  if (!path.startsWith("/api/helper/auto-switch")) return null;
  const helper = await requireHelperDevice(request, env);
  if (!helper) return json({ ok: false, error: "Helper 授权已失效，请重新授权" }, 401);
  const user = helper.user;
  const settings = await readAutoSwitchSettings(env, user);

  if (request.method === "GET" && path === "/api/helper/auto-switch/config") {
    return json({ ok: true, settings, deviceKey: helper.deviceKey, serverTime: nowIso() });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/current-usage") {
    const body = await readJson(request);
    const usage = normalizeUsage(body.usage || body.usage_snapshot, body.planType || "");
    if (body.error) usage.error = body.error;
    const current = await findCurrentAccount(env, user, body);
    if (current) {
      await env.DB.prepare(
        "INSERT INTO usage_snapshots (id, account_id, user_id, usage_json, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        current.id,
        user.id,
        JSON.stringify(usage),
        body.ok === false || body.error ? 0 : 1,
        body.error || "",
        nowIso(),
      ).run();
      await env.DB.prepare("UPDATE accounts SET plan_type = COALESCE(?, plan_type), updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(usage.plan_type || null, nowIso(), current.id, user.id).run();
    }
    const trigger = isSwitchTriggerUsage(usage, body.error || "", settings);
    if (trigger.yes || body.error) {
      await writeAudit(env, user, {
        accountId: current?.id || "",
        action: "auto-switch-check",
        result: trigger.yes ? `trigger:${trigger.reason}` : "error",
        deviceKey: helper.deviceKey,
        metadata: {
          matched: Boolean(current),
          error: body.error || "",
          currentAccountId: body.currentAccountId || "",
        },
      });
    }
    return json({ ok: true, matchedAccountId: current?.id || "", trigger });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/next") {
    const body = await readJson(request);
    if (!settings.enabled) return json({ ok: true, shouldSwitch: false, reason: "自动切换未开启" });
    const usage = normalizeUsage(body.usage || body.usage_snapshot, body.planType || "");
    if (body.error) usage.error = body.error;
    const trigger = isSwitchTriggerUsage(usage, body.error || "", settings);
    if (!trigger.yes && !body.force) return json({ ok: true, shouldSwitch: false, reason: "未命中切换条件" });

    const accounts = await listAccounts(env, user);
    const scored = accounts
      .map((account) => ({ account, score: candidateScore(account, settings, body) }))
      .filter((item) => item.score > -60000)
      .sort((a, b) => b.score - a.score);
    const selected = scored[0]?.account || null;
    if (!selected) {
      await writeAudit(env, user, {
        action: "auto-switch",
        result: "no-candidate",
        deviceKey: helper.deviceKey,
        metadata: { trigger: trigger.reason },
      });
      return json({ ok: true, shouldSwitch: false, reason: "没有可用候选账号" });
    }
    const authJson = await switchPayloadForAccount(env, user, selected.id);
    const now = nowIso();
    await env.DB.prepare("UPDATE accounts SET last_switch_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(now, now, selected.id, user.id).run();
    await writeAudit(env, user, {
      accountId: selected.id,
      action: "auto-switch",
      result: "payload-issued",
      deviceKey: helper.deviceKey,
      metadata: {
        trigger: trigger.reason,
        score: scored[0].score,
        reason: candidateReasons(selected, settings),
      },
    });
    return json({
      ok: true,
      shouldSwitch: true,
      reason: trigger.reason,
      account: {
        id: selected.id,
        name: selected.name,
        email: selected.email,
        accountId: selected.accountId,
        planType: selected.planType,
        reason: candidateReasons(selected, settings),
      },
      authJson,
    });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/audit") {
    const body = await readJson(request);
    await writeAudit(env, user, {
      accountId: body.accountId || body.account_id || "",
      action: "auto-switch-helper",
      result: body.result || "",
      deviceKey: helper.deviceKey,
      metadata: body.metadata || {},
    });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

function assertAdmin(user) {
  return (user?.role || "user") === "admin";
}

async function adminSummary(env) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [users, accounts, sessions, imports, switches] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM sessions WHERE expires_at > ?").bind(nowIso()).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'import' AND created_at > ?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action IN ('switch', 'switch-payload') AND created_at > ?").bind(since).first(),
  ]);
  return {
    users: Number(users?.total || 0),
    activeUsers: Number(users?.active || 0),
    accounts: Number(accounts?.total || 0),
    onlineSessions: Number(sessions?.total || 0),
    imports24h: Number(imports?.total || 0),
    switches24h: Number(switches?.total || 0),
  };
}

async function adminUsers(env) {
  const rows = await env.DB.prepare(
    `SELECT users.id, users.email, users.role, users.status, users.created_at, users.updated_at, users.last_login_at,
            COUNT(DISTINCT accounts.id) AS account_count,
            COUNT(DISTINCT sessions.id) AS session_count,
            MAX(sessions.last_seen_at) AS last_seen_at
     FROM users
     LEFT JOIN accounts ON accounts.user_id = users.id
     LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > ?
     GROUP BY users.id
     ORDER BY users.created_at ASC`,
  ).bind(nowIso()).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role || "user",
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || "",
    lastSeenAt: row.last_seen_at || "",
    accountCount: Number(row.account_count || 0),
    sessionCount: Number(row.session_count || 0),
  }));
}

function likeTerm(value) {
  return `%${String(value || "").trim().toLowerCase().replace(/[%_]/g, "")}%`;
}

async function adminFilteredUsers(env, url) {
  const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
  const role = String(url.searchParams.get("role") || "");
  const status = String(url.searchParams.get("status") || "");
  const clauses = [];
  const binds = [nowIso()];
  if (query) {
    clauses.push("LOWER(users.email) LIKE ?");
    binds.push(likeTerm(query));
  }
  if (["admin", "user"].includes(role)) {
    clauses.push("users.role = ?");
    binds.push(role);
  }
  if (["active", "disabled"].includes(status)) {
    clauses.push("users.status = ?");
    binds.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT users.id, users.email, users.role, users.status, users.created_at, users.updated_at, users.last_login_at,
            COUNT(DISTINCT accounts.id) AS account_count,
            COUNT(DISTINCT sessions.id) AS session_count,
            MAX(sessions.last_seen_at) AS last_seen_at
     FROM users
     LEFT JOIN accounts ON accounts.user_id = users.id
     LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > ?
     ${where}
     GROUP BY users.id
     ORDER BY users.created_at ASC
     LIMIT 500`,
  ).bind(...binds).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role || "user",
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || "",
    lastSeenAt: row.last_seen_at || "",
    accountCount: Number(row.account_count || 0),
    sessionCount: Number(row.session_count || 0),
  }));
}

async function adminUserSummary(env, targetUserId) {
  const [user, accountCount, sessionCount, deviceCount, lastAudit] = await Promise.all([
    env.DB.prepare("SELECT id, email, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?").bind(targetUserId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?").bind(targetUserId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM sessions WHERE user_id = ? AND expires_at > ?").bind(targetUserId, nowIso()).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM devices WHERE user_id = ?").bind(targetUserId).first(),
    env.DB.prepare("SELECT action, result, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 8").bind(targetUserId).all(),
  ]);
  if (!user) return null;
  return {
    user: publicUser(user),
    accountCount: Number(accountCount?.total || 0),
    sessionCount: Number(sessionCount?.total || 0),
    deviceCount: Number(deviceCount?.total || 0),
    recentAudit: lastAudit.results || [],
  };
}

async function adminUserAccounts(env, targetUserId) {
  const rows = await env.DB.prepare(
    `SELECT a.*, us.usage_json
     FROM accounts a
     LEFT JOIN usage_snapshots us ON us.id = (
       SELECT id FROM usage_snapshots
       WHERE account_id = a.id
       ORDER BY created_at DESC
       LIMIT 1
     )
     WHERE a.user_id = ?
     ORDER BY a.updated_at DESC
     LIMIT 500`,
  ).bind(targetUserId).all();
  return (rows.results || []).map((row) => accountSummary(row, row.usage_json ? JSON.parse(row.usage_json) : null));
}

async function adminDevices(env) {
  const rows = await env.DB.prepare(
    `SELECT devices.*, users.email AS user_email
     FROM devices
     LEFT JOIN users ON users.id = devices.user_id
     ORDER BY devices.last_seen_at DESC
     LIMIT 500`,
  ).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email || "",
    name: row.name || "",
    helperOnline: Boolean(row.helper_online),
    helperBase: row.helper_base || "",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

async function ensureAnotherAdmin(env, targetUserId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
    .bind(targetUserId).first();
  return Number(row?.total || 0) > 0;
}

async function handleAdmin(request, env, user, path) {
  if (!path.startsWith("/api/admin")) return null;
  if (!assertAdmin(user)) return json({ ok: false, error: "没有管理员权限" }, 403);
  const url = new URL(request.url);

  if (request.method === "GET" && path === "/api/admin/summary") {
    return json({ ok: true, summary: await adminSummary(env) });
  }

  if (request.method === "GET" && path === "/api/admin/users") {
    return json({ ok: true, users: await adminFilteredUsers(env, url) });
  }

  if (request.method === "GET" && path === "/api/admin/devices") {
    return json({ ok: true, devices: await adminDevices(env) });
  }

  if (request.method === "GET" && path === "/api/admin/audit") {
    const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
    const action = String(url.searchParams.get("action") || "").trim();
    const from = String(url.searchParams.get("from") || "").trim();
    const to = String(url.searchParams.get("to") || "").trim();
    const clauses = [];
    const binds = [];
    if (query) {
      clauses.push("(LOWER(users.email) LIKE ? OR LOWER(accounts.name) LIKE ? OR LOWER(accounts.email) LIKE ?)");
      binds.push(likeTerm(query), likeTerm(query), likeTerm(query));
    }
    if (action) {
      clauses.push("audit_logs.action = ?");
      binds.push(action);
    }
    if (from) {
      clauses.push("audit_logs.created_at >= ?");
      binds.push(from);
    }
    if (to) {
      clauses.push("audit_logs.created_at <= ?");
      binds.push(to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT audit_logs.id, audit_logs.user_id, users.email AS user_email,
              audit_logs.account_id, accounts.name AS account_name,
              audit_logs.action, audit_logs.result, audit_logs.device_key, audit_logs.metadata_json, audit_logs.created_at
       FROM audit_logs
       LEFT JOIN users ON users.id = audit_logs.user_id
       LEFT JOIN accounts ON accounts.id = audit_logs.account_id
       ${where}
       ORDER BY audit_logs.created_at DESC
       LIMIT 200`,
    ).bind(...binds).all();
    return json({
      ok: true,
      audit: (rows.results || []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email || "",
        accountId: row.account_id || "",
        accountName: row.account_name || "",
        action: row.action,
        result: row.result || "",
        deviceKey: row.device_key || "",
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
        createdAt: row.created_at,
      })),
    });
  }

  const match = path.match(/^\/api\/admin\/users\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return json({ ok: false, error: "Not found" }, 404);
  const targetUserId = decodeURIComponent(match[1]);
  const action = match[2] || "";
  const target = await env.DB.prepare("SELECT id, email, role, status FROM users WHERE id = ?").bind(targetUserId).first();
  if (!target) return json({ ok: false, error: "用户不存在" }, 404);

  if (request.method === "GET" && action === "summary") {
    return json({ ok: true, summary: await adminUserSummary(env, targetUserId) });
  }

  if (request.method === "GET" && action === "accounts") {
    return json({ ok: true, accounts: await adminUserAccounts(env, targetUserId) });
  }

  if (request.method === "PATCH" && !action) {
    const body = await readJson(request);
    const nextRole = body.role === undefined ? target.role : String(body.role || "user");
    const nextStatus = body.status === undefined ? target.status : String(body.status || "active");
    if (!["admin", "user"].includes(nextRole)) return json({ ok: false, error: "角色不合法" }, 400);
    if (!["active", "disabled"].includes(nextStatus)) return json({ ok: false, error: "状态不合法" }, 400);
    const wouldRemoveAdmin = target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active");
    if (wouldRemoveAdmin && !(await ensureAnotherAdmin(env, targetUserId))) {
      return json({ ok: false, error: "至少保留一个可用管理员" }, 400);
    }
    await env.DB.prepare("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(nextRole, nextStatus, nowIso(), targetUserId).run();
    if (nextStatus !== "active") await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
    await writeAudit(env, user, {
      action: "admin-update-user",
      result: "ok",
      metadata: { targetUserId, role: nextRole, status: nextStatus },
    });
    return json({ ok: true });
  }

  if (request.method === "POST" && action === "reset-password") {
    const tempPassword = temporaryPassword();
    const salt = randomToken(18);
    const hash = await passwordHash(tempPassword, salt);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, nowIso(), targetUserId).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
    await writeAudit(env, user, {
      action: "admin-reset-password",
      result: "ok",
      metadata: { targetUserId },
    });
    return json({ ok: true, temporaryPassword: tempPassword });
  }

  if (request.method === "DELETE" && action === "sessions") {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
    await writeAudit(env, user, {
      action: "admin-delete-sessions",
      result: "ok",
      metadata: { targetUserId },
    });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response("", { status: 204 });
  if (request.method === "GET" && path === "/api/health") return json({ ok: true, mode: "codex-cloud-console" });
  if (path === "/api/oauth/exchange") return handleOauthExchange(request);

  const auth = await handleAuth(request, env, path);
  if (auth) return auth;

  const helperAutoSwitch = await handleHelperAutoSwitch(request, env, path);
  if (helperAutoSwitch) return helperAutoSwitch;

  const user = await requireUser(request, env);
  if (request.method === "GET" && path === "/api/me" && !user) {
    return json({ ok: true, user: null });
  }
  if (!user) return json({ ok: false, error: "未登录" }, 401);

  if (request.method === "GET" && path === "/api/me") {
    return json({ ok: true, user: publicUser(user) });
  }

  return (await handleUserSettings(request, env, user, path))
    || (await handleAdmin(request, env, user, path))
    || (await handleAccounts(request, env, user, path))
    || (await handleDevicesAndAudit(request, env, user, path))
    || json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ ok: false, error: error.message || "Internal error" }, 500);
    }
  },
};
