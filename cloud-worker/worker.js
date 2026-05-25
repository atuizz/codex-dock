import {
  ApiError,
  clientErrorMessage,
  errorDetails,
  json,
  logRequest,
  normalizeApiErrorResponse,
  requestContextFor,
  requestIdFor,
  responseWithRequestId,
  scheduleLog,
  withRequestContext,
} from "./worker-shared.js";
import {
  handleAuth,
  handleOauthExchange,
  publicUser,
  requireUser,
} from "./worker-auth.js";
import {
  handleAccounts,
} from "./worker-accounts.js";
import {
  handleDeviceRoutes,
  handleHelperAutoSwitch,
} from "./worker-helper.js";
import {
  handleAdmin,
} from "./worker-admin.js";
import {
  handleAudit,
  writeAudit,
} from "./worker-audit.js";
import {
  handleUserRoutes,
} from "./worker-user.js";
import {
  handleUsageRoutes,
} from "./worker-usage.js";

async function handleApi(request, env, requestContext) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response("", { status: 204 });
  if (request.method === "GET" && path === "/api/health") return json({ ok: true, mode: "codex-cloud-console" });
  if (path === "/api/oauth/exchange") return handleOauthExchange(request);

  const auth = await handleAuth(request, env, path);
  if (auth) return auth;

  const helperAutoSwitch = await handleHelperAutoSwitch(request, env, path, requestContext, { writeAudit });
  if (helperAutoSwitch) return helperAutoSwitch;

  const user = withRequestContext(await requireUser(request, env), requestContext);
  if (request.method === "GET" && path === "/api/me" && !user) {
    return json({ ok: true, user: null });
  }
  if (!user) return json({ ok: false, error: "未登录" }, 401);

  if (request.method === "GET" && path === "/api/me") {
    return json({ ok: true, user: publicUser(user) });
  }

  return (await handleUserRoutes(request, env, user, path, { writeAudit }))
    || (await handleAdmin(request, env, user, path))
    || (await handleUsageRoutes(request, env, user, path, { writeAudit }))
    || (await handleAccounts(request, env, user, path, { writeAudit }))
    || (await handleDeviceRoutes(request, env, user, path, { writeAudit }))
    || (await handleAudit(request, env, user, path))
    || json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = requestIdFor(request);
    const requestContext = requestContextFor(request, ctx, requestId);
    let response;
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        response = await handleApi(request, env, requestContext);
      } else {
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      scheduleLog(ctx, status >= 500 ? "error" : "warn", "worker.exception", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        error: errorDetails(error),
      });
      response = json({ ok: false, error: clientErrorMessage(error), code: error?.code || "internal_error", requestId }, status);
    }
    if (new URL(request.url).pathname.startsWith("/api/")) {
      response = await normalizeApiErrorResponse(response, requestContext);
    }
    response = responseWithRequestId(response, requestId);
    logRequest(ctx, request, response, startedAt, requestId);
    return response;
  },
};
