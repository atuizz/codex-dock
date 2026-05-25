import {
  nowIso,
} from "./worker-shared.js";

export const DEFAULT_AUTO_SWITCH_SETTINGS = {
  enabled: false,
  fiveHourThreshold: 5,
  oneWeekThreshold: 5,
  pollSeconds: 15,
  idlePollSeconds: 300,
  paidOnly: true,
  preferRt: true,
  allowAt: false,
  showExperimentalAt: false,
  avoidCurrent: true,
  avoidLow5h: true,
  avoidLow7d: true,
  cooldownMinutes: 10,
  globalCooldownSeconds: 180,
  onlyWhenIdle: true,
  idleSeconds: 10,
  activityQuietSeconds: 120,
  cpuQuietSeconds: 90,
  cpuBusyPercent: 3,
};

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

export function normalizeAutoSwitchSettings(input = {}, base = DEFAULT_AUTO_SWITCH_SETTINGS) {
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
    showExperimentalAt: boolValue(next.showExperimentalAt, DEFAULT_AUTO_SWITCH_SETTINGS.showExperimentalAt),
    avoidCurrent: boolValue(next.avoidCurrent, DEFAULT_AUTO_SWITCH_SETTINGS.avoidCurrent),
    avoidLow5h: boolValue(next.avoidLow5h, DEFAULT_AUTO_SWITCH_SETTINGS.avoidLow5h),
    avoidLow7d: boolValue(next.avoidLow7d, DEFAULT_AUTO_SWITCH_SETTINGS.avoidLow7d),
    cooldownMinutes: clampNumber(next.cooldownMinutes, DEFAULT_AUTO_SWITCH_SETTINGS.cooldownMinutes, 0, 240),
    globalCooldownSeconds: clampNumber(next.globalCooldownSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.globalCooldownSeconds, 30, 1800),
    onlyWhenIdle: boolValue(next.onlyWhenIdle, DEFAULT_AUTO_SWITCH_SETTINGS.onlyWhenIdle),
    idleSeconds: clampNumber(next.idleSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.idleSeconds, 10, 1800),
    activityQuietSeconds: clampNumber(next.activityQuietSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.activityQuietSeconds, 30, 1800),
    cpuQuietSeconds: clampNumber(next.cpuQuietSeconds, DEFAULT_AUTO_SWITCH_SETTINGS.cpuQuietSeconds, 15, 600),
    cpuBusyPercent: clampNumber(next.cpuBusyPercent, DEFAULT_AUTO_SWITCH_SETTINGS.cpuBusyPercent, 1, 80),
  };
}

export async function readAutoSwitchSettings(env, user) {
  const row = await env.DB.prepare("SELECT auto_switch_json FROM user_settings WHERE user_id = ?").bind(user.id).first();
  if (!row?.auto_switch_json) return normalizeAutoSwitchSettings();
  try {
    return normalizeAutoSwitchSettings(JSON.parse(row.auto_switch_json));
  } catch {
    return normalizeAutoSwitchSettings();
  }
}

export async function saveAutoSwitchSettings(env, user, patch) {
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
