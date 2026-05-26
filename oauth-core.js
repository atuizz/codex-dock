(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexOauthCore = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const defaultRedirectUri = "http://localhost:1455/auth/callback";

  function normalizeOauthCallbackValue(raw, redirectUri = defaultRedirectUri) {
    const text = String(raw || "").trim();
    if (!text) throw new Error("请先粘贴回调链接。");
    const cleaned = text
      .replace(/&amp;/g, "&")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
    const compact = cleaned.replace(/\s+/g, "");
    const sources = [cleaned, compact];
    for (const source of sources) {
      const callbackUrl = source.match(/https?:\/\/(?:localhost|127\.0\.0\.1):1455\/auth\/callback[^\s"'<>]*/i)
        || source.match(/(?:localhost|127\.0\.0\.1):1455\/auth\/callback[^\s"'<>]*/i);
      if (callbackUrl) {
        const value = callbackUrl[0].replace(/[),.;，。]+$/g, "");
        return /^https?:\/\//i.test(value) ? value : `http://${value}`;
      }
    }
    const anyUrl = compact.match(/https?:\/\/[^\s"'<>]+/i);
    if (anyUrl) return anyUrl[0].replace(/[),.;，。]+$/g, "");
    const paramMatch = compact.match(/(?:^|[?#&])((?:code|error|access_token|accessToken|id_token|idToken|refresh_token|refreshToken)=[^"'<>]+)/);
    if (paramMatch) {
      const query = paramMatch[1].replace(/^[?#&]/, "");
      return `${redirectUri}?${query}`;
    }
    const bareParam = compact.match(/\b((?:code|error|access_token|accessToken|id_token|idToken|refresh_token|refreshToken)=[^"'<>]+)/);
    if (bareParam) return `${redirectUri}?${bareParam[1]}`;
    if (/^(?:localhost|127\.0\.0\.1):1455\/auth\/callback/i.test(compact)) return `http://${compact}`;
    if (/^https?:\/\//i.test(compact)) return compact;
    return `${redirectUri}${compact.startsWith("?") || compact.startsWith("#") ? compact : `?${compact}`}`;
  }

  function callbackParams(raw, redirectUri = defaultRedirectUri) {
    const value = normalizeOauthCallbackValue(raw, redirectUri);
    const url = new URL(value);
    const params = new URLSearchParams(url.search);
    if (url.hash) {
      const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(hash);
      for (const [key, val] of hashParams.entries()) params.set(key, val);
    }
    return params;
  }

  function callbackStateStatus(rawOrParams, expectedState = "", redirectUri = defaultRedirectUri) {
    const params = rawOrParams instanceof URLSearchParams ? rawOrParams : callbackParams(rawOrParams, redirectUri);
    const returnedState = params.get("state") || "";
    if (expectedState && !returnedState) {
      return {
        ok: false,
        code: "oauth_state_missing",
        state: "",
        message: "授权回调缺少本次登录的校验标识。请重新打开授权页面，并只使用刚打开页面返回的回调。",
      };
    }
    if (expectedState && returnedState && returnedState !== expectedState) {
      return {
        ok: false,
        code: "oauth_state_mismatch",
        state: returnedState,
        message: "收到的授权回调不属于当前这次登录。请重新打开授权页面，并只使用刚打开页面返回的回调。",
      };
    }
    return { ok: true, state: returnedState };
  }

  function providerErrorStatus(rawOrParams, redirectUri = defaultRedirectUri) {
    const params = rawOrParams instanceof URLSearchParams ? rawOrParams : callbackParams(rawOrParams, redirectUri);
    const error = params.get("error") || "";
    if (!error) return { ok: true };
    const rawDescription = params.get("error_description") || params.get("errorDescription") || "";
    const description = rawDescription
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    const friendly = /access_denied/i.test(error)
      ? "你取消了授权，或授权页面没有完成登录"
      : (description || `授权服务返回 ${error}`);
    return {
      ok: false,
      code: "oauth_provider_error",
      error,
      description,
      message: `授权未完成：${friendly}。请重新打开授权页面，并只使用刚打开页面返回的回调。`,
    };
  }

  function exchangeFailureMessage(message) {
    const detail = String(message || "换取 token 失败");
    if (/could not validate|invalid_grant|expired|code|verifier|already used|已过期|已失效/i.test(detail)) {
      return "授权回调已失效、已被使用，或和当前授权链接不匹配";
    }
    return detail;
  }

  function emptyCallbackMessage(usedOauthCode = false) {
    return usedOauthCode
      ? "OAuth code 已收到，但没有换到可用授权。请重新打开授权页面。"
      : "没有收到有效授权结果。请点击“打开授权页面”重新授权；手动回调只作为自动接收失败后的备用。";
  }

  return Object.freeze({
    normalizeOauthCallbackValue,
    callbackParams,
    callbackStateStatus,
    providerErrorStatus,
    exchangeFailureMessage,
    emptyCallbackMessage,
  });
});
