import {
  isoAfter,
  json,
  nowIso,
  randomToken,
  readJson,
  secondsUntilIso,
  sha256,
  withRequestContext,
} from "./worker-shared.js";
import {
  candidateDecision,
  candidateDiagnostic,
  candidateReasons,
  findCurrentAccount,
  isSwitchTriggerUsage,
  listAccounts,
  normalizeUsage,
  syncCurrentAuthSecret,
  summarizeCandidateBlocks,
  switchPayloadForAccount,
} from "./worker-accounts.js";
import {
  readAutoSwitchSettings,
} from "./worker-settings.js";

export const DEVICE_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
export const DEVICE_TOKEN_ROTATE_AFTER_SECONDS = 30 * 24 * 60 * 60;
export const DEVICE_TOKEN_ROTATION_GRACE_SECONDS = 7 * 24 * 60 * 60;
export const DEVICE_TOKEN_RENEW_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const HELPER_HEARTBEAT_SECONDS = 60;
export const HELPER_OFFLINE_AFTER_SECONDS = HELPER_HEARTBEAT_SECONDS * 3;

function boolish(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function helperDeviceHealth(row, baseMs = Date.now()) {
  const lastSeenAt = row?.lastSeenAt || row?.last_seen_at || "";
  const lastSeenMs = Date.parse(lastSeenAt);
  const hasLastSeen = Number.isFinite(lastSeenMs);
  const ageSeconds = hasLastSeen ? Math.max(0, Math.floor((baseMs - lastSeenMs) / 1000)) : null;
  const reportedOnline = boolish(row?.helperReportedOnline ?? row?.helper_reported_online ?? row?.helperOnline ?? row?.helper_online);
  const helperStale = reportedOnline && (!hasLastSeen || ageSeconds > HELPER_OFFLINE_AFTER_SECONDS);
  const helperOnline = reportedOnline && !helperStale;
  return {
    helperOnline,
    helperReportedOnline: reportedOnline,
    helperStale,
    helperReconnectRequired: reportedOnline && helperStale,
    helperLastSeenAgeSeconds: ageSeconds,
    helperHeartbeatSeconds: HELPER_HEARTBEAT_SECONDS,
    helperOfflineAfterSeconds: HELPER_OFFLINE_AFTER_SECONDS,
    helperStatus: helperOnline ? "online" : (helperStale ? "stale" : "offline"),
  };
}

export function publicDevice(row, baseMs = Date.now()) {
  const health = helperDeviceHealth(row, baseMs);
  return {
    ...row,
    id: row?.id || "",
    userId: row?.userId || row?.user_id || "",
    user_id: row?.user_id || row?.userId || "",
    userEmail: row?.userEmail || row?.user_email || "",
    user_email: row?.user_email || row?.userEmail || "",
    deviceKey: row?.deviceKey || row?.device_key || "",
    device_key: row?.device_key || row?.deviceKey || "",
    name: row?.name || "",
    helperOnline: health.helperOnline,
    helper_online: health.helperOnline ? 1 : 0,
    helperReportedOnline: health.helperReportedOnline,
    helper_reported_online: health.helperReportedOnline ? 1 : 0,
    helperStale: health.helperStale,
    helper_stale: health.helperStale ? 1 : 0,
    helperReconnectRequired: health.helperReconnectRequired,
    helper_reconnect_required: health.helperReconnectRequired ? 1 : 0,
    helperLastSeenAgeSeconds: health.helperLastSeenAgeSeconds,
    helper_last_seen_age_seconds: health.helperLastSeenAgeSeconds,
    helperHeartbeatSeconds: health.helperHeartbeatSeconds,
    helper_heartbeat_seconds: health.helperHeartbeatSeconds,
    helperOfflineAfterSeconds: health.helperOfflineAfterSeconds,
    helper_offline_after_seconds: health.helperOfflineAfterSeconds,
    helperStatus: health.helperStatus,
    helper_status: health.helperStatus,
    helperBase: row?.helperBase || row?.helper_base || "",
    helper_base: row?.helper_base || row?.helperBase || "",
    helperVersion: row?.helperVersion || row?.helper_version || "",
    helper_version: row?.helper_version || row?.helperVersion || "",
    helperBuildDate: row?.helperBuildDate || row?.helper_build_date || "",
    helper_build_date: row?.helper_build_date || row?.helperBuildDate || "",
    createdAt: row?.createdAt || row?.created_at || "",
    created_at: row?.created_at || row?.createdAt || "",
    lastSeenAt: row?.lastSeenAt || row?.last_seen_at || "",
    last_seen_at: row?.last_seen_at || row?.lastSeenAt || "",
  };
}

export function helperTokenStatus(row, baseMs = Date.now()) {
  const expiresAt = row?.tokenExpiresAt || row?.token_expires_at || row?.expiresAt || row?.expires_at || "";
  return {
    status: row?.tokenStatus || row?.token_status || row?.status || "active",
    createdAt: row?.tokenCreatedAt || row?.token_created_at || row?.createdAt || row?.created_at || "",
    lastSeenAt: row?.tokenLastSeenAt || row?.token_last_seen_at || row?.lastSeenAt || row?.last_seen_at || "",
    expiresAt,
    expiresInSeconds: Math.max(0, secondsUntilIso(expiresAt, baseMs)),
    rotateAfterSeconds: DEVICE_TOKEN_ROTATE_AFTER_SECONDS,
    heartbeatSeconds: HELPER_HEARTBEAT_SECONDS,
  };
}

export async function insertDeviceToken(env, userId, deviceKey, name, expiresAt, rotatedFrom = "") {
  const token = `cdh_${randomToken(36)}`;
  await env.DB.prepare(
    `INSERT INTO device_tokens
       (id, user_id, device_key, token_hash, name, status, created_at, last_seen_at, expires_at, rotated_from, revoked_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, '')`,
  ).bind(
    crypto.randomUUID(),
    userId,
    deviceKey,
    await sha256(token),
    String(name || "Dock Helper").slice(0, 120),
    nowIso(),
    nowIso(),
    expiresAt,
    rotatedFrom,
  ).run();
  return token;
}

export function helperTokenNeedsRotation(helper, baseMs = Date.now()) {
  if ((helper.tokenStatus || "active") !== "active") return true;
  const createdAt = new Date(helper.tokenCreatedAt || "").getTime();
  if (Number.isFinite(createdAt) && baseMs - createdAt >= DEVICE_TOKEN_ROTATE_AFTER_SECONDS * 1000) return true;
  return secondsUntilIso(helper.tokenExpiresAt, baseMs) <= DEVICE_TOKEN_RENEW_WINDOW_SECONDS;
}

export async function maybeRotateHelperToken(env, helper, writeAudit) {
  if (!helperTokenNeedsRotation(helper)) return null;
  const replacementExpiresAt = isoAfter(DEVICE_TOKEN_TTL_SECONDS);
  const token = await insertDeviceToken(env, helper.user.id, helper.deviceKey, helper.name, replacementExpiresAt, helper.tokenId);
  await env.DB.prepare(
    "UPDATE device_tokens SET status = 'retiring', expires_at = ? WHERE id = ? AND status = 'active'",
  ).bind(isoAfter(DEVICE_TOKEN_ROTATION_GRACE_SECONDS), helper.tokenId).run();
  if (writeAudit) {
    await writeAudit(env, helper.user, {
      action: "helper-token",
      result: "rotated",
      deviceKey: helper.deviceKey,
      metadata: { oldTokenId: helper.tokenId, replacementExpiresAt },
    });
  }
  return { token, expiresAt: replacementExpiresAt };
}

export async function handleDeviceRoutes(request, env, user, path, options = {}) {
  const writeAudit = options.writeAudit || null;

  if (request.method === "GET" && path === "/api/devices") {
    const rows = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC").bind(user.id).all();
    return json({ ok: true, devices: (rows.results || []).map((row) => publicDevice(row)) });
  }

  if (request.method === "POST" && path === "/api/devices/auto-switch-token") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    const expiresAt = isoAfter(DEVICE_TOKEN_TTL_SECONDS);
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_key, name, helper_online, helper_base, helper_version, helper_build_date, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_key) DO UPDATE SET
         name = excluded.name,
         helper_online = excluded.helper_online,
         helper_base = excluded.helper_base,
         helper_version = excluded.helper_version,
         helper_build_date = excluded.helper_build_date,
         last_seen_at = excluded.last_seen_at`,
    ).bind(
      crypto.randomUUID(),
      user.id,
      key,
      String(body.name || "Dock Helper").slice(0, 120),
      1,
      String(body.helperBase || "").slice(0, 200),
      String(body.helperVersion || "").slice(0, 32),
      String(body.helperBuildDate || "").slice(0, 32),
      now,
      now,
    ).run();
    await env.DB.prepare("UPDATE device_tokens SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND device_key = ? AND status IN ('active', 'retiring')")
      .bind(now, user.id, key).run();
    const token = await insertDeviceToken(env, user.id, key, String(body.name || "Dock Helper").slice(0, 120), expiresAt);
    const settings = await readAutoSwitchSettings(env, user);
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "helper-token",
        result: "issued",
        deviceKey: key,
        metadata: { helperBase: body.helperBase || "", expiresAt },
      });
    }
    return json({ ok: true, deviceToken: token, tokenExpiresAt: expiresAt, heartbeatSeconds: HELPER_HEARTBEAT_SECONDS, settings, cloudBase: new URL(request.url).origin });
  }

  if (request.method === "DELETE" && path === "/api/devices/auto-switch-token") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    await env.DB.prepare("UPDATE device_tokens SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND device_key = ? AND status IN ('active', 'retiring')")
      .bind(now, user.id, key).run();
    if (writeAudit) await writeAudit(env, user, { action: "helper-token", result: "revoked", deviceKey: key });
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "/api/devices/register") {
    const body = await readJson(request);
    const key = String(body.deviceKey || body.device_key || "").slice(0, 128);
    if (!key) return json({ ok: false, error: "缺少 deviceKey" }, 400);
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_key, name, helper_online, helper_base, helper_version, helper_build_date, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_key) DO UPDATE SET
         name = excluded.name,
         helper_online = excluded.helper_online,
         helper_base = excluded.helper_base,
         helper_version = excluded.helper_version,
         helper_build_date = excluded.helper_build_date,
         last_seen_at = excluded.last_seen_at`,
    ).bind(
      crypto.randomUUID(),
      user.id,
      key,
      String(body.name || "Browser").slice(0, 120),
      body.helperOnline ? 1 : 0,
      String(body.helperBase || "").slice(0, 200),
      String(body.helperVersion || "").slice(0, 32),
      String(body.helperBuildDate || "").slice(0, 32),
      now,
      now,
    ).run();
    return json({ ok: true });
  }

  return null;
}

export async function requireHelperDevice(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const tokenHash = await sha256(match[1].trim());
  const row = await env.DB.prepare(
    `SELECT device_tokens.id AS token_id, device_tokens.device_key, device_tokens.name AS device_name,
            device_tokens.status AS token_status, device_tokens.created_at AS token_created_at,
            device_tokens.last_seen_at AS token_last_seen_at, device_tokens.expires_at AS token_expires_at,
            users.id, users.email, users.role, users.status, users.created_at, users.updated_at, users.last_login_at
     FROM device_tokens
     JOIN users ON users.id = device_tokens.user_id
     WHERE device_tokens.token_hash = ?
       AND device_tokens.status IN ('active', 'retiring')
       AND device_tokens.revoked_at = ''
     LIMIT 1`,
  ).bind(tokenHash).first();
  if (!row || (row.status || "active") !== "active") return null;
  const now = nowIso();
  if (row.token_expires_at && secondsUntilIso(row.token_expires_at) <= 0) {
    await env.DB.prepare("UPDATE device_tokens SET status = 'expired', revoked_at = ? WHERE id = ?").bind(now, row.token_id).run();
    await env.DB.prepare("UPDATE devices SET helper_online = 0, last_seen_at = ? WHERE user_id = ? AND device_key = ?")
      .bind(now, row.id, row.device_key).run();
    return null;
  }
  const nextExpiresAt = (row.token_status || "active") === "active" ? isoAfter(DEVICE_TOKEN_TTL_SECONDS) : row.token_expires_at;
  await env.DB.prepare("UPDATE device_tokens SET last_seen_at = ?, expires_at = ? WHERE id = ?").bind(now, nextExpiresAt, row.token_id).run();
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
    tokenStatus: row.token_status || "active",
    tokenCreatedAt: row.token_created_at || "",
    tokenLastSeenAt: now,
    tokenExpiresAt: nextExpiresAt,
    name: row.device_name || "Dock Helper",
  };
}

export async function handleHelperAutoSwitch(request, env, path, requestContext, options = {}) {
  if (!path.startsWith("/api/helper/auto-switch")) return null;
  const writeAudit = options.writeAudit || null;
  const helper = await requireHelperDevice(request, env);
  if (!helper) return json({ ok: false, error: "Helper 授权已失效，请重新授权" }, 401);
  const user = withRequestContext(helper.user, requestContext);
  helper.user = user;
  const settings = await readAutoSwitchSettings(env, user);

  if (request.method === "GET" && path === "/api/helper/auto-switch/config") {
    const replacement = await maybeRotateHelperToken(env, helper, writeAudit);
    return json({
      ok: true,
      settings,
      deviceKey: helper.deviceKey,
      serverTime: nowIso(),
      heartbeatSeconds: HELPER_HEARTBEAT_SECONDS,
      token: helperTokenStatus(helper),
      replacementDeviceToken: replacement?.token || "",
      replacementExpiresAt: replacement?.expiresAt || "",
    });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/heartbeat") {
    const replacement = await maybeRotateHelperToken(env, helper, writeAudit);
    return json({
      ok: true,
      deviceKey: helper.deviceKey,
      serverTime: nowIso(),
      heartbeatSeconds: HELPER_HEARTBEAT_SECONDS,
      token: helperTokenStatus(helper),
      replacementDeviceToken: replacement?.token || "",
      replacementExpiresAt: replacement?.expiresAt || "",
    });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/current-usage") {
    const body = await readJson(request);
    const usage = normalizeUsage(body.usage || body.usage_snapshot, body.planType || "");
    if (body.error) usage.error = body.error;
    const current = await findCurrentAccount(env, user, body);
    if (current) {
      usage.refresh_source = "helper-auto";
      await env.DB.prepare(
        `INSERT INTO usage_snapshots
         (id, account_id, user_id, usage_json, ok, error, refresh_source, refresh_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        current.id,
        user.id,
        JSON.stringify(usage),
        body.ok === false || body.error ? 0 : 1,
        body.error || "",
        "helper-auto",
        "auto-switch",
        nowIso(),
      ).run();
      await env.DB.prepare("UPDATE accounts SET plan_type = COALESCE(?, plan_type), updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(usage.plan_type || null, nowIso(), current.id, user.id).run();
    }
    const trigger = isSwitchTriggerUsage(usage, body.error || "", settings);
    return json({ ok: true, matchedAccountId: current?.id || "", trigger });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/current-auth") {
    const body = await readJson(request);
    const result = await syncCurrentAuthSecret(env, user, body.authJson || body.auth || body, {
      source: "helper-current-auth",
      localUpdatedAt: body.localUpdatedAt || "",
    });
    if (writeAudit) {
      await writeAudit(env, user, {
        accountId: result.accountId || "",
        action: "helper-auth-sync",
        result: result.synced ? "synced" : (result.matched ? "skipped" : "unmatched"),
        deviceKey: helper.deviceKey,
        metadata: {
          localUpdatedAt: body.localUpdatedAt || "",
          fingerprint: body.fingerprint || "",
          syncReason: body.syncReason || "",
          reason: result.reason,
        },
      });
    }
    return json({
      ok: true,
      status: result.synced ? "synced" : (result.matched ? "skipped" : "unmatched"),
      matched: result.matched,
      synced: Boolean(result.synced),
      matchedAccountId: result.accountId || "",
      reason: result.reason,
    });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/next") {
    const body = await readJson(request);
    if (!settings.enabled) return json({ ok: true, shouldSwitch: false, reason: "自动切换未开启" });
    const usage = normalizeUsage(body.usage || body.usage_snapshot, body.planType || "");
    if (body.error) usage.error = body.error;
    const trigger = isSwitchTriggerUsage(usage, body.error || "", settings);
    const helperTriggerReason = String(body.triggerReason || body.trigger || "").trim();
    const helperTriggerType = String(body.triggerType || "").trim();
    const helperTriggerKind = helperTriggerType.toLowerCase();
    const helperForceAllowed = ["auth", "quota", "account_disabled"].includes(helperTriggerKind);
    const forcedByHelper = Boolean(body.force) && helperTriggerReason && helperForceAllowed;
    const effectiveTriggerReason = trigger.yes ? trigger.reason : (forcedByHelper ? helperTriggerReason : "");
    const effectiveTriggerType = trigger.yes ? "usage" : helperTriggerType;
    if (!effectiveTriggerReason) return json({ ok: true, shouldSwitch: false, reason: "未命中切换条件" });
    if (body.boundaryConfirmed !== true) {
      return json({ ok: true, shouldSwitch: false, reason: "等待 Helper 确认安全轮次边界" });
    }

    const accounts = await listAccounts(env, user);
    const decisions = accounts.map((account) => candidateDecision(account, settings, body));
    const scored = decisions
      .filter((item) => item.eligible)
      .sort((a, b) => b.score - a.score);
    const candidateCount = decisions.length;
    const eligibleCount = scored.length;
    const blockedSummary = summarizeCandidateBlocks(decisions);
    const selected = scored[0]?.account || null;
    if (!selected) {
      const diagnostics = decisions
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map(candidateDiagnostic);
      const summary = blockedSummary;
      if (writeAudit) {
        await writeAudit(env, user, {
          action: "auto-switch",
          result: "no-candidate",
          deviceKey: helper.deviceKey,
          metadata: {
            trigger: effectiveTriggerReason,
            triggerType: effectiveTriggerType,
            triggerSource: body.triggerSource || "",
            boundaryConfirmed: true,
            runtimeState: body.runtimeState || "",
            boundaryEvidence: body.boundaryEvidence || "",
            currentUsageSummary: body.currentUsageSummary || "",
            candidateCount,
            eligibleCount,
            summary,
            candidates: diagnostics,
          },
        });
      }
      const reasonPrefix = summary.includes("AT 账号当前不支持 Codex 使用")
        ? "没有可用 RT 账号"
        : "没有可用候选账号";
      return json({
        ok: true,
        shouldSwitch: false,
        reason: summary ? `${reasonPrefix}：${summary}` : reasonPrefix,
        candidateCount,
        eligibleCount,
        blockedSummary: summary,
        diagnostics,
      });
    }
    const allowAtExperimental = Boolean(settings.allowAt && settings.showExperimentalAt && !selected.hasRefreshToken);
    const authJson = await switchPayloadForAccount(env, user, selected.id, { allowAtExperimental });
    if (writeAudit) {
      await writeAudit(env, user, {
        accountId: selected.id,
        action: "auto-switch",
        result: "payload-issued",
        deviceKey: helper.deviceKey,
        metadata: {
          trigger: effectiveTriggerReason,
          triggerType: effectiveTriggerType,
          triggerSource: body.triggerSource || "",
          boundaryConfirmed: true,
          runtimeState: body.runtimeState || "",
          boundaryEvidence: body.boundaryEvidence || "",
          currentUsageSummary: body.currentUsageSummary || "",
          score: scored[0].score,
          reason: candidateReasons(selected, settings),
          candidateCount,
          eligibleCount,
        },
      });
    }
    return json({
      ok: true,
      shouldSwitch: true,
      reason: effectiveTriggerReason,
      candidateCount,
      eligibleCount,
      blockedSummary,
      account: {
        id: selected.id,
        name: selected.name,
        email: selected.email,
        accountId: selected.accountId,
        planType: selected.planType,
        reason: candidateReasons(selected, settings),
      },
      authJson,
      allowAtExperimental,
    });
  }

  if (request.method === "POST" && path === "/api/helper/auto-switch/audit") {
    const body = await readJson(request);
    const accountId = body.accountId || body.account_id || "";
    if (writeAudit) {
      await writeAudit(env, user, {
        accountId,
        action: "auto-switch-helper",
        result: body.result || "",
        deviceKey: helper.deviceKey,
        metadata: body.metadata || {},
      });
    }
    if (accountId && body.result === "switched") {
      const now = nowIso();
      await env.DB.prepare("UPDATE accounts SET last_switch_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(now, now, accountId, user.id).run();
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "Not found" }, 404);
}
