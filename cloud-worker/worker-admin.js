import {
  accountSummary,
} from "./worker-accounts.js";
import {
  publicUser,
} from "./worker-auth.js";
import {
  json,
  nowIso,
  parseJsonObject,
  passwordHash,
  randomToken,
  readJson,
  temporaryPassword,
} from "./worker-shared.js";

export function assertAdmin(user) {
  return (user?.role || "user") === "admin";
}

const MIN_SUPPORTED_HELPER_VERSION = "0.4.2";

function number(value) {
  return Number(value || 0);
}

function compareVersion(left, right) {
  const a = String(left || "").split(".").map((part) => Number(part) || 0);
  const b = String(right || "").split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

export async function adminSummary(env) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [users, accountHealth, sessions, imports, switches, usageFailures, auditTrend, helperVersions] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM users").first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN accounts.has_refresh_token = 1 THEN 1 ELSE 0 END) AS rt_ready,
              SUM(CASE WHEN accounts.has_refresh_token = 0 THEN 1 ELSE 0 END) AS at_only,
              SUM(CASE WHEN accounts.expires_at != '' AND accounts.expires_at <= ? THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN us.id IS NULL THEN 1 ELSE 0 END) AS unrefreshed,
              SUM(CASE WHEN us.ok = 1 THEN 1 ELSE 0 END) AS usage_ok,
              SUM(CASE WHEN us.ok = 0 THEN 1 ELSE 0 END) AS usage_failed
       FROM accounts
       LEFT JOIN usage_snapshots us ON us.id = (
         SELECT id FROM usage_snapshots
         WHERE account_id = accounts.id
         ORDER BY created_at DESC
         LIMIT 1
       )`,
    ).bind(nowIso()).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM sessions WHERE expires_at > ?").bind(nowIso()).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'import' AND created_at > ?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action IN ('switch', 'switch-payload', 'auto-switch', 'auto-switch-helper') AND created_at > ?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM usage_snapshots WHERE ok = 0 AND created_at > ?").bind(since).first(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 13) AS bucket,
              COUNT(*) AS total,
              SUM(CASE
                WHEN LOWER(result) LIKE '%error%'
                  OR LOWER(result) LIKE '%fail%'
                  OR LOWER(result) LIKE '%no-candidate%'
                  OR LOWER(result) LIKE '%unmatched%'
                  OR LOWER(result) LIKE '%denied%'
                  OR result LIKE '%失败%'
                THEN 1 ELSE 0 END) AS failures
       FROM audit_logs
       WHERE created_at > ?
       GROUP BY bucket
       ORDER BY bucket ASC
       LIMIT 48`,
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT CASE WHEN helper_version = '' THEN '未上报' ELSE helper_version END AS helper_version,
              COUNT(*) AS total,
              SUM(CASE WHEN helper_online = 1 THEN 1 ELSE 0 END) AS online,
              MAX(last_seen_at) AS last_seen_at
       FROM devices
       GROUP BY helper_version
       ORDER BY total DESC, helper_version ASC
       LIMIT 12`,
    ).all(),
  ]);
  const helperVersionRows = (helperVersions.results || []).map((row) => ({
    version: row.helper_version || "未上报",
    total: number(row.total),
    online: number(row.online),
    lastSeenAt: row.last_seen_at || "",
  }));
  const deviceTotal = helperVersionRows.reduce((total, row) => total + row.total, 0);
  const deviceOnline = helperVersionRows.reduce((total, row) => total + row.online, 0);
  const helperOutdated = helperVersionRows.reduce((total, row) => (
    total + (row.version === "未上报" || compareVersion(row.version, MIN_SUPPORTED_HELPER_VERSION) < 0 ? row.total : 0)
  ), 0);
  const failureTrend = (auditTrend.results || []).map((row) => ({
    bucket: row.bucket || "",
    total: number(row.total),
    failures: number(row.failures),
  }));
  const auditTotal24h = failureTrend.reduce((total, row) => total + row.total, 0);
  const auditFailures24h = failureTrend.reduce((total, row) => total + row.failures, 0);
  return {
    users: number(users?.total),
    activeUsers: number(users?.active),
    accounts: number(accountHealth?.total),
    onlineSessions: number(sessions?.total),
    imports24h: number(imports?.total),
    switches24h: number(switches?.total),
    minSupportedHelperVersion: MIN_SUPPORTED_HELPER_VERSION,
    accountHealth: {
      total: number(accountHealth?.total),
      rtReady: number(accountHealth?.rt_ready),
      atOnly: number(accountHealth?.at_only),
      expired: number(accountHealth?.expired),
      unrefreshed: number(accountHealth?.unrefreshed),
      usageOk: number(accountHealth?.usage_ok),
      usageFailed: number(accountHealth?.usage_failed),
    },
    deviceHealth: {
      total: deviceTotal,
      online: deviceOnline,
      offline: Math.max(0, deviceTotal - deviceOnline),
      outdated: helperOutdated,
    },
    helperVersions: helperVersionRows,
    failureTotals: {
      audit24h: auditTotal24h,
      auditFailures24h,
      usageRefreshFailures24h: number(usageFailures?.total),
    },
    failureTrend,
  };
}

export async function adminUsers(env) {
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

export function likeTerm(value) {
  return `%${String(value || "").trim().toLowerCase().replace(/[%_]/g, "")}%`;
}

export async function adminFilteredUsers(env, url) {
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

export async function adminUserSummary(env, targetUserId) {
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

export async function adminUserAccounts(env, targetUserId) {
  const rows = await env.DB.prepare(
    `SELECT a.*, us.usage_json, us.created_at AS usage_created_at
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

export async function adminDevices(env) {
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
    helperVersion: row.helper_version || "",
    helperBuildDate: row.helper_build_date || "",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function ensureAnotherAdmin(env, targetUserId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
    .bind(targetUserId).first();
  return Number(row?.total || 0) > 0;
}

export async function handleAdmin(request, env, user, path, options = {}) {
  if (!path.startsWith("/api/admin")) return null;
  if (!assertAdmin(user)) return json({ ok: false, error: "没有管理员权限" }, 403);
  const writeAudit = options.writeAudit || null;
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
      audit: (rows.results || []).map((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        return {
          id: row.id,
          userId: row.user_id,
          userEmail: row.user_email || "",
          accountId: row.account_id || "",
          accountName: row.account_name || "",
          action: row.action,
          result: row.result || "",
          deviceKey: row.device_key || "",
          requestId: metadata.requestId || "",
          metadata,
          createdAt: row.created_at,
        };
      }),
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
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "admin-update-user",
        result: "ok",
        metadata: { targetUserId, role: nextRole, status: nextStatus },
      });
    }
    return json({ ok: true });
  }

  if (request.method === "POST" && action === "reset-password") {
    const tempPassword = temporaryPassword();
    const salt = randomToken(18);
    const hash = await passwordHash(tempPassword, salt);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, nowIso(), targetUserId).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "admin-reset-password",
        result: "ok",
        metadata: { targetUserId },
      });
    }
    return json({ ok: true, temporaryPassword: tempPassword });
  }

  if (request.method === "DELETE" && action === "sessions") {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "admin-delete-sessions",
        result: "ok",
        metadata: { targetUserId },
      });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

