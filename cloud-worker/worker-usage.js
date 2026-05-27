import {
  ApiError,
  decryptSecret,
  json,
  nowIso,
  readJson,
} from "./worker-shared.js";
import {
  bestPlan,
  normalizeSession,
  normalizeUsage,
} from "./worker-accounts.js";

const CLOUD_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CLOUD_USAGE_TIMEOUT_MS = 12000;
const CLOUD_USAGE_MAX_RESPONSE_BYTES = 256 * 1024;

export const DEFAULT_USAGE_REFRESH_SETTINGS = {
  usageRefreshMode: "helper",
  cloudUsageRefreshEnabled: false,
  helperFallbackToCloud: false,
  usageRefreshConcurrency: 1,
  usageRefreshIntervalMs: 1500,
  lastUsageRefreshSource: "",
  lastUsageRefreshAt: "",
};

function boolValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["false", "0", "off", "no"].includes(value.toLowerCase());
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeUsageRefreshSettings(input = {}, base = DEFAULT_USAGE_REFRESH_SETTINGS) {
  const next = { ...DEFAULT_USAGE_REFRESH_SETTINGS, ...(base || {}), ...(input || {}) };
  const mode = ["helper", "cloud", "auto", "manual"].includes(next.usageRefreshMode)
    ? next.usageRefreshMode
    : DEFAULT_USAGE_REFRESH_SETTINGS.usageRefreshMode;
  return {
    usageRefreshMode: mode,
    cloudUsageRefreshEnabled: boolValue(next.cloudUsageRefreshEnabled, DEFAULT_USAGE_REFRESH_SETTINGS.cloudUsageRefreshEnabled),
    helperFallbackToCloud: boolValue(next.helperFallbackToCloud, DEFAULT_USAGE_REFRESH_SETTINGS.helperFallbackToCloud),
    usageRefreshConcurrency: clampNumber(next.usageRefreshConcurrency, DEFAULT_USAGE_REFRESH_SETTINGS.usageRefreshConcurrency, 1, 3),
    usageRefreshIntervalMs: clampNumber(next.usageRefreshIntervalMs, DEFAULT_USAGE_REFRESH_SETTINGS.usageRefreshIntervalMs, 1000, 10000),
    lastUsageRefreshSource: String(next.lastUsageRefreshSource || "").slice(0, 40),
    lastUsageRefreshAt: String(next.lastUsageRefreshAt || "").slice(0, 40),
  };
}

export async function readUsageRefreshSettings(env, user) {
  const row = await env.DB.prepare("SELECT usage_refresh_json FROM user_settings WHERE user_id = ?").bind(user.id).first();
  if (!row?.usage_refresh_json) return normalizeUsageRefreshSettings();
  try {
    return normalizeUsageRefreshSettings(JSON.parse(row.usage_refresh_json));
  } catch {
    return normalizeUsageRefreshSettings();
  }
}

export async function saveUsageRefreshSettings(env, user, patch = {}) {
  const current = await readUsageRefreshSettings(env, user);
  const next = normalizeUsageRefreshSettings(patch, current);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, auto_switch_json, usage_refresh_json, created_at, updated_at)
     VALUES (?, '{}', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       usage_refresh_json = excluded.usage_refresh_json,
       updated_at = excluded.updated_at`,
  ).bind(user.id, JSON.stringify(next), now, now).run();
  return next;
}

function dailyCloudLimit(env) {
  return clampNumber(env.CLOUD_USAGE_REFRESH_DAILY_LIMIT, 30, 1, 500);
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function ensureCloudRefreshAllowance(env, user) {
  const limit = dailyCloudLimit(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM usage_snapshots WHERE user_id = ? AND refresh_source IN ('cloud-worker', 'auto-cloud-fallback') AND created_at >= ?",
  ).bind(user.id, startOfUtcDay()).first();
  const used = Number(row?.total || 0);
  if (used >= limit) {
    throw new ApiError(`今日云端刷新次数已达上限（${limit} 次），请改用本机 Agent。`, 429, "cloud_usage_daily_limit");
  }
  return { used, limit, remaining: limit - used };
}

async function boundedResponseJson(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > CLOUD_USAGE_MAX_RESPONSE_BYTES) {
      throw new ApiError("用量接口响应过大", 502, "usage_response_too_large");
    }
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CLOUD_USAGE_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ApiError("用量接口响应过大", 502, "usage_response_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged));
}

function collectUsageWindows(value, results = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 5 || results.length > 20) return results;
  if (!Array.isArray(value)) {
    const seconds = Number(value.limit_window_seconds ?? value.window_seconds ?? value.limitWindowSeconds);
    const used = Number(value.used_percent ?? value.usedPercent);
    if (Number.isFinite(seconds) && Number.isFinite(used)) {
      results.push({
        used_percent: Math.max(0, Math.min(100, used)),
        window_seconds: seconds,
        reset_at: value.reset_at ?? value.resetAt ?? null,
      });
    }
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    collectUsageWindows(item, results, depth + 1);
  }
  return results;
}

function nearestWindow(windows, targetSeconds) {
  let selected = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const item of windows) {
    const nextDistance = Math.abs(item.window_seconds - targetSeconds);
    if (nextDistance < distance) {
      selected = item;
      distance = nextDistance;
    }
  }
  return selected;
}

export function mapCloudUsagePayload(payload, fallbackPlan = "", source = "cloud-worker") {
  const windows = collectUsageWindows(payload);
  return normalizeUsage({
    fetched_at: Math.floor(Date.now() / 1000),
    refreshed_at: nowIso(),
    plan_type: bestPlan(payload?.plan_type, payload?.planType, fallbackPlan),
    five_hour: nearestWindow(windows, 5 * 60 * 60),
    one_week: nearestWindow(windows, 7 * 24 * 60 * 60),
    credits: payload?.credits || null,
    refresh_source: source,
  }, fallbackPlan);
}

async function readCloudAccountSecret(env, user, accountId) {
  const row = await env.DB.prepare(
    `SELECT a.id, a.plan_type, s.encrypted_auth_json
     FROM accounts a
     JOIN account_secrets s ON s.account_id = a.id AND s.user_id = a.user_id
     WHERE a.id = ? AND a.user_id = ?
     LIMIT 1`,
  ).bind(accountId, user.id).first();
  if (!row?.encrypted_auth_json) throw new ApiError("账号密钥不存在", 404, "account_secret_missing");
  const decrypted = await decryptSecret(env, row.encrypted_auth_json);
  const session = normalizeSession(decrypted.session || decrypted.authJson || decrypted);
  if (!session.tokens?.access_token || !session.tokens?.account_id) {
    throw new ApiError("账号缺少云端额度刷新所需授权，请重新导入。", 409, "usage_auth_missing");
  }
  return { row, session };
}

export async function fetchCloudUsage(env, user, accountId, options = {}) {
  const source = options.source === "auto-cloud-fallback" ? "auto-cloud-fallback" : "cloud-worker";
  await ensureCloudRefreshAllowance(env, user);
  const { row, session } = await readCloudAccountSecret(env, user, accountId);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_USAGE_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchImpl(CLOUD_USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.tokens.access_token}`,
        "ChatGPT-Account-Id": session.tokens.account_id,
        "User-Agent": "codex-dock-cloud-console/usage-refresh",
      },
      signal: controller.signal,
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? "云端额度刷新超时" : "云端无法连接用量接口";
    throw new ApiError(message, 502, "cloud_usage_request_failed");
  } finally {
    clearTimeout(timeout);
  }
  if (!upstream.ok) {
    throw new ApiError(`ChatGPT 用量接口返回 ${upstream.status}`, 502, "cloud_usage_upstream_error");
  }
  let payload;
  try {
    payload = await boundedResponseJson(upstream);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("ChatGPT 用量响应无法解析", 502, "cloud_usage_invalid_response");
  }
  return mapCloudUsagePayload(payload, row.plan_type || "", source);
}

async function storeSnapshot(env, user, accountId, usage, ok, error, source, kind = "manual") {
  await env.DB.prepare(
    `INSERT INTO usage_snapshots
       (id, account_id, user_id, usage_json, ok, error, refresh_source, refresh_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    accountId,
    user.id,
    JSON.stringify(usage),
    ok ? 1 : 0,
    error || "",
    source,
    kind,
    nowIso(),
  ).run();
  await env.DB.prepare("UPDATE accounts SET plan_type = COALESCE(?, plan_type), updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(usage.plan_type || null, nowIso(), accountId, user.id).run();
}

export async function handleUsageRoutes(request, env, user, path, options = {}) {
  const writeAudit = options.writeAudit || null;

  if (request.method === "GET" && path === "/api/settings/usage-refresh") {
    return json({ ok: true, settings: await readUsageRefreshSettings(env, user) });
  }

  if (request.method === "PATCH" && path === "/api/settings/usage-refresh") {
    const body = await readJson(request);
    const settings = await saveUsageRefreshSettings(env, user, body.settings || body);
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "usage-refresh-settings",
        result: settings.usageRefreshMode,
        metadata: { cloudEnabled: settings.cloudUsageRefreshEnabled, fallback: settings.helperFallbackToCloud },
      });
    }
    return json({ ok: true, settings });
  }

  if (request.method === "POST" && path === "/api/settings/usage-refresh/recent") {
    const body = await readJson(request);
    const settings = await saveUsageRefreshSettings(env, user, {
      lastUsageRefreshSource: body.source || "",
      lastUsageRefreshAt: body.at || nowIso(),
    });
    return json({ ok: true, settings });
  }

  const match = path.match(/^\/api\/accounts\/([^/]+)\/usage\/refresh-cloud$/);
  if (request.method !== "POST" || !match) return null;
  const accountId = decodeURIComponent(match[1]);
  const body = await readJson(request);
  const settings = await readUsageRefreshSettings(env, user);
  if (!settings.cloudUsageRefreshEnabled) {
    return json({ ok: false, error: "请先在设置中授权云端 Worker 刷新额度。", code: "cloud_usage_disabled" }, 409);
  }
  const source = settings.usageRefreshMode === "auto" && body.autoFallback === true
    ? "auto-cloud-fallback"
    : "cloud-worker";
  try {
    const usage = await fetchCloudUsage(env, user, accountId, { source, fetchImpl: options.fetchImpl });
    await storeSnapshot(env, user, accountId, usage, true, "", source, body.background ? "background" : body.batch ? "batch" : "manual");
    const recent = await saveUsageRefreshSettings(env, user, { lastUsageRefreshSource: source, lastUsageRefreshAt: nowIso() });
    if (writeAudit && body.audit !== false) {
      await writeAudit(env, user, {
        accountId,
        action: "usage-refresh",
        result: "ok",
        metadata: { source },
      });
    }
    return json({ ok: true, usage, source, settings: recent });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "云端额度刷新失败";
    const failure = normalizeUsage({ status: "刷新失败", error: message, refresh_source: source }, "");
    await storeSnapshot(env, user, accountId, failure, false, message, source, body.background ? "background" : body.batch ? "batch" : "manual").catch(() => {});
    if (writeAudit && body.audit !== false) {
      await writeAudit(env, user, { accountId, action: "usage-refresh", result: "error", metadata: { source, error: message } });
    }
    const status = error instanceof ApiError ? error.status : 502;
    const code = error instanceof ApiError ? error.code : "cloud_usage_failed";
    return json({ ok: false, error: message, code, usage: failure, source }, status);
  }
}
