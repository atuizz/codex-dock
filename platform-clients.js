(function () {
  function jsonHeaders(body, headers = {}) {
    return {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    };
  }

  async function readJsonResponse(response, fallbackError) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `${fallbackError}：${response.status}`);
    }
    return result;
  }

  function createCloudApiClient(options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    return {
      async request(path, requestOptions = {}) {
        const init = {
          method: requestOptions.method || "GET",
          credentials: "include",
          headers: jsonHeaders(requestOptions.body, requestOptions.headers),
        };
        if (requestOptions.body !== undefined) {
          init.body = typeof requestOptions.body === "string" ? requestOptions.body : JSON.stringify(requestOptions.body);
        }
        const result = await readJsonResponse(await fetchImpl(path, init), "请求失败");
        if (result.ok === false) throw new Error(result.error || "请求失败");
        return result;
      },
    };
  }

  function helperBaseCandidates(startPort = 18766, count = 5) {
    return Array.from({ length: count }, (_, index) => `http://127.0.0.1:${startPort + index}`);
  }

  function isKnownHelperHealth(result) {
    const mode = result?.mode || "";
    return Boolean(result?.ok && (mode === "local-helper" || mode === "native-helper" || mode === "codex-plus-helper"));
  }

  function createHelperClient(base, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const root = String(base || "").replace(/\/+$/, "");
    if (!root) throw new Error("Dock Helper 未连接");

    async function request(path, requestOptions = {}) {
      const { allowAppError, body, headers, ...rest } = requestOptions;
      const init = {
        method: rest.method || "GET",
        cache: rest.cache,
        headers: jsonHeaders(body, headers),
      };
      if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
      }
      const result = await readJsonResponse(await fetchImpl(`${root}${path}`, init), "Helper 请求失败");
      if (result.ok === false && !allowAppError) throw new Error(result.error || "Helper 执行失败");
      return result;
    }

    return {
      base: root,
      health() {
        return request("/api/health", { cache: "no-store" });
      },
      repairTray() {
        return request("/api/tray/repair", { method: "POST" });
      },
      currentAuth() {
        return request("/api/current-auth", { cache: "no-store" });
      },
      oauthCallbackLatest(state) {
        const query = state ? `?state=${encodeURIComponent(state)}` : "";
        return request(`/api/oauth/callback/latest${query}`, { cache: "no-store" });
      },
      pair(payload) {
        return request("/api/pair", { method: "POST", body: payload });
      },
      configureProxy(action) {
        return request(`/api/codex/proxy/${encodeURIComponent(action)}`, { method: "POST" });
      },
      codexStatus() {
        return request("/api/codex/status", { cache: "no-store" });
      },
      restoreTarget() {
        return request("/api/codex/restore-target", { cache: "no-store" });
      },
      configureAutoSwitch(config) {
        return request("/api/auto-switch/configure", { method: "POST", body: config });
      },
      applyAuth(payload) {
        return request("/api/apply-auth", { method: "POST", body: payload });
      },
      previewUsage(payload) {
        return request("/api/usage/preview", { method: "POST", body: payload, allowAppError: true });
      },
      migrateCacheUrl(targetOrigin) {
        return `${root}/migrate-cache?target=${encodeURIComponent(targetOrigin)}`;
      },
    };
  }

  window.CodexPlatformClients = Object.freeze({
    createCloudApiClient,
    createHelperClient,
    helperBaseCandidates,
    isKnownHelperHealth,
  });
})();
