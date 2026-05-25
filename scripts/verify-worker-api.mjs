import assert from "node:assert/strict";
import worker from "../cloud-worker/worker.js";

const waitUntilTasks = [];
const ctx = {
  waitUntil(task) {
    waitUntilTasks.push(Promise.resolve(task));
  },
};

const env = {
  ASSETS: {
    fetch() {
      return new Response("asset", { status: 200 });
    },
  },
  DB: {
    prepare(sql) {
      throw new Error(`Unexpected DB query: ${sql}`);
    },
  },
};

const missingOauth = await worker.fetch(new Request("https://codex.example.test/api/oauth/exchange", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Request-Id": "req-api-missing-oauth",
  },
  body: "{}",
}), env, ctx);
assert.equal(missingOauth.status, 400);
assert.equal(missingOauth.headers.get("X-Request-Id"), "req-api-missing-oauth");
const missingOauthBody = await missingOauth.json();
assert.equal(missingOauthBody.ok, false);
assert.equal(missingOauthBody.code, "bad_request");
assert.equal(missingOauthBody.requestId, "req-api-missing-oauth");
assert.deepEqual(missingOauthBody.diagnostic, {
  summary: "POST /api/oauth/exchange returned 400",
  status: 400,
  method: "POST",
  path: "/api/oauth/exchange",
});

const anonymous = await worker.fetch(new Request("https://codex.example.test/api/accounts", {
  method: "GET",
  headers: { "X-Request-Id": "req-api-unauthorized" },
}), env, ctx);
assert.equal(anonymous.status, 401);
const anonymousBody = await anonymous.json();
assert.equal(anonymousBody.ok, false);
assert.equal(anonymousBody.error, "未登录");
assert.equal(anonymousBody.code, "unauthorized");
assert.equal(anonymousBody.requestId, "req-api-unauthorized");
assert.equal(anonymousBody.diagnostic.summary, "GET /api/accounts returned 401");

const tooLarge = await worker.fetch(new Request("https://codex.example.test/api/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": String(5 * 1024 * 1024),
    "X-Request-Id": "req-api-too-large",
  },
  body: "{}",
}), env, ctx);
assert.equal(tooLarge.status, 413);
const tooLargeBody = await tooLarge.json();
assert.equal(tooLargeBody.ok, false);
assert.equal(tooLargeBody.code, "request_body_too_large");
assert.equal(tooLargeBody.requestId, "req-api-too-large");
assert.equal(tooLargeBody.diagnostic.summary, "POST /api/auth/login returned 413");

const asset = await worker.fetch(new Request("https://codex.example.test/asset.txt", {
  headers: { "X-Request-Id": "req-asset" },
}), env, ctx);
assert.equal(asset.status, 200);
assert.equal(await asset.text(), "asset");
assert.equal(asset.headers.get("X-Request-Id"), "req-asset");

await Promise.all(waitUntilTasks);

console.log("worker-api verification passed");
