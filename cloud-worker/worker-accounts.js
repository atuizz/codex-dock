import {
  ApiError,
  decodeJwtPayload,
  decryptSecret,
  encryptSecret,
  json,
  nowIso,
  readJson,
} from "./worker-shared.js";
import { readAutoSwitchSettings } from "./worker-settings.js";

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

function identityScopeFromSources(sources) {
  const direct = pickAny(sources, [
    "chatgpt_account_id",
    "chatgptAccountId",
    "organization_id",
    "organizationId",
    "org_id",
    "orgId",
    "workspace_id",
    "workspaceId",
    "tenant_id",
    "tenantId",
    "team_id",
    "teamId",
  ]);
  if (direct) return String(direct).trim();
  for (const source of sources) {
    for (const key of ["organization", "org", "workspace", "tenant", "team", "account"]) {
      const nested = objectAt(source, key);
      const id = pick(nested, ["id", "uuid", "slug"]);
      if (id) return String(id).trim();
    }
  }
  return "";
}

export function accountIdentityKeyFromParts(parts = {}) {
  const accountUserId = String(parts.accountUserId || parts.account_user_id || parts.chatgptAccountUserId || parts.chatgpt_account_user_id || "").trim().toLowerCase();
  const accountId = String(parts.accountId || parts.account_id || "").trim().toLowerCase();
  const email = String(parts.email || "").trim().toLowerCase();
  const scope = String(parts.scopeId || parts.scope_id || parts.teamId || parts.team_id || parts.organizationId || parts.organization_id || parts.workspaceId || parts.workspace_id || "").trim().toLowerCase();
  if (accountUserId && scope && scope !== accountUserId) return `account:${accountUserId}|scope:${scope}`;
  if (accountUserId) return `account:${accountUserId}`;
  if (accountId && scope && scope !== accountId) return `account:${accountId}|scope:${scope}`;
  if (accountId) return `account:${accountId}`;
  if (email && scope) return `email:${email}|scope:${scope}`;
  if (email) return `email:${email}`;
  return "";
}

export function canonicalPlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "chatgptplus") return "plus";
  if (["plus", "pro", "team", "enterprise", "free"].includes(plan)) return plan;
  return plan;
}

export function planRank(value) {
  const plan = canonicalPlan(value);
  if (plan === "enterprise") return 5;
  if (plan === "team") return 4;
  if (plan === "pro") return 3;
  if (plan === "plus") return 2;
  if (plan === "free") return 1;
  return 0;
}

export function bestPlan(...values) {
  let best = "";
  for (const value of values) {
    const plan = canonicalPlan(value);
    if (!plan) continue;
    if (!best || planRank(plan) > planRank(best)) best = plan;
  }
  return best;
}

export const USAGE_STALE_MS = 30 * 60 * 1000;

function parseUsageTimestamp(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function usageTimestampIso(value) {
  const timestamp = parseUsageTimestamp(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function usageTimestampMs(usage) {
  if (!usage || typeof usage !== "object") return NaN;
  const refreshed = parseUsageTimestamp(usage.refreshed_at ?? usage.refreshedAt);
  if (Number.isFinite(refreshed)) return refreshed;
  return parseUsageTimestamp(usage.fetched_at ?? usage.fetchedAt);
}

export function usageFresh(usage, baseMs = Date.now(), maxAgeMs = USAGE_STALE_MS) {
  const timestamp = usageTimestampMs(usage);
  if (!Number.isFinite(timestamp)) return false;
  if (timestamp - baseMs > 5 * 60 * 1000) return false;
  return baseMs - timestamp <= maxAgeMs;
}

export function usageRemaining(window) {
  if (!window || typeof window !== "object") return null;
  const direct = Number(window.remaining_percent ?? window.remainingPercent);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
  const used = Number(window.used_percent ?? window.usedPercent ?? window.used);
  if (Number.isFinite(used)) return Math.max(0, Math.min(100, 100 - used));
  return null;
}

function normalizeUsageWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const remaining = usageRemaining(raw);
  const used = Number(raw.used_percent ?? raw.usedPercent ?? raw.used);
  return {
    used_percent: Number.isFinite(used) ? Math.max(0, Math.min(100, used)) : (Number.isFinite(remaining) ? 100 - remaining : null),
    remaining_percent: Number.isFinite(remaining) ? remaining : null,
    window_seconds: Number(raw.window_seconds ?? raw.windowSeconds ?? raw.limit_window_seconds ?? raw.limitWindowSeconds),
    reset_at: raw.reset_at ?? raw.resetAt ?? null,
  };
}

function usageErrorText(usage, extra = "") {
  return String(extra || usage?.error || usage?.message || "").toLowerCase();
}

export function isHardAccountFailure(usage, extra = "") {
  const text = usageErrorText(usage, extra);
  return /(?:\b(?:deactivated|suspended|banned|disabled)\b|account (?:disabled|deactivated|suspended)|organization_deactivated|封禁|封号|停用|账号异常|账号已被禁用)/i.test(text);
}

export function isRefreshTokenInvalidFailure(usage, extra = "") {
  const text = usageErrorText(usage, extra);
  return /(?:invalid_grant|invalid refresh token|refresh token (?:was already used|expired|revoked|invalid)|access token could not be refreshed|could not be refreshed|rt 已失效|refresh_token 已失效|刷新令牌已失效|刷新凭据已失效)/i.test(text);
}

export function isUsageAccessAuthExpiredFailure(usage, extra = "") {
  const text = usageErrorText(usage, extra);
  return /\b401\b/.test(text)
    || text.includes("unauthorized")
    || text.includes("authentication token has been invalidated")
    || text.includes("token has been invalidated")
    || text.includes("token 已失效")
    || text.includes("授权已失效")
    || text.includes("登录状态已失效");
}

function quotaAuthFailureCanStillSwitch(account) {
  return ["team", "enterprise"].includes(canonicalPlan(account?.planType || account?.plan_type || account?.usage?.plan_type));
}

function strongCurrentIdentityKey(identityKey, scopeId = "") {
  const key = String(identityKey || "").trim().toLowerCase();
  if (!key) return "";
  if (String(scopeId || "").trim()) return key;
  return key.includes("|scope:") ? key : "";
}

export function isSwitchTriggerUsage(usage, error, settings) {
  const text = usageErrorText(usage, error);
  const five = usageRemaining(usage?.five_hour || usage?.fiveHour || usage?.short_window || usage?.shortWindow);
  const week = usageRemaining(usage?.one_week || usage?.oneWeek || usage?.long_window || usage?.longWindow);
  if (Number.isFinite(five) && five <= settings.fiveHourThreshold) return { yes: true, reason: `5H 剩余 ${five}%` };
  if (Number.isFinite(week) && week <= settings.oneWeekThreshold) return { yes: true, reason: `7D 剩余 ${week}%` };
  if (/(?:\b(?:401|429|quota|rate limit|usage limit|too many requests|token has been invalidated|invalidated|token expired|invalid_grant)\b|refresh token was already used|access token could not be refreshed|could not be refreshed|已失效|频率|额度)/i.test(text)) {
    return { yes: true, reason: "当前账号不可用或已限流" };
  }
  return { yes: false, reason: "" };
}

export function normalizeSession(source) {
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
  const accountScopeId = identityScopeFromSources([source, tokens, auth, session, user, profile, authPayload, profilePayload]);
  const accountId = pickAny([source, tokens, auth, user], ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId", "id"])
    || authPayload.chatgpt_account_id
    || authPayload.chatgpt_account_user_id
    || "";
  const accountUserId = pickAny([source, tokens, auth, session, user], ["account_user_id", "accountUserId", "chatgpt_account_user_id", "chatgptAccountUserId"])
    || authPayload.chatgpt_account_user_id
    || authPayload.user_id
    || "";
  const accountIdentityKey = pickAny([source, tokens, auth, session, user], ["account_identity_key", "accountIdentityKey"]);
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
    accountScopeId,
    accountUserId,
    accountIdentityKey: accountIdentityKey || accountIdentityKeyFromParts({ accountUserId, accountId, email, scopeId: accountScopeId }),
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

export function normalizeAuthPayload(session) {
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
    email: session.email || "",
    account_scope_id: session.accountScopeId || "",
    account_identity_key: session.accountIdentityKey || "",
    last_refresh: nowIso(),
  };
}

export function hasUsableSessionRefresh(session) {
  const tokens = session?.tokens || {};
  const accessToken = tokens.access_token || "";
  const refreshToken = tokens.refresh_token || "";
  return Boolean(refreshToken && refreshToken !== accessToken && refreshToken !== "rt_mock_token");
}

export function sessionAccessTokenExpiry(session) {
  const token = session?.tokens?.access_token || "";
  const exp = decodeJwtPayload(token).exp;
  if (!exp) return null;
  const time = Number(exp) * 1000;
  return Number.isFinite(time) ? time : null;
}

export function assertSwitchableSession(session) {
  const expiry = sessionAccessTokenExpiry(session);
  if (expiry && expiry <= Date.now() && !hasUsableSessionRefresh(session)) {
    throw new ApiError("账号 access_token 已过期且没有 refresh_token，请重新导入账号。", 409, "account_token_expired");
  }
}

export function normalizeUsage(raw, fallbackPlan = "") {
  if (!raw || typeof raw !== "object") {
    return {
      fetched_at: null,
      refreshed_at: "",
      plan_type: fallbackPlan || "",
      five_hour: null,
      one_week: null,
      primary_window: null,
      credits: null,
      refresh_source: "",
      status: "未刷新",
      error: "",
    };
  }
  return {
    fetched_at: raw.fetched_at ?? raw.fetchedAt ?? null,
    refreshed_at: raw.refreshed_at || raw.refreshedAt || usageTimestampIso(raw.fetched_at ?? raw.fetchedAt) || "",
    plan_type: bestPlan(raw.plan_type, raw.planType, fallbackPlan),
    five_hour: normalizeUsageWindow(raw.five_hour || raw.fiveHour || raw.short_window || raw.shortWindow),
    one_week: normalizeUsageWindow(raw.one_week || raw.oneWeek || raw.long_window || raw.longWindow),
    primary_window: normalizeUsageWindow(raw.primary_window || raw.primaryWindow || raw.primary),
    credits: raw.credits || null,
    refresh_source: raw.refresh_source || raw.refreshSource || "",
    status: raw.status || "已刷新",
    error: raw.error || "",
  };
}

export function accountSummary(row, usage) {
  const usageSummary = usage && typeof usage === "object" ? { ...usage } : null;
  if (usageSummary
    && !usageSummary.refreshed_at
    && !usageSummary.refreshedAt
    && !usageSummary.fetched_at
    && !usageSummary.fetchedAt
    && row.usage_created_at) {
    usageSummary.refreshed_at = row.usage_created_at;
  }
  const planType = bestPlan(row.plan_type, usageSummary?.plan_type, usageSummary?.planType);
  const summary = {
    id: row.id,
    name: row.name,
    email: row.email || "",
    group: row.group_name || "默认",
    priority: row.priority || "normal",
    usageNote: row.usage_note || "",
    expiryNote: row.expiry_note || "",
    accountId: row.chatgpt_account_id || "",
    accountScopeId: row.account_scope_id || "",
    accountIdentityKey: row.account_identity_key || accountIdentityKeyFromParts({
      accountId: row.chatgpt_account_id || "",
      email: row.email || "",
      scopeId: row.account_scope_id || "",
    }),
    planType,
    expiresAt: row.expires_at || "",
    hasRefreshToken: Boolean(row.has_refresh_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretUpdatedAt: row.secret_updated_at || "",
    lastSwitchAt: row.last_switch_at || "",
    usage: usageSummary,
  };
  const credential = accountCodexStatus(summary);
  summary.credentialKind = credential.credentialKind;
  summary.codexUsable = credential.codexUsable;
  summary.codexBlockReason = credential.codexBlockReason;
  return summary;
}

export function accountMatchesCurrent(account, body) {
  const currentId = String(body.currentAccountId || body.accountId || body.chatgptAccountId || "").trim();
  const currentEmail = String(body.currentEmail || body.email || "").trim().toLowerCase();
  const currentScopeId = String(body.currentAccountScopeId || body.accountScopeId || body.account_scope_id || body.currentScopeId || "").trim();
  const rawCurrentIdentityKey = body.currentAccountIdentityKey || body.accountIdentityKey || body.account_identity_key || "";
  const currentIdentityKey = strongCurrentIdentityKey(rawCurrentIdentityKey || accountIdentityKeyFromParts({
    accountId: currentId,
    email: currentEmail,
    scopeId: currentScopeId,
  }), currentScopeId);
  const currentCloudId = String(body.currentCloudAccountId || body.cloudAccountId || "").trim();
  const accountIdentityKeys = new Set([
    String(account.accountIdentityKey || account.account_identity_key || "").trim().toLowerCase(),
    accountIdentityKeyFromParts({
      accountId: account.accountId || account.account_id || "",
      email: account.email || "",
      scopeId: account.accountScopeId || account.account_scope_id || "",
    }),
  ].filter(Boolean));
  if (currentCloudId && account.id === currentCloudId) return true;
  if (currentIdentityKey && accountIdentityKeys.has(currentIdentityKey)) return true;
  if (currentId && account.accountId && account.accountId === currentId && !currentIdentityKey && !rawCurrentIdentityKey) return true;
  return false;
}

export function hasUsableRefresh(account) {
  return Boolean(account.hasRefreshToken);
}

export function accountCredentialKind(account) {
  if (hasUsableRefresh(account)) return "rt";
  if (account?.secretUpdatedAt || account?.session || account?.hasRefreshToken === false) return "at";
  return "unknown";
}

export function accountTokenExpired(account) {
  if (!account.expiresAt) return false;
  const time = new Date(account.expiresAt).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

export function accountCodexStatus(account, options = {}) {
  if (Object.prototype.hasOwnProperty.call(account || {}, "secretUpdatedAt") && !account.secretUpdatedAt && !account.session) {
    return { credentialKind: "unknown", codexUsable: false, codexBlockReason: "missing_secret" };
  }
  const credentialKind = accountCredentialKind(account);
  const allowAtExperimental = Boolean(options.allowAtExperimental);
  const usage = normalizeUsage(account?.usage, account?.planType);
  if (credentialKind === "unknown") {
    return { credentialKind, codexUsable: false, codexBlockReason: "missing_secret" };
  }
  if (credentialKind === "rt") {
    if (isHardAccountFailure(usage)) {
      return { credentialKind, codexUsable: false, codexBlockReason: "account_disabled" };
    }
    if (isRefreshTokenInvalidFailure(usage)
      || (isUsageAccessAuthExpiredFailure(usage) && !quotaAuthFailureCanStillSwitch(account))) {
      return { credentialKind, codexUsable: false, codexBlockReason: "rt_invalid" };
    }
    return { credentialKind, codexUsable: true, codexBlockReason: "" };
  }
  if (!allowAtExperimental) {
    return { credentialKind, codexUsable: false, codexBlockReason: "at_unsupported" };
  }
  if (accountTokenExpired(account)) {
    return { credentialKind, codexUsable: false, codexBlockReason: "token_expired" };
  }
  return { credentialKind, codexUsable: true, codexBlockReason: "" };
}

export function codexBlockMessage(reason) {
  if (reason === "at_unsupported") return "AT 账号当前不支持 Codex 使用";
  if (reason === "rt_invalid") return "RT 已失效";
  if (reason === "account_disabled") return "账号不可用或已失效";
  if (reason === "token_expired") return "Token 已过期且无 RT";
  if (reason === "missing_secret") return "账号密钥不存在";
  return "";
}

function switchPayloadErrorForBlock(reason) {
  if (reason === "at_unsupported") {
    return new ApiError("AT 账号当前不支持 Codex 使用，请重新登录 Codex 获取 RT。", 409, "account_at_not_supported");
  }
  if (reason === "rt_invalid") {
    return new ApiError("账号 refresh_token 已失效或已被使用，请重新登录该账号。", 409, "account_refresh_token_invalid");
  }
  if (reason === "token_expired") {
    return new ApiError("账号 access_token 已过期且没有 refresh_token，请重新导入账号。", 409, "account_token_expired");
  }
  return new ApiError(codexBlockMessage(reason) || "账号当前不可用于 Codex。", 409, reason || "account_not_usable");
}

export function candidateScore(account, settings, body) {
  return candidateDecision(account, settings, body).score;
}

export function candidateDecision(account, settings, body) {
  const plan = canonicalPlan(account.planType);
  const usage = normalizeUsage(account.usage, plan);
  const freshUsage = usageFresh(usage);
  const blocked = (score, reason) => ({ account, score, eligible: false, blocked: reason });
  if (isHardAccountFailure(usage)) return blocked(-100000, "账号不可用或已失效");
  const credential = accountCodexStatus(account, {
    allowAtExperimental: Boolean(settings.allowAt && settings.showExperimentalAt),
  });
  if (!credential.codexUsable) return blocked(-86000, codexBlockMessage(credential.codexBlockReason));
  if (settings.paidOnly && planRank(plan) < planRank("plus")) return blocked(-90000, "已开启仅付费账号");
  if (settings.avoidCurrent && accountMatchesCurrent(account, body)) return blocked(-80000, "避开当前账号");
  if (accountTokenExpired(account) && !hasUsableRefresh(account)) return blocked(-78000, "Token 已过期且无 RT");
  const five = usageRemaining(usage.five_hour);
  const week = usageRemaining(usage.one_week);
  if (freshUsage && settings.avoidLow5h && Number.isFinite(five) && five <= settings.fiveHourThreshold) return blocked(-76000, `5H 剩余 ${five}%`);
  if (freshUsage && settings.avoidLow7d && Number.isFinite(week) && week <= settings.oneWeekThreshold) return blocked(-76000, `7D 剩余 ${week}%`);
  const cooldown = Number(settings.cooldownMinutes || 0);
  if (cooldown && account.lastSwitchAt) {
    const last = new Date(account.lastSwitchAt).getTime();
    if (Number.isFinite(last) && Date.now() - last < cooldown * 60 * 1000) return blocked(-74000, `切换冷却 ${cooldown} 分钟内`);
  }
  const priorityBoost = account.priority === "primary" ? 16 : account.priority === "reserve" ? -16 : 0;
  const rtBoost = settings.preferRt && hasUsableRefresh(account) ? 18 : 0;
  const paidBoost = Math.max(0, planRank(plan) - 1) * 12;
  const fiveScore = freshUsage && Number.isFinite(five) ? five * 0.9 : 38;
  const weekScore = freshUsage && Number.isFinite(week) ? week * 0.35 : 15;
  const stalePenalty = freshUsage ? 0 : -6;
  const score = 20 + paidBoost + rtBoost + priorityBoost + fiveScore + weekScore + stalePenalty;
  return { account, score, eligible: true, blocked: "", reason: candidateReasons(account, settings) };
}

export function candidateDiagnostic(decision) {
  const account = decision.account;
  const usage = normalizeUsage(account.usage, account.planType);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    planType: account.planType,
    score: Math.round(decision.score * 100) / 100,
    eligible: decision.eligible,
    blocked: decision.blocked,
    reason: decision.reason || candidateReasons(account, {}),
    hasRefreshToken: Boolean(account.hasRefreshToken),
    credentialKind: account.credentialKind || accountCredentialKind(account),
    codexUsable: account.codexUsable !== undefined ? Boolean(account.codexUsable) : accountCodexStatus(account).codexUsable,
    codexBlockReason: account.codexBlockReason || accountCodexStatus(account).codexBlockReason,
    secretUpdatedAt: account.secretUpdatedAt || "",
    lastSwitchAt: account.lastSwitchAt || "",
    usageFresh: usageFresh(usage),
    usageRefreshedAt: usage.refreshed_at || "",
    fiveHour: usageRemaining(usage.five_hour),
    oneWeek: usageRemaining(usage.one_week),
    error: usage.error || "",
  };
}

export function summarizeCandidateBlocks(decisions) {
  const counts = new Map();
  for (const item of decisions) {
    const key = item.eligible ? "可用" : (item.blocked || "未知原因");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([reason, count]) => `${reason} ${count}`).join("；");
}

export function candidateReasons(account, settings) {
  const usage = normalizeUsage(account.usage, account.planType);
  const reasons = [];
  const plan = canonicalPlan(account.planType);
  if (plan) reasons.push(plan.toUpperCase());
  reasons.push(hasUsableRefresh(account) ? "可用 RT" : "AT 实验");
  const five = usageRemaining(usage.five_hour);
  const week = usageRemaining(usage.one_week);
  if (usageFresh(usage)) {
    if (Number.isFinite(five)) reasons.push(`5H ${five}%`);
    if (Number.isFinite(week)) reasons.push(`7D ${week}%`);
  } else if (Number.isFinite(five) || Number.isFinite(week) || usage.refreshed_at || usage.fetched_at) {
    reasons.push("额度待刷新");
  } else {
    reasons.push("未刷新额度");
  }
  if (settings.avoidCurrent) reasons.push("避开当前账号");
  return reasons.join("、");
}

export async function switchPayloadForAccount(env, user, accountId, options = {}) {
  const secret = await env.DB.prepare(
    `SELECT a.*, s.encrypted_auth_json, s.updated_at AS secret_updated_at, us.usage_json, us.created_at AS usage_created_at
     FROM account_secrets s
     JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
     LEFT JOIN usage_snapshots us ON us.id = (
       SELECT id FROM usage_snapshots
       WHERE account_id = a.id
       ORDER BY created_at DESC
       LIMIT 1
     )
     WHERE s.account_id = ? AND s.user_id = ?`,
  ).bind(accountId, user.id).first();
  if (!secret) throw new Error("账号密钥不存在");
  const account = accountSummary(secret, secret.usage_json ? JSON.parse(secret.usage_json) : null);
  const credential = accountCodexStatus(account, { allowAtExperimental: Boolean(options.allowAtExperimental) });
  if (!credential.codexUsable) {
    throw switchPayloadErrorForBlock(credential.codexBlockReason);
  }
  const decrypted = await decryptSecret(env, secret.encrypted_auth_json);
  const session = normalizeSession(decrypted.session || decrypted.authJson || decrypted);
  if (!options.allowAtExperimental && !hasUsableSessionRefresh(session)) {
    throw switchPayloadErrorForBlock("at_unsupported");
  }
  assertSwitchableSession(session);
  return normalizeAuthPayload(session);
}

export async function syncCurrentAuthSecret(env, user, authJson, metadata = {}) {
  const source = typeof authJson === "string" ? JSON.parse(authJson) : authJson;
  const session = normalizeSession(source);
  const tokens = session.tokens || {};
  const accountId = tokens.account_id || "";
  const email = session.email || "";
  const accountScopeId = session.accountScopeId || "";
  const accountIdentityKey = session.accountIdentityKey || accountIdentityKeyFromParts({ accountId, email, scopeId: accountScopeId });
  const matchIdentityKey = strongCurrentIdentityKey(accountIdentityKey, accountScopeId);
  const allowAccountIdFallback = !session.accountIdentityKey;
  const hasRefreshToken = hasUsableSessionRefresh(session);
  const existing = await env.DB.prepare(
    `SELECT a.id, a.plan_type, a.last_switch_at, s.encrypted_auth_json
     FROM accounts a
     LEFT JOIN account_secrets s ON s.account_id = a.id AND s.user_id = a.user_id
     WHERE a.user_id = ? AND (
       (? != '' AND a.account_identity_key = ?)
       OR (? != '' AND ? = 1 AND a.account_identity_key = '' AND a.chatgpt_account_id = ?)
     )
     LIMIT 1`,
  ).bind(
    user.id,
    matchIdentityKey,
    matchIdentityKey,
    accountId,
    allowAccountIdFallback ? 1 : 0,
    accountId,
  ).first();
  if (!existing) {
    return { matched: false, synced: false, accountId: "", reason: "未匹配账号" };
  }
  if (!hasRefreshToken) {
    return {
      matched: true,
      synced: false,
      accountId: existing.id,
      reason: "当前 auth 缺少 RT，未覆盖云端密文",
    };
  }
  let sameRefreshToken = false;
  try {
    if (existing.encrypted_auth_json) {
      const decrypted = await decryptSecret(env, existing.encrypted_auth_json);
      const previousSession = normalizeSession(decrypted.session || decrypted.authJson || decrypted);
      sameRefreshToken = previousSession.tokens?.refresh_token === tokens.refresh_token;
    }
  } catch {
    sameRefreshToken = false;
  }
  if (sameRefreshToken) {
    return {
      matched: true,
      synced: false,
      accountId: existing.id,
      reason: "本机 auth 与云端 RT 相同，无需同步",
    };
  }
  const localUpdatedAt = metadata.localUpdatedAt || "";
  const accessPayload = decodeJwtPayload(tokens.access_token || "");
  const expiresAt = session.expires || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");
  const planType = bestPlan(existing.plan_type, session.profile?.plan);
  const now = nowIso();
  const encrypted = await encryptSecret(env, {
    session,
    importedAt: now,
    source: metadata.source || "helper-current-auth",
    localUpdatedAt,
  });
  await env.DB.prepare(
    `UPDATE accounts
     SET email = COALESCE(NULLIF(?, ''), email),
         chatgpt_account_id = COALESCE(NULLIF(?, ''), chatgpt_account_id),
         account_scope_id = COALESCE(NULLIF(?, ''), account_scope_id),
         account_identity_key = COALESCE(NULLIF(?, ''), account_identity_key),
         plan_type = COALESCE(NULLIF(?, ''), plan_type),
         expires_at = COALESCE(NULLIF(?, ''), expires_at),
         has_refresh_token = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(email, accountId, accountScopeId, accountIdentityKey, planType, expiresAt, hasRefreshToken ? 1 : 0, now, existing.id, user.id).run();
  await env.DB.prepare(
    `INSERT INTO account_secrets (account_id, user_id, encrypted_auth_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       encrypted_auth_json = excluded.encrypted_auth_json,
       updated_at = excluded.updated_at`,
  ).bind(existing.id, user.id, encrypted, now, now).run();
  return { matched: true, synced: true, accountId: existing.id, reason: "已同步当前 auth" };
}

export async function findCurrentAccount(env, user, body) {
  const currentId = String(body.currentAccountId || body.accountId || body.chatgptAccountId || "").trim();
  const currentEmail = String(body.currentEmail || body.email || "").trim().toLowerCase();
  const currentScopeId = String(body.currentAccountScopeId || body.accountScopeId || body.account_scope_id || body.currentScopeId || "").trim();
  const rawCurrentIdentityKey = body.currentAccountIdentityKey || body.accountIdentityKey || body.account_identity_key || "";
  const currentIdentityKey = strongCurrentIdentityKey(rawCurrentIdentityKey || accountIdentityKeyFromParts({
    accountId: currentId,
    email: currentEmail,
    scopeId: currentScopeId,
  }), currentScopeId);
  if (!currentId && !currentEmail && !currentIdentityKey) return null;
  return env.DB.prepare(
    `SELECT * FROM accounts
     WHERE user_id = ? AND (
       (? != '' AND account_identity_key = ?)
       OR (? != '' AND ? = 1 AND account_identity_key = '' AND chatgpt_account_id = ?)
     )
     LIMIT 1`,
  ).bind(
    user.id,
    currentIdentityKey,
    currentIdentityKey,
    currentId,
    rawCurrentIdentityKey ? 0 : 1,
    currentId,
  ).first();
}

export async function listAccounts(env, user) {
  const rows = await env.DB.prepare(
    `SELECT a.*, us.usage_json, us.created_at AS usage_created_at, s.updated_at AS secret_updated_at
     FROM accounts a
     LEFT JOIN account_secrets s ON s.account_id = a.id AND s.user_id = a.user_id
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

export async function upsertAccount(env, user, item) {
  const session = normalizeSession(item.session || item.authJson || item);
  const tokens = session.tokens || {};
  const accountId = tokens.account_id || "";
  const accountScopeId = item.accountScopeId || item.account_scope_id || session.accountScopeId || "";
  const accountIdentityKey = item.accountIdentityKey || item.account_identity_key || session.accountIdentityKey || accountIdentityKeyFromParts({
    accountUserId: session.accountUserId || "",
    accountId,
    email: item.email || session.email || "",
    scopeId: accountScopeId,
  });
  const accessPayload = decodeJwtPayload(tokens.access_token || "");
  const planType = bestPlan(session.profile?.plan, item.usage?.plan_type, item.usage?.planType);
  const expiresAt = session.expires || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");
  const hasRefreshToken = Boolean(tokens.refresh_token && tokens.refresh_token !== tokens.access_token && tokens.refresh_token !== "rt_mock_token");
  const email = item.email || session.email || "";
  const now = nowIso();
  const existing = await env.DB.prepare(
    `SELECT id, plan_type FROM accounts
     WHERE user_id = ? AND (
       (? != '' AND account_identity_key = ?)
       OR (? != '' AND account_identity_key = '' AND chatgpt_account_id = ?)
       OR (? = '' AND ? = '' AND email != '' AND email = ?)
     )
     LIMIT 1`,
  ).bind(
    user.id,
    accountIdentityKey,
    accountIdentityKey,
    accountId,
    accountId,
    accountIdentityKey,
    accountId,
    email,
  ).first();
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
           chatgpt_account_id = ?, account_scope_id = ?, account_identity_key = ?,
           plan_type = ?, expires_at = ?, has_refresh_token = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      name,
      email,
      item.group || item.groupName || "默认",
      item.priority || "normal",
      item.usageNote || item.usage_note || "",
      item.expiryNote || item.expiry_note || expiresAt || "",
      accountId,
      accountScopeId,
      accountIdentityKey,
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
       (id, user_id, name, email, group_name, priority, usage_note, expiry_note, chatgpt_account_id, account_scope_id, account_identity_key, plan_type, expires_at, has_refresh_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      accountScopeId,
      accountIdentityKey,
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

export async function handleAccounts(request, env, user, path, options = {}) {
  const writeAudit = options.writeAudit || null;

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
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "import",
        result: `added:${added},updated:${updated},failed:${failed}`,
        metadata: { total: items.length },
      });
    }
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
    const source = String(body.source || body.refreshSource || usage.refresh_source || "helper").slice(0, 40);
    const kind = body.background ? "background" : body.batch ? "batch" : "manual";
    usage.refresh_source = source;
    usage.plan_type = bestPlan(account.plan_type, usage.plan_type);
    if (body.error) usage.error = body.error;
    if (body.ok === false) usage.status = "刷新失败";
    await env.DB.prepare(
      `INSERT INTO usage_snapshots
       (id, account_id, user_id, usage_json, ok, error, refresh_source, refresh_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), accountId, user.id, JSON.stringify(usage), body.ok === false ? 0 : 1, body.error || "", source, kind, nowIso()).run();
    await env.DB.prepare("UPDATE accounts SET plan_type = COALESCE(?, plan_type), updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(usage.plan_type || null, nowIso(), accountId, user.id).run();
    return json({ ok: true, usage });
  }

  if (request.method === "POST" && action === "switch-payload") {
    const body = await readJson(request);
    const settings = await readAutoSwitchSettings(env, user);
    const allowAtExperimental = Boolean(body.allowAtExperimental && settings.allowAt && settings.showExperimentalAt);
    const authJson = await switchPayloadForAccount(env, user, accountId, { allowAtExperimental });
    if (body.audit !== false && writeAudit) {
      await writeAudit(env, user, {
        accountId,
        action: "switch-payload",
        result: "payload-issued",
        deviceKey: body.deviceKey || "",
        metadata: { source: "cloud", allowAtExperimental },
      });
    }
    return json({ ok: true, authJson, allowAtExperimental });
  }

  return null;
}
