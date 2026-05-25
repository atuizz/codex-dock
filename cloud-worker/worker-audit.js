import {
  json,
  nowIso,
  parseJsonObject,
  readJson,
  scheduleLog,
} from "./worker-shared.js";

export async function writeAudit(env, user, body) {
  const requestContext = body.requestContext || user?.requestContext || null;
  const requestId = body.requestId || requestContext?.requestId || "";
  const accountId = body.accountId || body.account_id || "";
  const action = body.action || "event";
  const result = body.result || "";
  const deviceKey = body.deviceKey || body.device_key || "";
  const metadata = { ...(body.metadata || {}) };
  if (requestId && !metadata.requestId) metadata.requestId = requestId;
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, user_id, account_id, action, result, device_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    user.id,
    accountId,
    action,
    result,
    deviceKey,
    JSON.stringify(metadata),
    nowIso(),
  ).run();
  scheduleLog(requestContext?.ctx, "info", "worker.audit", {
    requestId,
    userId: user.id,
    action,
    result,
    accountId,
    deviceKey,
    method: requestContext?.method || "",
    path: requestContext?.path || "",
    cfRay: requestContext?.cfRay || "",
    colo: requestContext?.colo || "",
  });
}

export async function handleAudit(request, env, user, path) {
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
      audit: (rows.results || []).map((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        return {
          id: row.id,
          accountId: row.account_id,
          accountName: row.account_name || "",
          action: row.action,
          result: row.result,
          deviceKey: row.device_key || "",
          requestId: metadata.requestId || "",
          metadata,
          createdAt: row.created_at,
        };
      }),
    });
  }

  if (request.method === "POST" && path === "/api/audit") {
    const body = await readJson(request);
    await writeAudit(env, user, body);
    const accountId = body.accountId || body.account_id || "";
    if (accountId && body.action === "switch" && !/fail|失败|error/i.test(String(body.result || ""))) {
      const now = nowIso();
      await env.DB.prepare("UPDATE accounts SET last_switch_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(now, now, accountId, user.id).run();
    }
    return json({ ok: true });
  }

  return null;
}
