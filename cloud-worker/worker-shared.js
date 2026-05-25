export const SESSION_COOKIE = "codex_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100000;

export class ApiError extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function requestIdFor(request) {
  return request.headers.get("X-Request-Id")
    || request.headers.get("CF-Ray")
    || crypto.randomUUID();
}

export function requestContextFor(request, ctx, requestId) {
  const url = new URL(request.url);
  return {
    ctx,
    requestId,
    method: request.method,
    path: url.pathname,
    cfRay: request.headers.get("CF-Ray") || "",
    colo: request.cf?.colo || "",
    clientCountry: request.cf?.country || "",
  };
}

export function withRequestContext(entity, requestContext) {
  return entity ? { ...entity, requestContext } : entity;
}

export function responseWithRequestId(response, requestId) {
  const next = new Response(response.body, response);
  next.headers.set("X-Request-Id", requestId);
  return next;
}

function defaultErrorCode(status) {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 409) return "conflict";
  if (status === 413) return "request_body_too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal_error";
  return `http_${status}`;
}

export async function normalizeApiErrorResponse(response, requestContext) {
  if (!response || response.status < 400) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return response;
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;
  const requestId = body.requestId || requestContext?.requestId || "";
  const status = response.status;
  const method = requestContext?.method || "";
  const path = requestContext?.path || "";
  const nextBody = {
    ...body,
    ok: false,
    code: body.code || defaultErrorCode(status),
    requestId,
    diagnostic: body.diagnostic || {
      summary: `${method || "API"} ${path || ""} returned ${status}`.trim(),
      status,
      method,
      path,
    },
  };
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(nextBody), {
    status,
    headers,
  });
}

export async function readJson(request, maxBytes = 4 * 1024 * 1024) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ApiError("request body too large", 413, "request_body_too_large");
  }
  const text = await request.text();
  if (!text) return {};
  if (text.length > maxBytes) throw new ApiError("request body too large", 413, "request_body_too_large");
  return JSON.parse(text);
}

export function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function errorDetails(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error || "Internal error"),
    stack: error?.stack ? String(error.stack).slice(0, 2000) : "",
  };
}

export function clientErrorMessage(error) {
  if (error instanceof ApiError) return error.message;
  return "Internal error";
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoAfter(seconds, baseMs = Date.now()) {
  return new Date(baseMs + seconds * 1000).toISOString();
}

export function secondsUntilIso(value, baseMs = Date.now()) {
  const time = new Date(value || "").getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.floor((time - baseMs) / 1000);
}

function logJson(level, event, fields = {}) {
  const record = {
    event,
    service: "codex-cloud-console",
    timestamp: nowIso(),
    ...fields,
  };
  const text = JSON.stringify(record);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export function scheduleLog(ctx, level, event, fields) {
  const task = Promise.resolve()
    .then(() => logJson(level, event, fields))
    .catch((error) => {
      console.error(JSON.stringify({
        event: "worker.log_failed",
        service: "codex-cloud-console",
        timestamp: nowIso(),
        error: errorDetails(error),
      }));
    });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
  else void task;
}

export function logRequest(ctx, request, response, startedAt, requestId) {
  const url = new URL(request.url);
  const durationMs = Date.now() - startedAt;
  const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
  scheduleLog(ctx, level, "worker.request", {
    requestId,
    method: request.method,
    path: url.pathname,
    status: response.status,
    durationMs,
    cfRay: request.headers.get("CF-Ray") || "",
    colo: request.cf?.colo || "",
    clientCountry: request.cf?.country || "",
    userAgent: (request.headers.get("User-Agent") || "").slice(0, 180),
  });
}

export function base64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function bytesFromBase64Url(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

export async function sha256(value) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return base64Url(await crypto.subtle.digest("SHA-256", data));
}

export function parseCookies(request) {
  const cookies = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function temporaryPassword() {
  return `CodexTemp-${randomToken(8)}`;
}

export async function passwordHash(password, salt) {
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

export function timingSafeEqual(a, b) {
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

export async function encryptSecret(env, value) {
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

export async function decryptSecret(env, encryptedJson) {
  const envelope = JSON.parse(encryptedJson);
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64Url(envelope.iv) },
    key,
    bytesFromBase64Url(envelope.data),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function decodeJwtPayload(token) {
  if (!token || !token.includes(".")) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytesFromBase64Url(token.split(".")[1])));
  } catch {
    return {};
  }
}
