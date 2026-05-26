import {
  clearSessionCookie,
  json,
  nowIso,
  passwordHash,
  randomToken,
  readJson,
  timingSafeEqual,
} from "./worker-shared.js";
import {
  readAutoSwitchSettings,
  saveAutoSwitchSettings,
} from "./worker-settings.js";

export async function handleUserRoutes(request, env, user, path, options = {}) {
  const writeAudit = options.writeAudit || null;

  if (request.method === "GET" && path === "/api/settings/auto-switch") {
    return json({ ok: true, settings: await readAutoSwitchSettings(env, user) });
  }

  if (request.method === "PATCH" && path === "/api/settings/auto-switch") {
    const body = await readJson(request);
    const settings = await saveAutoSwitchSettings(env, user, body.settings || body);
    if (writeAudit) await writeAudit(env, user, { action: "auto-switch-settings", result: settings.enabled ? "enabled" : "updated" });
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
    if (writeAudit) await writeAudit(env, user, { action: "change-password", result: "ok" });
    return json({ ok: true });
  }

  if (request.method === "DELETE" && path === "/api/me") {
    const body = await readJson(request);
    const confirmEmail = String(body.confirmEmail || "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword || "");
    if (confirmEmail !== String(user.email || "").trim().toLowerCase()) {
      return json({ ok: false, error: "请输入当前登录邮箱以确认删除" }, 400);
    }
    const row = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(user.id).first();
    if (!row) return json({ ok: false, error: "用户不存在" }, 404);
    const currentHash = await passwordHash(currentPassword, row.password_salt);
    if (!timingSafeEqual(currentHash, row.password_hash)) {
      return json({ ok: false, error: "当前密码不正确" }, 401);
    }
    if ((user.role || "user") === "admin") {
      const otherAdmin = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
        .bind(user.id).first();
      if (Number(otherAdmin?.total || 0) < 1) {
        return json({ ok: false, error: "最后一个管理员不能删除账号，请先移交管理员权限" }, 409);
      }
    }
    const [accounts, devices, deviceTokens, sessions] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?").bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM devices WHERE user_id = ?").bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM device_tokens WHERE user_id = ?").bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?").bind(user.id).first(),
    ]);
    const removed = {
      accounts: Number(accounts?.total || 0),
      devices: Number(devices?.total || 0),
      deviceTokens: Number(deviceTokens?.total || 0),
      sessions: Number(sessions?.total || 0),
    };
    if (writeAudit) {
      await writeAudit(env, user, {
        action: "delete-account",
        result: "confirmed",
        metadata: { removed },
      });
    }
    const requestId = user.requestContext?.requestId || "";
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      env.DB.prepare(
        "INSERT INTO account_deletion_events (id, reason, former_role, removed_json, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        "self-service",
        user.role || "user",
        JSON.stringify(removed),
        requestId,
        now,
      ),
    ]);
    return json({ ok: true, removed }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }

  return null;
}
