(function () {
  const decoder = new TextDecoder();

  function base64ToBytes(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  function decodeJwtPayload(token) {
    if (!token || !token.includes(".")) return null;
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return JSON.parse(decoder.decode(base64ToBytes(padded)));
    } catch {
      return null;
    }
  }

  function numeric(value) {
    if (value === null || value === undefined || value === "") return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value))));
  }

  function unixToIso(value) {
    const number = numeric(value);
    if (!Number.isFinite(number)) return "";
    return new Date(number * 1000).toISOString();
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

  function explainError(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    if (
      text.includes("封") ||
      text.includes("停用") ||
      text.includes("账号已被禁用") ||
      lower.includes("account_deactivated") ||
      lower.includes("user_deactivated") ||
      lower.includes("organization_deactivated") ||
      lower.includes("account_disabled") ||
      lower.includes("disabled account") ||
      lower.includes("suspended") ||
      lower.includes("banned")
    ) {
      return "账号不可用，请检查是否被停用";
    }
    if (
      lower.includes("invalid_grant") ||
      lower.includes("refresh token was already used") ||
      lower.includes("access token could not be refreshed") ||
      lower.includes("could not be refreshed")
    ) {
      return "RT 已失效，请重新登录";
    }
    if (/\b401\b/.test(text) || lower.includes("authentication token has been invalidated") || lower.includes("unauthorized")) {
      return "Token 已失效，请重新登录";
    }
    if (/\b403\b/.test(text) || lower.includes("forbidden")) {
      return "无权限访问，请检查账号状态";
    }
    if (/\b429\b/.test(text) || lower.includes("rate limit") || lower.includes("too many requests")) {
      return "请求过于频繁，稍后再试";
    }
    if (/\b5\d\d\b/.test(text)) {
      return "服务暂时不可用，稍后重试";
    }
    if (lower.includes("abort") || text.includes("请求被中止") || text.includes("连接被意外关闭")) {
      return "请求中断，请重试";
    }
    if (lower.includes("network") || lower.includes("fetch failed") || text.includes("网络")) {
      return "网络连接失败";
    }
    return text.length > 42 ? `${text.slice(0, 42)}...` : text;
  }

  function normalizeUsageWindow(raw) {
    if (!raw || typeof raw !== "object") return null;
    const usedPercent = numeric(raw.used_percent ?? raw.usedPercent ?? raw.used);
    const remainingPercent = numeric(raw.remaining_percent ?? raw.remainingPercent);
    const resolvedUsed = Number.isFinite(usedPercent)
      ? usedPercent
      : Number.isFinite(remainingPercent) ? 100 - remainingPercent : NaN;
    const resolvedRemaining = Number.isFinite(remainingPercent)
      ? remainingPercent
      : Number.isFinite(resolvedUsed) ? 100 - resolvedUsed : NaN;
    return {
      used_percent: Number.isFinite(resolvedUsed) ? clampPercent(resolvedUsed) : null,
      remaining_percent: Number.isFinite(resolvedRemaining) ? clampPercent(resolvedRemaining) : null,
      window_seconds: numeric(raw.window_seconds ?? raw.windowSeconds ?? raw.limit_window_seconds ?? raw.limitWindowSeconds),
      reset_at: raw.reset_at ?? raw.resetAt ?? raw.resets_at ?? raw.resetsAt ?? null,
    };
  }

  function emptyUsage(planType = "") {
    return {
      fetched_at: null,
      refreshed_at: "",
      plan_type: planType || "",
      five_hour: null,
      one_week: null,
      credits: null,
      refresh_source: "",
      status: "未刷新",
      error: "",
    };
  }

  function normalizeUsage(raw, fallbackPlan = "") {
    if (!raw || typeof raw !== "object") return emptyUsage(fallbackPlan);
    const planType = bestPlan(raw.plan_type, raw.planType, fallbackPlan);
    const fetchedAt = raw.fetched_at ?? raw.fetchedAt ?? null;
    const refreshedAt = raw.refreshed_at || raw.refreshedAt || unixToIso(fetchedAt) || "";
    const error = explainError(raw.error || raw.message || "");
    return {
      fetched_at: fetchedAt,
      refreshed_at: refreshedAt,
      plan_type: planType,
      five_hour: normalizeUsageWindow(raw.five_hour || raw.fiveHour || raw.short_window || raw.shortWindow),
      one_week: normalizeUsageWindow(raw.one_week || raw.oneWeek || raw.long_window || raw.longWindow),
      credits: raw.credits || null,
      refresh_source: raw.refresh_source || raw.refreshSource || "",
      status: error ? "刷新失败" : (raw.status || (refreshedAt ? "已刷新" : "未刷新")),
      error,
    };
  }

  function newestUsage(a, b, fallbackPlan = "") {
    const aa = normalizeUsage(a, fallbackPlan);
    const bb = normalizeUsage(b, fallbackPlan);
    const at = new Date(aa.refreshed_at || aa.fetched_at || 0).getTime() || 0;
    const bt = new Date(bb.refreshed_at || bb.fetched_at || 0).getTime() || 0;
    const chosen = bt > at ? bb : aa;
    chosen.plan_type = bestPlan(aa.plan_type, bb.plan_type, fallbackPlan);
    return chosen;
  }

  function objectAt(source, key) {
    return source && typeof source[key] === "object" && source[key] !== null ? source[key] : null;
  }

  function pick(source, keys) {
    for (const key of keys) {
      if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
        if (typeof source[key] === "object") continue;
        return source[key];
      }
    }
    return "";
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

  function accountIdentityKeyFromParts(parts = {}) {
    const accountId = String(parts.accountId || parts.account_id || "").trim().toLowerCase();
    const email = String(parts.email || "").trim().toLowerCase();
    const scope = String(parts.scopeId || parts.scope_id || parts.teamId || parts.team_id || parts.organizationId || parts.organization_id || parts.workspaceId || parts.workspace_id || "").trim().toLowerCase();
    if (accountId && scope && scope !== accountId) return `account:${accountId}|scope:${scope}`;
    if (accountId) return `account:${accountId}`;
    if (email && scope) return `email:${email}|scope:${scope}`;
    if (email) return `email:${email}`;
    return "";
  }

  function hasTokenishFields(source) {
    if (!source || typeof source !== "object") return false;
    const direct = ["access_token", "accessToken", "refresh_token", "refreshToken", "id_token", "idToken", "session_token", "sessionToken"];
    if (direct.some((key) => source[key])) return true;
    return ["tokens", "token", "auth", "authorization", "session", "chatgpt_session", "authJson"].some((key) => {
      const value = source[key];
      return value && typeof value === "object" && direct.some((field) => value[field]);
    });
  }

  function normalizeImportSources(parsed) {
    if (Array.isArray(parsed)) return parsed;
    for (const key of ["accounts", "sessions", "items", "data", "results", "list"]) {
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }
    if (parsed?.authJson && typeof parsed.authJson === "object") return [parsed.authJson];
    if (parsed && typeof parsed === "object" && !hasTokenishFields(parsed)) {
      const objectValues = Object.values(parsed).filter((value) => value && typeof value === "object" && hasTokenishFields(value));
      if (objectValues.length > 1) return objectValues;
    }
    return [parsed];
  }

  function extractAuthSource(source) {
    const tokens = objectAt(source, "tokens") || objectAt(source, "token") || {};
    const auth = objectAt(source, "auth") || objectAt(source, "authorization") || {};
    const session = objectAt(source, "session") || objectAt(source, "chatgpt_session") || {};
    const sessionTokens = objectAt(session, "tokens") || objectAt(session, "token") || {};
    const sessionProfile = objectAt(session, "profile") || {};
    const user = objectAt(source, "user") || objectAt(source, "account") || objectAt(source, "profile") || {};
    const subscription = objectAt(source, "subscription") || objectAt(source, "plan") || {};
    const sourceType = pick(source, ["type", "source", "provider", "format"]) || "";
    const kind = source.auth_mode === "chatgpt" && source.tokens
      ? "auth.json"
      : (/sub/i.test(sourceType) || source.sub2 || source.subscription_url ? "sub" : "cpa");

    return {
      kind,
      id_token: pickAny([source, tokens, auth, sessionTokens, session], ["id_token", "idToken"]),
      access_token: pickAny([source, tokens, auth, sessionTokens, session], ["access_token", "accessToken"]),
      refresh_token: pickAny([source, tokens, auth, sessionTokens, session], ["refresh_token", "refreshToken"]),
      session_token: pickAny([source, tokens, auth, sessionTokens, session], ["session_token", "sessionToken", "__Secure-next-auth.session-token", "token"]),
      account_id: pickAny([source, tokens, auth, sessionTokens, user], ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId", "id"]),
      email: pickAny([source, session, user], ["email", "mail"]),
      name: pickAny([source, user], ["name", "display_name", "displayName", "label"]),
      plan_type: pickAny([source, sessionProfile, subscription], ["plan_type", "planType", "plan"]) || pick(subscription, ["type"]),
      chatgpt_plan_type: pickAny([source, sessionProfile, subscription], ["chatgpt_plan_type", "chatgptPlanType", "name"]),
      expires: pickAny([source, session], ["expires", "expires_at", "expiresAt", "expired_at", "expiredAt"]),
      usage: source.usage_snapshot || source.usage || null,
    };
  }

  function parseSessionSource(source) {
    const extracted = extractAuthSource(source || {});
    const accessToken = extracted.access_token || "";
    const refreshToken = extracted.refresh_token || "";
    const idToken = extracted.id_token || "";
    const accessPayload = decodeJwtPayload(accessToken) || {};
    const idPayload = decodeJwtPayload(idToken) || {};
    const authPayload = accessPayload["https://api.openai.com/auth"] || idPayload["https://api.openai.com/auth"] || {};
    const profilePayload = accessPayload["https://api.openai.com/profile"] || idPayload["https://api.openai.com/profile"] || {};
    const accountScopeId = identityScopeFromSources([source, tokens, auth, sessionTokens, user, subscription, authPayload, profilePayload]);
    const accountId = extracted.account_id
      || authPayload.chatgpt_account_id
      || authPayload.chatgpt_account_user_id
      || "";
    const email = extracted.email || profilePayload.email || "";
    const expires = extracted.expires || jwtExpiryText(accessToken) || "";
    const plan = extracted.plan_type || extracted.chatgpt_plan_type || authPayload.chatgpt_plan_type || "";
    const usage = normalizeUsage(extracted.usage, plan);

    if (!accessToken) {
      throw new Error("没有识别到 access_token。请粘贴完整 session JSON 或 Codex auth.json。");
    }

    return {
      accountName: extracted.name || email || accountId || "",
      session: {
        sourceType: extracted.kind,
        email,
        expires,
        profile: { plan },
        accountScopeId,
        accountIdentityKey: accountIdentityKeyFromParts({ accountId, email, scopeId: accountScopeId }),
        usage,
        tokens: {
          id_token: idToken || accessToken,
          access_token: accessToken,
          refresh_token: refreshToken,
          account_id: accountId,
          session_token: extracted.session_token || "",
        },
      },
    };
  }

  function parseImportEntries(input) {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    const sources = normalizeImportSources(parsed);
    return sources.map((source, index) => {
      try {
        return {
          ok: true,
          sourceIndex: index,
          sourceName: source?.email || source?.name || `#${index + 1}`,
          ...parseSessionSource(source),
        };
      } catch (error) {
        return {
          ok: false,
          sourceIndex: index,
          sourceName: source?.email || source?.name || `#${index + 1}`,
          error: error.message || "解析失败",
        };
      }
    });
  }

  function parseSession(input) {
    const entries = parseImportEntries(input);
    const first = entries.find((entry) => entry.ok);
    if (!first) throw new Error(entries[0]?.error || "没有识别到可导入账号。");
    return first.session;
  }

  function jwtExpiryText(token) {
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return "";
    return new Date(payload.exp * 1000).toISOString();
  }

  function authFingerprint(session) {
    const tokens = session?.tokens || {};
    const access = tokens.access_token || "";
    const refresh = tokens.refresh_token || "";
    return [
      tokens.account_id || "",
      access.slice(0, 18),
      access.slice(-18),
      refresh.slice(0, 12),
      refresh.slice(-12),
    ].join("|");
  }

  function accountDedupeKey(account) {
    const accountId = account.accountId || account.account_id || account.session?.tokens?.account_id || "";
    const scopeId = account.accountScopeId || account.account_scope_id || account.session?.accountScopeId || "";
    const identityKey = account.accountIdentityKey || account.account_identity_key || account.session?.accountIdentityKey || accountIdentityKeyFromParts({
      accountId,
      email: account.email || account.session?.email || "",
      scopeId,
    });
    if (identityKey) return identityKey;
    if (accountId) return `account:${String(accountId).toLowerCase()}`;
    const email = account.email || account.session?.email || "";
    if (email) return `email:${String(email).toLowerCase()}`;
    const fingerprint = authFingerprint(account.session);
    if (fingerprint.replace(/\|/g, "")) return `token:${fingerprint}`;
    return `id:${account.id || crypto.randomUUID()}`;
  }

  function hasUsableRefreshToken(account) {
    if (account?.hasRefreshToken !== undefined) return Boolean(account.hasRefreshToken);
    const tokens = account?.session?.tokens || {};
    return Boolean(tokens.refresh_token && tokens.refresh_token !== tokens.access_token && tokens.refresh_token !== "rt_mock_token");
  }

  function accessTokenExpiry(account) {
    if (account?.expiresAt) {
      const date = new Date(account.expiresAt);
      if (!Number.isNaN(date.getTime())) return date;
    }
    const payload = decodeJwtPayload(account?.session?.tokens?.access_token);
    return payload?.exp ? new Date(payload.exp * 1000) : null;
  }

  function accountPlan(account) {
    return bestPlan(account?.planType, account?.usage?.plan_type, account?.session?.profile?.plan) || "未知";
  }

  function normalizeLocalAccount(account) {
    const session = account.session || null;
    const tokens = session?.tokens || {};
    const accessPayload = decodeJwtPayload(tokens.access_token || "") || {};
    const idPayload = decodeJwtPayload(tokens.id_token || "") || {};
    const authPayload = accessPayload["https://api.openai.com/auth"] || idPayload["https://api.openai.com/auth"] || {};
    const profilePayload = accessPayload["https://api.openai.com/profile"] || idPayload["https://api.openai.com/profile"] || {};
    const accountScopeId = account.accountScopeId || account.account_scope_id || session?.accountScopeId || identityScopeFromSources([account, session, tokens, authPayload, profilePayload]);
    const accountId = account.accountId || account.account_id || tokens.account_id || authPayload.chatgpt_account_id || "";
    const email = account.email || session?.email || profilePayload.email || "";
    const plan = bestPlan(account.planType, account.plan_type, account.usage?.plan_type, session?.profile?.plan, authPayload.chatgpt_plan_type);
    const expiresAt = account.expiresAt || account.expires_at || session?.expires || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");
    return {
      id: account.id || crypto.randomUUID(),
      localId: account.localId || account.local_id || account.id || "",
      cloudId: account.cloudId || account.cloud_id || "",
      name: account.name || email || accountId || "Unnamed Account",
      email,
      group: account.group || account.groupName || account.group_name || "默认",
      priority: account.priority || "normal",
      usageNote: account.usageNote || account.usage_note || "",
      expiryNote: account.expiryNote || account.expiry_note || "",
      accountId,
      accountScopeId,
      accountIdentityKey: account.accountIdentityKey || account.account_identity_key || session?.accountIdentityKey || accountIdentityKeyFromParts({ accountId, email, scopeId: accountScopeId }),
      expiresAt,
      hasRefreshToken: account.hasRefreshToken ?? account.has_refresh_token ?? hasUsableRefreshToken({ session }),
      planType: plan,
      usage: normalizeUsage(account.usage || session?.usage, plan),
      session,
      cloudOnly: Boolean(account.cloudOnly || account.cloud_only) && !session,
      createdAt: account.createdAt || account.created_at || new Date().toISOString(),
      updatedAt: account.updatedAt || account.updated_at || new Date().toISOString(),
      lastSwitchAt: account.lastSwitchAt || account.last_switch_at || "",
      secretUpdatedAt: account.secretUpdatedAt || account.secret_updated_at || "",
      credentialKind: account.credentialKind || account.credential_kind || (hasUsableRefreshToken({ session }) ? "rt" : "at"),
      codexUsable: account.codexUsable ?? account.codex_usable ?? null,
      codexBlockReason: account.codexBlockReason || account.codex_block_reason || "",
    };
  }

  function normalizeCloudAccount(account) {
    const plan = bestPlan(account.planType, account.plan_type, account.usage?.plan_type);
    return {
      id: `cloud:${account.id}`,
      localId: "",
      cloudId: account.id,
      name: account.name || account.email || "Unnamed Account",
      email: account.email || "",
      group: account.group || account.groupName || account.group_name || "默认",
      priority: account.priority || "normal",
      usageNote: account.usageNote || account.usage_note || "",
      expiryNote: account.expiryNote || account.expiry_note || "",
      accountId: account.accountId || account.account_id || "",
      accountScopeId: account.accountScopeId || account.account_scope_id || "",
      accountIdentityKey: account.accountIdentityKey || account.account_identity_key || accountIdentityKeyFromParts({
        accountId: account.accountId || account.account_id || "",
        email: account.email || "",
        scopeId: account.accountScopeId || account.account_scope_id || "",
      }),
      expiresAt: account.expiresAt || account.expires_at || "",
      hasRefreshToken: Boolean(account.hasRefreshToken ?? account.has_refresh_token),
      planType: plan,
      usage: normalizeUsage(account.usage || account.usage_snapshot, plan),
      session: null,
      cloudOnly: true,
      createdAt: account.createdAt || account.created_at || "",
      updatedAt: account.updatedAt || account.updated_at || "",
      lastSwitchAt: account.lastSwitchAt || account.last_switch_at || "",
      secretUpdatedAt: account.secretUpdatedAt || account.secret_updated_at || "",
      credentialKind: account.credentialKind || account.credential_kind || (account.hasRefreshToken || account.has_refresh_token ? "rt" : "at"),
      codexUsable: account.codexUsable ?? account.codex_usable ?? null,
      codexBlockReason: account.codexBlockReason || account.codex_block_reason || "",
    };
  }

  window.CodexAccountCore = Object.freeze({
    decodeJwtPayload,
    numeric,
    clampPercent,
    unixToIso,
    canonicalPlan,
    planRank,
    bestPlan,
    explainError,
    normalizeUsageWindow,
    emptyUsage,
    normalizeUsage,
    newestUsage,
    objectAt,
    pick,
    pickAny,
    hasTokenishFields,
    normalizeImportSources,
    extractAuthSource,
    parseSessionSource,
    parseImportEntries,
    parseSession,
    jwtExpiryText,
    authFingerprint,
    accountDedupeKey,
    identityScopeFromSources,
    accountIdentityKeyFromParts,
    hasUsableRefreshToken,
    accessTokenExpiry,
    accountPlan,
    normalizeLocalAccount,
    normalizeCloudAccount,
  });
})();
