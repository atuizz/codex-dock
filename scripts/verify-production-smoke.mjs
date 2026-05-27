import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  listStoreZipEntries,
} from "./helper-release-utils.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const baseUrl = (process.env.CODEX_DOCK_SMOKE_BASE_URL || "https://codex.woai.pro").replace(/\/+$/, "");
const email = process.env.CODEX_DOCK_SMOKE_EMAIL || `smoke-${Date.now()}@example.test`;
const password = process.env.CODEX_DOCK_SMOKE_PASSWORD || "Commercial-Test-0426!";
const helperPath = process.env.CODEX_DOCK_LOCAL_HELPER_PATH || resolve(repoRoot, "dist", "CodexDockHelper", "CodexDockHelper.exe");

const cookies = new Map();

function cookieHeader() {
  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const values = raw.length ? raw : splitSetCookie(response.headers.get("set-cookie") || "");
  for (const value of values) {
    const pair = String(value).split(";", 1)[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=]+=[^;,]+)/g).map((value) => value.trim()).filter(Boolean);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookies.size) headers.set("Cookie", cookieHeader());
  let body = options.body;
  if (body !== undefined && typeof body !== "string" && !(body instanceof Uint8Array)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, body });
  storeCookies(response);
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") && text ? JSON.parse(text) : text;
  return { response, data, text };
}

async function download(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: cookies.size ? { Cookie: cookieHeader() } : undefined });
  assert.equal(response.status, 200, `${path} should return 200`);
  return new Uint8Array(await response.arrayBuffer());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function assertRequestId(result, label) {
  assert.match(result.response.headers.get("x-request-id") || "", /^[a-f0-9-]{8,}$/i, `${label} should include X-Request-Id`);
}

function loadBrowserUmd(source, globalName) {
  const sandbox = { window: {}, URL, URLSearchParams };
  sandbox.globalThis = sandbox.window;
  runInNewContext(source, sandbox, { timeout: 1000 });
  return sandbox.window[globalName];
}

const index = await request("/");
assert.equal(index.response.status, 200, "index should load");
assert.match(index.text, /Codex Dock/, "index should contain product name");
const manifest = await request("/asset-manifest.json");
assert.equal(manifest.response.status, 200, "asset manifest should load");
assert.match(manifest.data.version || "", /^[a-f0-9]{12}$/i, "asset manifest should include a generated content version");
const versionedRefs = [...index.text.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?v=([^"]+))?)"/g)]
  .map((match) => ({ file: match[1].split("?")[0], version: match[2] || "" }))
  .filter((ref) => (manifest.data.assets || []).some((asset) => asset.file === ref.file && ref.file !== "index.html"));
assert.ok(versionedRefs.length >= 10, "index should include versioned JS/CSS references");
assert.deepEqual(new Set(versionedRefs.map((ref) => ref.version)), new Set([manifest.data.version]), "all online JS/CSS refs should use manifest version");
assert.doesNotMatch(index.text, /20260525-oauth-primary2/, "online index should not keep a stale hand-written asset version");
const oauthCoreRef = versionedRefs.find((ref) => ref.file.endsWith("oauth-core.js"));
assert.ok(oauthCoreRef, "index should load oauth-core.js");
const oauthCoreAsset = await request(`/${oauthCoreRef.file.replace(/^\/+/, "")}?v=${manifest.data.version}`);
assert.equal(oauthCoreAsset.response.status, 200, "versioned oauth-core.js should load");
const oauthCore = loadBrowserUmd(oauthCoreAsset.text, "CodexOauthCore");
assert.ok(oauthCore?.providerErrorStatus, "production oauth-core should expose providerErrorStatus");
const oauthDenied = oauthCore.providerErrorStatus("error=access_denied&error_description=User%20cancelled&state=fresh");
assert.equal(oauthDenied.code, "oauth_provider_error", "OAuth provider denial should have a stable code");
assert.match(oauthDenied.message, /重新打开授权页面/, "OAuth provider denial should give one recovery action");
assert.doesNotMatch(oauthDenied.message, /没有收到有效授权结果/, "OAuth provider denial should not look like an empty callback");
assert.equal(oauthCore.callbackStateStatus("http://localhost:1455/auth/callback?code=old&state=old", "fresh").code, "oauth_state_mismatch", "stale OAuth callbacks should remain rejected");

const meBefore = await request("/api/me");
assert.equal(meBefore.response.status, 200, "me before login should return 200");
assert.equal(meBefore.data.user, null, "me before login should be anonymous");
assertRequestId(meBefore, "anonymous /api/me");

const anonymousDenied = await request("/api/accounts", {
  headers: { "X-Request-Id": "smoke-api-error" },
});
assert.equal(anonymousDenied.response.status, 401, "anonymous account list should be denied");
assert.equal(anonymousDenied.data.ok, false, "anonymous denial should be a structured error");
assert.equal(anonymousDenied.data.code, "unauthorized", "anonymous denial should include a stable error code");
assert.equal(anonymousDenied.data.requestId, "smoke-api-error", "anonymous denial should echo request id");
assert.equal(anonymousDenied.data.diagnostic?.summary, "GET /api/accounts returned 401", "anonymous denial should include diagnostic summary");

const registered = await request("/api/auth/register", {
  method: "POST",
  body: { email, password },
});
assert.equal(registered.response.status, 200, "register should succeed");
assert.equal(registered.data.ok, true, "register response should be ok");
assert.equal(registered.data.user.email, email, "registered user email should match");
assert.notEqual(registered.data.user.role, "admin", "production smoke requires an existing administrator so its disposable user can be deleted");
assertRequestId(registered, "register");

const usageSettings = await request("/api/settings/usage-refresh");
assert.equal(usageSettings.response.status, 200, "usage settings should load");
assert.equal(usageSettings.data.ok, true, "usage settings response should be ok");
assert.equal(usageSettings.data.settings.usageRefreshMode, "helper", "default refresh mode should prefer Helper");

const patchedSettings = await request("/api/settings/usage-refresh", {
  method: "PATCH",
  body: {
    usageRefreshMode: "auto",
    cloudUsageRefreshEnabled: true,
    helperFallbackToCloud: true,
    usageRefreshConcurrency: 2,
    usageRefreshIntervalMs: 1500,
  },
});
assert.equal(patchedSettings.response.status, 200, "usage settings patch should succeed");
assert.equal(patchedSettings.data.settings.usageRefreshMode, "auto", "usage settings patch should persist auto mode");

const deviceKey = `smoke-${Date.now()}`;
const deviceRegistered = await request("/api/devices/register", {
  method: "POST",
  body: {
    deviceKey,
    name: "Smoke Helper",
    helperOnline: true,
    helperBase: "http://127.0.0.1:18766",
    helperVersion: "0.4.9",
    helperBuildDate: "2026-05-27",
  },
});
assert.equal(deviceRegistered.response.status, 200, "device register should succeed");
assert.equal(deviceRegistered.data.ok, true, "device register response should be ok");

const devices = await request("/api/devices");
assert.equal(devices.response.status, 200, "device list should load");
assert.ok(devices.data.devices.some((device) => device.device_key === deviceKey && device.helper_version === "0.4.9"), "device list should include smoke Agent version");

const adminDenied = await request("/api/admin/summary");
assert.equal(adminDenied.response.status, 403, "normal smoke user must not access admin summary");
assert.equal(adminDenied.data.code, "forbidden", "admin denial should include stable error code");
assert.equal(adminDenied.data.diagnostic?.summary, "GET /api/admin/summary returned 403", "admin denial should include diagnostic summary");

const accounts = await request("/api/accounts");
assert.equal(accounts.response.status, 200, "accounts should load");
assert.equal(accounts.data.ok, true, "accounts response should be ok");
assert.doesNotMatch(accounts.text, /refresh_token|access_token|encrypted_auth_json|auth_json/i, "account list must not expose token material");

const recent = await request("/api/settings/usage-refresh/recent", {
  method: "POST",
  body: { accountIds: [] },
});
assert.equal(recent.response.status, 200, "recent usage refresh source endpoint should load");
assert.equal(recent.data.ok, true, "recent usage refresh source response should be ok");

const helperBytes = await download("/downloads/CodexDockHelper.exe");
const onlineHash = sha256(helperBytes);
assert.equal(manifest.data.helper?.sha256, onlineHash, "manifest Helper hash should match online download");
assert.match(manifest.data.helper?.version || "", /^\d+\.\d+\.\d+$/, "manifest Helper version should be present");
assert.match(manifest.data.helper?.build_date || "", /^\d{4}-\d{2}-\d{2}$/, "manifest Helper build date should be present");
assert.ok(manifest.data.helper?.release_manifest, "manifest should expose online Helper release manifest");
assert.ok(manifest.data.helper?.package?.file, "manifest should expose online Helper portable package");
const helperReleaseManifest = await request(`/${manifest.data.helper.release_manifest.replace(/^\/+/, "")}`);
assert.equal(helperReleaseManifest.response.status, 200, "Helper release manifest should load");
assert.equal(helperReleaseManifest.data.version, manifest.data.helper.version, "Helper release manifest version should match asset manifest");
const helperPackageBytes = await download(`/${manifest.data.helper.package.file.replace(/^\/+/, "")}`);
assert.equal(sha256(helperPackageBytes), manifest.data.helper.package.sha256, "online Helper package hash should match manifest");
assert.equal(helperPackageBytes.length, manifest.data.helper.package.bytes, "online Helper package size should match manifest");
const helperPackageEntries = new Set(listStoreZipEntries(helperPackageBytes).map((entry) => entry.name));
assert.ok(helperPackageEntries.has("CodexDockHelper/CodexDockHelper.exe"), "online Helper package should include the exe");
assert.ok(helperPackageEntries.has("CodexDockHelper/README.md"), "online Helper package should include installation docs");
assert.ok(helperPackageEntries.has("CodexDockHelper/CodexDockHelper-release.json"), "online Helper package should include release manifest");
let localHash = "";
try {
  localHash = sha256(await readFile(helperPath));
  assert.equal(onlineHash, localHash, "online Helper download should match local dist build");
} catch (error) {
  if (process.env.CODEX_DOCK_REQUIRE_LOCAL_HELPER_HASH === "1") throw error;
}

const deleted = await request("/api/me", {
  method: "DELETE",
  body: { confirmEmail: email, currentPassword: password },
});
assert.equal(deleted.response.status, 200, "disposable smoke user deletion should succeed");
assert.equal(deleted.data.ok, true, "smoke cleanup response should be ok");
assert.ok(deleted.data.removed.devices >= 1, "smoke cleanup should remove the registered test device");
const meAfter = await request("/api/me");
assert.equal(meAfter.data.user, null, "me after smoke cleanup should be anonymous");

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  email,
  helperBytes: helperBytes.length,
  helperSha256: onlineHash,
  localHelperSha256: localHash || null,
}, null, 2));

