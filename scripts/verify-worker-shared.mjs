import assert from "node:assert/strict";
import {
  ApiError,
  SESSION_COOKIE,
  clearSessionCookie,
  clientErrorMessage,
  decodeJwtPayload,
  decryptSecret,
  encryptSecret,
  json,
  passwordHash,
  parseJsonObject,
  randomToken,
  readJson,
  requestContextFor,
  requestIdFor,
  responseWithRequestId,
  sessionCookie,
  sha256,
  temporaryPassword,
  timingSafeEqual,
} from "../cloud-worker/worker-shared.js";

const request = new Request("https://codex.example.test/api/health", {
  headers: {
    "X-Request-Id": "req-test",
    "CF-Ray": "ray-test",
  },
});

assert.equal(SESSION_COOKIE, "codex_session");
assert.equal(requestIdFor(request), "req-test");

const context = requestContextFor(request, { waitUntil() {} }, "req-test");
assert.equal(context.requestId, "req-test");
assert.equal(context.path, "/api/health");
assert.equal(context.method, "GET");

const response = json({ ok: true });
assert.equal(response.status, 200);
assert.equal(response.headers.get("Cache-Control"), "no-store");
assert.deepEqual(await response.json(), { ok: true });

assert.deepEqual(await readJson(new Request("https://codex.example.test/api", {
  method: "POST",
  body: JSON.stringify({ hello: "world" }),
})), { hello: "world" });
await assert.rejects(
  () => readJson(new Request("https://codex.example.test/api", {
    method: "POST",
    headers: { "Content-Length": String(5 * 1024 * 1024) },
    body: "{}",
  })),
  /request body too large/,
);
assert.deepEqual(parseJsonObject('{"ok":true}'), { ok: true });
assert.deepEqual(parseJsonObject("[1,2]", { fallback: true }), { fallback: true });

const withRequest = responseWithRequestId(json({ ok: true }), "req-2");
assert.equal(withRequest.headers.get("X-Request-Id"), "req-2");

const cookie = sessionCookie("token value", request);
assert.match(cookie, /codex_session=token%20value/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Lax/);
assert.match(cookie, /Secure/);
assert.match(clearSessionCookie(request), /Max-Age=0/);

const token = randomToken(18);
assert.match(token, /^[A-Za-z0-9_-]+$/);
assert.match(temporaryPassword(), /^CodexTemp-/);
assert.equal(await sha256("same"), await sha256("same"));

const salt = randomToken(18);
const hash = await passwordHash("password-123", salt);
assert.equal(hash, await passwordHash("password-123", salt));
assert.equal(timingSafeEqual(hash, hash), true);
assert.equal(timingSafeEqual(hash, `${hash}x`), false);

const payload = { sub: "acct-1", email: "user@example.com" };
const jwtPayload = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
assert.deepEqual(decodeJwtPayload(`header.${jwtPayload}.sig`), payload);
assert.deepEqual(decodeJwtPayload("bad-token"), {});

const env = { TOKEN_ENCRYPTION_KEY: "test-secret-material-for-worker-shared" };
const encrypted = await encryptSecret(env, { access_token: "at", nested: { ok: true } });
assert.match(encrypted, /AES-GCM-SHA256-key/);
assert.deepEqual(await decryptSecret(env, encrypted), { access_token: "at", nested: { ok: true } });

const apiError = new ApiError("nope", 409, "conflict");
assert.equal(clientErrorMessage(apiError), "nope");
assert.equal(clientErrorMessage(new Error("internal")), "Internal error");

console.log("worker-shared verification passed");
