import {
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

  return null;
}
