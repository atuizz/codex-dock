const localStoreKey = "codex-local-store-v5";
const previousStoreKey = "codex-local-store-v4";
const legacyStoreKey = "codex-account-switcher-store-v3";
const deviceKeyStorage = "codex-plus-device-key-v1";
const cachedEmailStorage = "codex-cloud-console-email-v1";
const chatgptLoginUrl = "https://chatgpt.com/auth/login";
const chatgptSessionUrl = "https://chatgpt.com/api/auth/session";
const codexLoginCommand = "codex login";
const oauthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const oauthRedirectUri = "http://localhost:1455/auth/callback";
const oauthPkceStorage = "codex-dock-oauth-pkce-v1";

const defaultAccountFilters = {
  plan: "all",
  token: "all",
  usage: "all",
  status: "all",
};

const defaultSmartSwitchSettings = {
  paidOnly: true,
  preferRt: true,
  allowAt: true,
  avoidCurrent: true,
  avoidLow5h: true,
  avoidLow7d: true,
  cooldownMinutes: 0,
};

const defaultAutoSwitchSettings = {
  enabled: false,
  fiveHourThreshold: 5,
  oneWeekThreshold: 5,
  pollSeconds: 15,
  idlePollSeconds: 300,
  paidOnly: true,
  preferRt: true,
  allowAt: true,
  avoidCurrent: true,
  avoidLow5h: true,
  avoidLow7d: true,
  cooldownMinutes: 10,
  globalCooldownSeconds: 180,
  onlyWhenIdle: true,
  idleSeconds: 30,
  activityQuietSeconds: 120,
  cpuQuietSeconds: 90,
  cpuBusyPercent: 3,
};

const state = {
  user: null,
  authResolved: false,
  localAccounts: [],
  cloudAccounts: [],
  accounts: [],
  audit: [],
  adminSummary: null,
  adminUsers: [],
  adminAudit: [],
  adminDevices: [],
  selectedAdminUserIds: new Set(),
  adminFilters: {
    userQuery: "",
    role: "",
    status: "",
    auditQuery: "",
    auditAction: "",
  },
  selectedId: null,
  accountFilter: "all",
  accountFilters: { ...defaultAccountFilters },
  accountSort: "updated",
  accountLayout: "list",
  selectedBulkIds: new Set(),
  smartSwitchSettings: { ...defaultSmartSwitchSettings },
  autoSwitchSettings: { ...defaultAutoSwitchSettings },
  autoSwitchStatus: {
    helperAuthorized: false,
    lastCheck: "",
    lastSwitch: "",
    lastReason: "",
  },
  accountSearch: "",
  sidebarCollapsed: localStorage.getItem("codex-sidebar-collapsed-v1") === "1",
  currentView: "accounts",
  settingsTab: "account",
  helperReady: false,
  helperBase: "",
  helperInfo: null,
  codexProxy: null,
  codexStatus: null,
  deviceKey: "",
  localAuthFingerprint: "",
  currentAuthKey: "",
  currentAuthAccount: null,
  currentAuthChecking: false,
  autoImportingLocalAuth: false,
  refreshingUsage: false,
  pendingImportItems: [],
  commandFiles: [],
  importMode: "paste",
  importCompleted: false,
  operationProgress: {
    active: false,
    done: false,
    title: "",
    summary: "",
    items: [],
  },
  authMode: "login",
  syncChoices: {},
  oauthAuthUrl: "",
  oauthCodeVerifier: "",
  oauthState: "",
};

const decoder = new TextDecoder();
const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function showImportResult(result) {
  const el = $("importResult");
  if (!el) return;
  el.hidden = false;
  const title = result.preview ? "核查结果" : "导入完成";
  const refreshTotal = result.cloud ? (result.cloud.refreshed || 0) + (result.cloud.refreshFailed || 0) : 0;
  const cloudText = result.cloud
    ? `<span>云端：新增 ${result.cloud.added || 0} · 更新 ${result.cloud.updated || 0} · 失败 ${result.cloud.failed || 0}${refreshTotal ? ` · 额度刷新 ${result.cloud.refreshed || 0}/${refreshTotal}` : ""}</span>`
    : "";
  el.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(result.message || `新增 ${result.added || 0} · 更新 ${result.updated || 0} · 失败 ${result.failed || 0}`)}</span>
    ${cloudText}
  `;
  renderImportPreview();
}

function authAcquirePanel(reason = "") {
  return `
    <div class="auth-acquire-panel compact">
      <div>
        <strong>${escapeHtml(reason || "重新获取授权")}</strong>
        <span>按来源选择 Session 或 OAuth，不混用。</span>
      </div>
      <div class="auth-method-columns">
        <div>
          <strong>Session</strong>
          <div class="auth-acquire-actions">
            <button type="button" data-auth-action="open-import-session">去导入 Session</button>
            <button type="button" data-auth-action="open-session-json">打开 Session JSON</button>
            <button type="button" data-auth-action="copy-session-url">复制地址</button>
          </div>
        </div>
        <div>
          <strong>OAuth</strong>
          <div class="auth-acquire-actions">
            <button type="button" data-auth-action="open-import-oauth">去导入 OAuth</button>
            <button type="button" data-auth-action="open-oauth-login">打开授权页</button>
            <button type="button" data-auth-action="copy-oauth-url">复制授权链接</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function rememberOauthPkce(verifier, stateValue) {
  const payload = { verifier, state: stateValue, redirectUri: oauthRedirectUri, clientId: oauthClientId, createdAt: Date.now() };
  state.oauthCodeVerifier = verifier;
  state.oauthState = stateValue;
  localStorage.setItem(oauthPkceStorage, JSON.stringify(payload));
}

function oauthPkce() {
  try {
    const payload = JSON.parse(localStorage.getItem(oauthPkceStorage) || "{}");
    if (payload?.verifier && Date.now() - Number(payload.createdAt || 0) < 30 * 60 * 1000) return payload;
  } catch {
    return {};
  }
  return {};
}

async function refreshOauthAuthorizeUrl() {
  const verifier = randomBase64Url(64);
  const stateValue = randomBase64Url(18);
  const challenge = await sha256Base64Url(verifier);
  rememberOauthPkce(verifier, stateValue);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: oauthClientId,
    redirect_uri: oauthRedirectUri,
    scope: "openid email profile offline_access",
    audience: "https://api.openai.com/v1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: stateValue,
  });
  state.oauthAuthUrl = `https://auth.openai.com/oauth/authorize?${params.toString()}`;
  if ($("oauthAuthUrl")) $("oauthAuthUrl").value = state.oauthAuthUrl;
  return state.oauthAuthUrl;
}

async function currentOauthAuthorizeUrl() {
  if (state.oauthAuthUrl) return state.oauthAuthUrl;
  return refreshOauthAuthorizeUrl();
}

async function handleAuthAcquireAction(action) {
  if (action === "open-import-session" || action === "open-import-oauth") {
    closeModal("accountDetailModal");
    setDrawer(true);
    setImportMode(action === "open-import-oauth" ? "oauth" : "session");
    toast(action === "open-import-oauth" ? "已打开 OAuth 导入。" : "已打开 Session 导入。");
    return;
  }
  if (action === "open-chatgpt-login") {
    window.open(chatgptLoginUrl, "_blank", "noopener,noreferrer");
    return;
  }
  if (action === "open-session-json") {
    window.open(chatgptSessionUrl, "_blank", "noopener,noreferrer");
    toast("登录后复制页面 JSON，再回到导入页粘贴解析。");
    return;
  }
  if (action === "copy-session-url") {
    await navigator.clipboard.writeText(chatgptSessionUrl);
    toast("Session 地址已复制。");
    return;
  }
  if (action === "copy-codex-login") {
    await navigator.clipboard.writeText(codexLoginCommand);
    toast("Codex 登录命令已复制。执行后点击“同步本机 auth”。");
    return;
  }
  if (action === "open-oauth-login") {
    window.open(await currentOauthAuthorizeUrl(), "_blank", "noopener,noreferrer");
    return;
  }
  if (action === "copy-oauth-url") {
    await navigator.clipboard.writeText(await currentOauthAuthorizeUrl());
    toast("OAuth 授权链接已复制。");
    return;
  }
  if (action === "sync-local-auth") {
    await importCurrentLocalAuth();
  }
}

function importStatusClass(status) {
  if (status === "新增") return "ok";
  if (status === "更新") return "ok";
  return "bad";
}

function importIdentityKeys(account) {
  const keys = new Set();
  const dedupe = accountDedupeKey(account);
  if (dedupe && !dedupe.startsWith("id:")) keys.add(dedupe);
  const accountId = String(account?.accountId || account?.account_id || account?.session?.tokens?.account_id || "").trim().toLowerCase();
  if (accountId) keys.add(`account:${accountId}`);
  const email = String(account?.email || account?.session?.email || "").trim().toLowerCase();
  if (email) keys.add(`email:${email}`);
  const fingerprint = authFingerprint(account?.session);
  if (fingerprint && fingerprint.replace(/\|/g, "")) keys.add(`token:${fingerprint}`);
  return [...keys];
}

function existingImportKeys() {
  const keys = new Set();
  const sources = state.user ? state.cloudAccounts : state.localAccounts;
  for (const account of sources) {
    for (const key of importIdentityKeys(account)) keys.add(key);
  }
  return keys;
}

function accountExistsInImportKeys(account, existing) {
  return importIdentityKeys(account).some((key) => existing.has(key));
}

function buildPendingImportItems(entries, sourceName) {
  const existing = existingImportKeys();
  return entries.map((entry) => {
    if (!entry.ok || !entry.session) {
      return {
        id: crypto.randomUUID(),
        ok: false,
        status: "无法解析",
        sourceName,
        error: entry.error || "解析失败",
        accountName: entry.sourceName || "未知账号",
      };
    }
    const session = entry.session;
    const account = normalizeLocalAccount({
      id: crypto.randomUUID(),
      name: entry.accountName || session.email || shortId(session.tokens.account_id) || "未命名账号",
      email: session.email || "",
      group: "默认",
      priority: "normal",
      usageNote: sourceName,
      expiryNote: session.expires || "",
      accountId: session.tokens.account_id || "",
      expiresAt: session.expires || "",
      planType: session.profile?.plan || "",
      usage: hasUsageSnapshot(session.usage) ? normalizeUsage(session.usage, session.profile?.plan) : null,
      session,
    });
    const existsInPool = accountExistsInImportKeys(account, existing);
    const token = tokenState(account);
    return {
      id: crypto.randomUUID(),
      ok: true,
      status: existsInPool ? "更新" : "新增",
      sourceName,
      account,
      accountName: account.name,
      email: account.email,
      accountId: account.accountId,
      plan: planLabel(accountPlan(account)),
      tokenLabel: token.label,
      hasRt: hasUsableRefreshToken(account),
    };
  });
}

function normalizePendingImportStatuses(items) {
  const existing = existingImportKeys();
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    if (!item.ok || !item.account) {
      normalized.push(item);
      continue;
    }
    const keys = importIdentityKeys(item.account);
    if (keys.some((key) => seen.has(key))) continue;
    const existsInPool = accountExistsInImportKeys(item.account, existing);
    item.status = existsInPool ? "更新" : "新增";
    keys.forEach((key) => seen.add(key));
    normalized.push(item);
  }
  return normalized;
}

function renderImportPreview() {
  const list = $("importPreviewList");
  const summary = $("importPreviewSummary");
  const confirm = $("confirmImportBtn");
  if (!list || !summary || !confirm) return;
  const items = state.pendingImportItems;
  const importable = items.filter((item) => item.ok);
  const added = items.filter((item) => item.status === "新增").length;
  const updated = items.filter((item) => item.status === "更新").length;
  const failed = items.filter((item) => item.status === "无法解析").length;
  const finish = $("finishImportBtn");
  const clear = $("clearFormBtn");
  confirm.hidden = state.importCompleted;
  confirm.disabled = !importable.length || state.operationProgress.active;
  finish.hidden = !state.importCompleted;
  finish.classList.toggle("primary", state.importCompleted);
  clear.textContent = state.importCompleted ? "继续导入" : "清空预览";
  clear.classList.toggle("soft-action", !state.importCompleted);
  summary.textContent = items.length
    ? `解析到 ${items.length} 个，新增 ${added} 个，更新 ${updated} 个，失败 ${failed} 个`
    : "还没有待导入账号";
  if (!items.length) {
    list.innerHTML = '<div class="empty small">选择文件或粘贴 JSON 后，先在这里预览解析结果。</div>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="import-preview-item ${item.ok ? "" : "bad"}">
      <div class="import-preview-main">
        <strong>${escapeHtml(item.email || item.accountName || "未知账号")}</strong>
        <span>${escapeHtml(item.accountName || item.accountId || item.error || "")}</span>
      </div>
      ${item.ok ? `
        <div class="import-preview-meta">
          <span>${escapeHtml(item.plan || "未知")}</span>
          <span>${escapeHtml(item.tokenLabel || "无 token")}</span>
          <span>${item.hasRt ? "有 RT" : "仅 AT"}</span>
          <span>${escapeHtml(shortId(item.accountId || ""))}</span>
          <span>${escapeHtml(item.sourceName || "导入内容")}</span>
        </div>
      ` : `<div class="import-preview-meta"><span>${escapeHtml(item.sourceName || "导入内容")}</span><span>${escapeHtml(item.error || "解析失败")}</span></div>`}
      <span class="import-status ${importStatusClass(item.status)}">${escapeHtml(item.status)}</span>
      ${item.error ? `<span class="import-error">${escapeHtml(item.error)}</span>` : ""}
    </div>
  `).join("");
}

function setImportMode(mode) {
  state.importMode = mode;
  document.querySelectorAll("[data-import-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.importMode === mode);
  });
  document.querySelectorAll("[data-import-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.importPanel === mode);
  });
  if (mode === "oauth") refreshOauthAuthorizeUrl().catch(() => toast("OAuth 授权链接生成失败。"));
}

function clearImportWorkflow() {
  state.pendingImportItems = [];
  state.importCompleted = false;
  $("sessionInput").value = "";
  if ($("oauthCallbackInput")) $("oauthCallbackInput").value = "";
  $("jsonFileInput").value = "";
  $("importResult").hidden = true;
  renderImportPreview();
}

function importableJsonFiles(fileList) {
  return Array.from(fileList || []).filter((file) => /\.json$/i.test(file.name) || file.type === "application/json" || !file.type);
}

function setCommandFiles(fileList) {
  const next = importableJsonFiles(fileList);
  const byKey = new Map(state.commandFiles.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
  for (const file of next) byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
  state.commandFiles = [...byKey.values()];
  renderCommandAttachments();
  renderShellState();
  if (!next.length && fileList?.length) toast("这里只支持 JSON 文件。");
}

function clearCommandFiles() {
  state.commandFiles = [];
  renderCommandAttachments();
  renderShellState();
}

function renderCommandAttachments() {
  const list = $("commandAttachments");
  if (!list) return;
  list.hidden = !state.commandFiles.length;
  list.innerHTML = state.commandFiles.map((file, index) => `
    <button class="attachment-chip" type="button" data-attachment-index="${index}" title="移除 ${escapeHtml(file.name)}">
      <span>${escapeHtml(file.name)}</span>
      <small>${formatBytes(file.size)}</small>
      <strong aria-hidden="true">×</strong>
    </button>
  `).join("");
}

function renderShellState() {
  const button = $("quickSwitchBtn");
  const shell = $("commandShell");
  if (!button || !shell) return;
  const hasFiles = state.commandFiles.length > 0;
  button.textContent = hasFiles ? "解析导入" : "智能切换";
  button.disabled = hasFiles
    ? false
    : !state.accounts.some(canUseAccount);
  shell.classList.toggle("has-attachments", hasFiles);
}

function renderToolbarState(filtered = visibleAccounts()) {
  const sort = $("accountSortSelect");
  if (sort) sort.value = state.accountSort;
  const filters = state.accountFilters || defaultAccountFilters;
  const map = { filterPlan: "plan", filterToken: "token", filterUsage: "usage", filterStatus: "status" };
  for (const [id, key] of Object.entries(map)) {
    if ($(id)) $(id).value = filters[key] || "all";
  }
  document.querySelectorAll("[data-layout]").forEach((button) => button.classList.toggle("active", button.dataset.layout === state.accountLayout));
  const selected = filtered.filter((account) => state.selectedBulkIds.has(account.id));
  $("bulkCount").textContent = selected.length ? `已选择 ${selected.length} 个账号` : `当前结果 ${filtered.length} 个`;
  $("bulkBar").classList.toggle("has-selection", selected.length > 0);
  $("bulkRefreshBtn").disabled = !selected.length || !state.helperReady;
  $("bulkExportBtn").disabled = !selected.length;
  $("bulkDeleteBtn").disabled = !selected.length;
  $("bulkPrioritySelect").disabled = !selected.length;
}

function parseImportTextToPreview() {
  const text = $("sessionInput").value.trim();
  if (!text) {
    state.pendingImportItems = [];
    state.importCompleted = false;
    showImportResult({ preview: true, message: "先粘贴账号 JSON，再解析。" });
    renderImportPreview();
    return;
  }
  try {
    state.pendingImportItems = normalizePendingImportStatuses(buildPendingImportItems(parseImportEntries(text), "粘贴文本"));
    state.importCompleted = false;
    $("importResult").hidden = true;
    renderImportPreview();
  } catch (error) {
    state.pendingImportItems = [{
      id: crypto.randomUUID(),
      ok: false,
      status: "无法解析",
      sourceName: "粘贴文本",
      accountName: "JSON",
      error: error.message || "JSON 格式不正确",
    }];
    state.importCompleted = false;
    renderImportPreview();
  }
}

function callbackParams(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("请先粘贴回调链接。");
  const value = text.startsWith("http") ? text : `${oauthRedirectUri}${text.startsWith("?") || text.startsWith("#") ? text : `?${text}`}`;
  const url = new URL(value);
  const params = new URLSearchParams(url.search);
  if (url.hash) {
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hash);
    for (const [key, val] of hashParams.entries()) params.set(key, val);
  }
  return params;
}

async function exchangeOauthCode(code, pkce) {
  const result = await api("/api/oauth/exchange", {
    method: "POST",
    body: {
      code,
      codeVerifier: pkce.verifier,
      redirectUri: pkce.redirectUri || oauthRedirectUri,
      clientId: pkce.clientId || oauthClientId,
    },
  });
  return result.token || result;
}

async function parseOauthCallbackToPreview() {
  try {
    const params = callbackParams($("oauthCallbackInput").value);
    let accessToken = params.get("access_token") || params.get("accessToken") || "";
    let idToken = params.get("id_token") || params.get("idToken") || "";
    let refreshToken = params.get("refresh_token") || params.get("refreshToken") || "";
    const code = params.get("code") || "";
    if (!accessToken && code) {
      const pkce = oauthPkce();
      const returnedState = params.get("state") || "";
      if (!pkce.verifier) throw new Error("授权链接已过期，请重新打开授权页面。");
      if (returnedState && pkce.state && returnedState !== pkce.state) throw new Error("授权状态不匹配，请重新打开授权页面。");
      const token = await exchangeOauthCode(code, pkce);
      accessToken = token.access_token || token.accessToken || "";
      idToken = token.id_token || token.idToken || "";
      refreshToken = token.refresh_token || token.refreshToken || "";
    }
    if (!accessToken && !idToken && !refreshToken) throw new Error("回调链接里没有 token。");
    const authJson = {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken || accessToken,
        access_token: accessToken || idToken,
        refresh_token: refreshToken || "",
        account_id: params.get("account_id") || params.get("accountId") || "",
      },
      last_refresh: new Date().toISOString(),
    };
    state.pendingImportItems = normalizePendingImportStatuses(buildPendingImportItems(parseImportEntries(JSON.stringify(authJson)), "OAuth 回调"));
    state.importCompleted = false;
    $("importResult").hidden = true;
    renderImportPreview();
  } catch (error) {
    state.pendingImportItems = [{
      id: crypto.randomUUID(),
      ok: false,
      status: "无法解析",
      sourceName: "OAuth 回调",
      accountName: "OAuth",
      error: error.message || "回调解析失败",
    }];
    state.importCompleted = false;
    renderImportPreview();
  }
}

async function parseImportFilesToPreview(fileList) {
  const files = importableJsonFiles(fileList);
  const items = [];
  if (!files.length) {
    state.pendingImportItems = [{
      id: crypto.randomUUID(),
      ok: false,
      status: "无法解析",
      sourceName: "文件",
      accountName: "未选择 JSON",
      error: "请选择 .json 文件。",
    }];
    state.importCompleted = false;
    renderImportPreview();
    return;
  }
  for (const file of files) {
    try {
      items.push(...buildPendingImportItems(parseImportEntries(await file.text()), file.name));
    } catch (error) {
      items.push({
        id: crypto.randomUUID(),
        ok: false,
        status: "无法解析",
        sourceName: file.name,
        accountName: file.name,
        error: error.message || "文件解析失败",
      });
    }
  }
  state.pendingImportItems = normalizePendingImportStatuses(items);
  state.importCompleted = false;
  $("importResult").hidden = true;
  renderImportPreview();
}

async function parseCommandFilesToPreview() {
  if (!state.commandFiles.length) {
    await smartSwitchBestAccount();
    return;
  }
  await parseImportFilesToPreview(state.commandFiles);
  setImportMode("file");
  clearCommandFiles();
  setDrawer(true);
}

function openProgress(title, items) {
  state.operationProgress = {
    active: true,
    done: false,
    title,
    summary: "正在处理...",
    items: items.map((item, index) => ({
      id: item.id || String(index),
      label: item.label || item.name || `#${index + 1}`,
      status: "等待",
      detail: "",
    })),
  };
  renderOperationProgress();
  openModal("progressModal");
}

function updateProgressItem(index, status, detail = "") {
  const item = state.operationProgress.items[index];
  if (!item) return;
  item.status = status;
  item.detail = detail;
  renderOperationProgress();
}

function finishProgress(summary) {
  state.operationProgress.active = false;
  state.operationProgress.done = true;
  state.operationProgress.summary = summary;
  renderOperationProgress();
}

function renderOperationProgress() {
  const progress = state.operationProgress;
  if (!$("progressTitle")) return;
  const total = progress.items.length;
  const completed = progress.items.filter((item) => item.status === "已完成").length;
  const failed = progress.items.filter((item) => item.status === "失败").length;
  const done = completed + failed;
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("progressTitle").textContent = progress.title || "正在处理";
  $("progressSummary").textContent = progress.done
    ? progress.summary
    : `${done}/${total} 已处理，失败 ${failed}`;
  $("progressMeterBar").style.width = `${percent}%`;
  $("progressCloseBtn").disabled = !progress.done;
  $("progressList").innerHTML = progress.items.map((item) => `
    <div class="progress-item ${item.status === "失败" ? "bad" : item.status === "已完成" ? "ok" : ""}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.status)}${item.detail ? ` · ${escapeHtml(item.detail)}` : ""}</span>
    </div>
  `).join("");
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function decodeJwtPayload(token) {
  if (!token || !token.includes(".")) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(decoder.decode(base64ToBytes(padded)));
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };
  if (options.body) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `请求失败：${response.status}`);
  }
  return result;
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function unixToIso(value) {
  const number = numeric(value);
  if (!Number.isFinite(number)) return "";
  return new Date(number * 1000).toISOString();
}

function canonicalPlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "chatgptplus") return "plus";
  if (["plus", "pro", "team", "enterprise", "free"].includes(plan)) return plan;
  return plan;
}

function planRank(value) {
  const plan = canonicalPlan(value);
  if (plan === "enterprise") return 5;
  if (plan === "team") return 4;
  if (plan === "pro") return 3;
  if (plan === "plus") return 2;
  if (plan === "free") return 1;
  return 0;
}

function bestPlan(...values) {
  let best = "";
  for (const value of values) {
    const plan = canonicalPlan(value);
    if (!plan) continue;
    if (!best || planRank(plan) > planRank(best)) best = plan;
  }
  return best;
}

function normalizeUsageWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const usedPercent = numeric(raw.used_percent ?? raw.usedPercent ?? raw.used);
  const remainingPercent = numeric(raw.remaining_percent ?? raw.remainingPercent);
  const resolvedUsed = Number.isFinite(usedPercent)
    ? usedPercent
    : Number.isFinite(remainingPercent) ? 100 - remainingPercent : NaN;
  const resolvedRemaining = Number.isFinite(remainingPercent)
    ? remainingPercent
    : Number.isFinite(resolvedUsed) ? 100 - resolvedUsed : NaN;
  return {
    used_percent: Number.isFinite(resolvedUsed) ? clampPercent(resolvedUsed) : null,
    remaining_percent: Number.isFinite(resolvedRemaining) ? clampPercent(resolvedRemaining) : null,
    window_seconds: numeric(raw.window_seconds ?? raw.windowSeconds ?? raw.limit_window_seconds ?? raw.limitWindowSeconds),
    reset_at: raw.reset_at ?? raw.resetAt ?? raw.resets_at ?? raw.resetsAt ?? null,
  };
}

function emptyUsage(planType = "") {
  return {
    fetched_at: null,
    refreshed_at: "",
    plan_type: planType || "",
    five_hour: null,
    one_week: null,
    credits: null,
    status: "未刷新",
    error: "",
  };
}

function normalizeUsage(raw, fallbackPlan = "") {
  if (!raw || typeof raw !== "object") return emptyUsage(fallbackPlan);
  const planType = bestPlan(raw.plan_type, raw.planType, fallbackPlan);
  const fetchedAt = raw.fetched_at ?? raw.fetchedAt ?? null;
  const refreshedAt = raw.refreshed_at || raw.refreshedAt || unixToIso(fetchedAt) || "";
  const error = explainError(raw.error || raw.message || "");
  return {
    fetched_at: fetchedAt,
    refreshed_at: refreshedAt,
    plan_type: planType,
    five_hour: normalizeUsageWindow(raw.five_hour || raw.fiveHour || raw.short_window || raw.shortWindow),
    one_week: normalizeUsageWindow(raw.one_week || raw.oneWeek || raw.long_window || raw.longWindow),
    credits: raw.credits || null,
    status: error ? "刷新失败" : (raw.status || (refreshedAt ? "已刷新" : "未刷新")),
    error,
  };
}

function newestUsage(a, b, fallbackPlan = "") {
  const aa = normalizeUsage(a, fallbackPlan);
  const bb = normalizeUsage(b, fallbackPlan);
  const at = new Date(aa.refreshed_at || aa.fetched_at || 0).getTime() || 0;
  const bt = new Date(bb.refreshed_at || bb.fetched_at || 0).getTime() || 0;
  const chosen = bt > at ? bb : aa;
  chosen.plan_type = bestPlan(aa.plan_type, bb.plan_type, fallbackPlan);
  return chosen;
}

function objectAt(source, key) {
  return source && typeof source[key] === "object" && source[key] !== null ? source[key] : null;
}

function pick(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      if (typeof source[key] === "object") continue;
      return source[key];
    }
  }
  return "";
}

function pickAny(sources, keys) {
  for (const source of sources) {
    const value = pick(source, keys);
    if (value) return value;
  }
  return "";
}

function hasTokenishFields(source) {
  if (!source || typeof source !== "object") return false;
  const direct = ["access_token", "accessToken", "refresh_token", "refreshToken", "id_token", "idToken", "session_token", "sessionToken"];
  if (direct.some((key) => source[key])) return true;
  return ["tokens", "token", "auth", "authorization", "session", "chatgpt_session", "authJson"].some((key) => {
    const value = source[key];
    return value && typeof value === "object" && direct.some((field) => value[field]);
  });
}

function normalizeImportSources(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["accounts", "sessions", "items", "data", "results", "list"]) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  if (parsed?.authJson && typeof parsed.authJson === "object") return [parsed.authJson];
  if (parsed && typeof parsed === "object" && !hasTokenishFields(parsed)) {
    const objectValues = Object.values(parsed).filter((value) => value && typeof value === "object" && hasTokenishFields(value));
    if (objectValues.length > 1) return objectValues;
  }
  return [parsed];
}

function extractAuthSource(source) {
  const tokens = objectAt(source, "tokens") || objectAt(source, "token") || {};
  const auth = objectAt(source, "auth") || objectAt(source, "authorization") || {};
  const session = objectAt(source, "session") || objectAt(source, "chatgpt_session") || {};
  const sessionTokens = objectAt(session, "tokens") || objectAt(session, "token") || {};
  const sessionProfile = objectAt(session, "profile") || {};
  const user = objectAt(source, "user") || objectAt(source, "account") || objectAt(source, "profile") || {};
  const subscription = objectAt(source, "subscription") || objectAt(source, "plan") || {};
  const sourceType = pick(source, ["type", "source", "provider", "format"]) || "";
  const kind = source.auth_mode === "chatgpt" && source.tokens
    ? "auth.json"
    : (/sub/i.test(sourceType) || source.sub2 || source.subscription_url ? "sub" : "cpa");

  return {
    kind,
    id_token: pickAny([source, tokens, auth, sessionTokens, session], ["id_token", "idToken"]),
    access_token: pickAny([source, tokens, auth, sessionTokens, session], ["access_token", "accessToken"]),
    refresh_token: pickAny([source, tokens, auth, sessionTokens, session], ["refresh_token", "refreshToken"]),
    session_token: pickAny([source, tokens, auth, sessionTokens, session], ["session_token", "sessionToken", "__Secure-next-auth.session-token", "token"]),
    account_id: pickAny([source, tokens, auth, sessionTokens, user], ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId", "id"]),
    email: pickAny([source, session, user], ["email", "mail"]),
    name: pickAny([source, user], ["name", "display_name", "displayName", "label"]),
    plan_type: pickAny([source, sessionProfile, subscription], ["plan_type", "planType", "plan"]) || pick(subscription, ["type"]),
    chatgpt_plan_type: pickAny([source, sessionProfile, subscription], ["chatgpt_plan_type", "chatgptPlanType", "name"]),
    expires: pickAny([source, session], ["expires", "expires_at", "expiresAt", "expired_at", "expiredAt"]),
    usage: source.usage_snapshot || source.usage || null,
  };
}

function parseSessionSource(source) {
  const extracted = extractAuthSource(source || {});
  const accessToken = extracted.access_token || "";
  const refreshToken = extracted.refresh_token || "";
  const idToken = extracted.id_token || "";
  const accessPayload = decodeJwtPayload(accessToken) || {};
  const idPayload = decodeJwtPayload(idToken) || {};
  const authPayload = accessPayload["https://api.openai.com/auth"] || idPayload["https://api.openai.com/auth"] || {};
  const profilePayload = accessPayload["https://api.openai.com/profile"] || idPayload["https://api.openai.com/profile"] || {};
  const accountId = extracted.account_id
    || authPayload.chatgpt_account_id
    || authPayload.chatgpt_account_user_id
    || "";
  const email = extracted.email || profilePayload.email || "";
  const expires = extracted.expires || jwtExpiryText(accessToken) || "";
  const plan = extracted.plan_type || extracted.chatgpt_plan_type || authPayload.chatgpt_plan_type || "";
  const usage = normalizeUsage(extracted.usage, plan);

  if (!accessToken) {
    throw new Error("没有识别到 access_token。请粘贴完整 session JSON 或 Codex auth.json。");
  }

  return {
    accountName: extracted.name || email || accountId || "",
    session: {
      sourceType: extracted.kind,
      email,
      expires,
      profile: { plan },
      usage,
      tokens: {
        id_token: idToken || accessToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
        session_token: extracted.session_token || "",
      },
    },
  };
}

function parseImportEntries(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const sources = normalizeImportSources(parsed);
  return sources.map((source, index) => {
    try {
      return {
        ok: true,
        sourceIndex: index,
        sourceName: source?.email || source?.name || `#${index + 1}`,
        ...parseSessionSource(source),
      };
    } catch (error) {
      return {
        ok: false,
        sourceIndex: index,
        sourceName: source?.email || source?.name || `#${index + 1}`,
        error: error.message || "解析失败",
      };
    }
  });
}

function parseSession(input) {
  const entries = parseImportEntries(input);
  const first = entries.find((entry) => entry.ok);
  if (!first) throw new Error(entries[0]?.error || "没有识别到可导入账号。");
  return first.session;
}

function jwtExpiryText(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return "";
  return new Date(payload.exp * 1000).toISOString();
}

function authFingerprint(session) {
  const tokens = session?.tokens || {};
  const access = tokens.access_token || "";
  const refresh = tokens.refresh_token || "";
  return [
    tokens.account_id || "",
    access.slice(0, 18),
    access.slice(-18),
    refresh.slice(0, 12),
    refresh.slice(-12),
  ].join("|");
}

function accountDedupeKey(account) {
  const accountId = account.accountId || account.account_id || account.session?.tokens?.account_id || "";
  if (accountId) return `account:${String(accountId).toLowerCase()}`;
  const email = account.email || account.session?.email || "";
  if (email) return `email:${String(email).toLowerCase()}`;
  const fingerprint = authFingerprint(account.session);
  if (fingerprint.replace(/\|/g, "")) return `token:${fingerprint}`;
  return `id:${account.id || crypto.randomUUID()}`;
}

function hasUsableRefreshToken(account) {
  if (account?.hasRefreshToken !== undefined) return Boolean(account.hasRefreshToken);
  const tokens = account?.session?.tokens || {};
  return Boolean(tokens.refresh_token && tokens.refresh_token !== tokens.access_token && tokens.refresh_token !== "rt_mock_token");
}

function accessTokenExpiry(account) {
  if (account?.expiresAt) {
    const date = new Date(account.expiresAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const payload = decodeJwtPayload(account?.session?.tokens?.access_token);
  return payload?.exp ? new Date(payload.exp * 1000) : null;
}

function accountPlan(account) {
  return bestPlan(account?.planType, account?.usage?.plan_type, account?.session?.profile?.plan) || "未知";
}

function normalizeLocalAccount(account) {
  const session = account.session || null;
  const tokens = session?.tokens || {};
  const accessPayload = decodeJwtPayload(tokens.access_token || "") || {};
  const idPayload = decodeJwtPayload(tokens.id_token || "") || {};
  const authPayload = accessPayload["https://api.openai.com/auth"] || idPayload["https://api.openai.com/auth"] || {};
  const profilePayload = accessPayload["https://api.openai.com/profile"] || idPayload["https://api.openai.com/profile"] || {};
  const accountId = account.accountId || account.account_id || tokens.account_id || authPayload.chatgpt_account_id || "";
  const email = account.email || session?.email || profilePayload.email || "";
  const plan = bestPlan(account.planType, account.plan_type, account.usage?.plan_type, session?.profile?.plan, authPayload.chatgpt_plan_type);
  const expiresAt = account.expiresAt || account.expires_at || session?.expires || (accessPayload.exp ? new Date(accessPayload.exp * 1000).toISOString() : "");
  return {
    id: account.id || crypto.randomUUID(),
    localId: account.localId || account.local_id || account.id || "",
    cloudId: account.cloudId || account.cloud_id || "",
    name: account.name || email || accountId || "Unnamed Account",
    email,
    group: account.group || account.groupName || account.group_name || "默认",
    priority: account.priority || "normal",
    usageNote: account.usageNote || account.usage_note || "",
    expiryNote: account.expiryNote || account.expiry_note || "",
    accountId,
    expiresAt,
    hasRefreshToken: account.hasRefreshToken ?? account.has_refresh_token ?? hasUsableRefreshToken({ session }),
    planType: plan,
    usage: normalizeUsage(account.usage || session?.usage, plan),
    session,
    cloudOnly: Boolean(account.cloudOnly || account.cloud_only) && !session,
    createdAt: account.createdAt || account.created_at || new Date().toISOString(),
    updatedAt: account.updatedAt || account.updated_at || new Date().toISOString(),
    lastSwitchAt: account.lastSwitchAt || account.last_switch_at || "",
  };
}

function normalizeCloudAccount(account) {
  const plan = bestPlan(account.planType, account.plan_type, account.usage?.plan_type);
  return {
    id: `cloud:${account.id}`,
    localId: "",
    cloudId: account.id,
    name: account.name || account.email || "Unnamed Account",
    email: account.email || "",
    group: account.group || account.groupName || account.group_name || "默认",
    priority: account.priority || "normal",
    usageNote: account.usageNote || account.usage_note || "",
    expiryNote: account.expiryNote || account.expiry_note || "",
    accountId: account.accountId || account.account_id || "",
    expiresAt: account.expiresAt || account.expires_at || "",
    hasRefreshToken: Boolean(account.hasRefreshToken ?? account.has_refresh_token),
    planType: plan,
    usage: normalizeUsage(account.usage || account.usage_snapshot, plan),
    session: null,
    cloudOnly: true,
    createdAt: account.createdAt || account.created_at || "",
    updatedAt: account.updatedAt || account.updated_at || "",
    lastSwitchAt: account.lastSwitchAt || account.last_switch_at || "",
  };
}

function mergeAccount(existing, incoming) {
  const plan = bestPlan(existing.planType, incoming.planType);
  const incomingHasSession = Boolean(incoming.session?.tokens?.access_token);
  const existingHasSession = Boolean(existing.session?.tokens?.access_token);
  const tokenChanged = incomingHasSession && existingHasSession && authFingerprint(existing.session) !== authFingerprint(incoming.session);
  const authorizationRefreshed = incomingHasSession && (tokenChanged || !existingHasSession || usageIssue(existing));
  const nextSession = incoming.session || existing.session || null;
  if (nextSession && existing.session && !authorizationRefreshed && !hasUsableRefreshToken({ session: nextSession }) && hasUsableRefreshToken(existing)) {
    nextSession.tokens.refresh_token = existing.session.tokens.refresh_token;
  }
  const nextUsage = authorizationRefreshed
    ? normalizeUsage(incoming.usage, plan)
    : newestUsage(existing.usage, incoming.usage, plan);
  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    localId: existing.localId || incoming.localId || existing.id || "",
    cloudId: incoming.cloudId || existing.cloudId || "",
    planType: plan,
    usage: nextUsage,
    session: nextSession,
    hasRefreshToken: Boolean((authorizationRefreshed ? incoming.hasRefreshToken : (existing.hasRefreshToken || incoming.hasRefreshToken)) || hasUsableRefreshToken({ session: nextSession })),
    cloudOnly: Boolean((incoming.cloudOnly && !nextSession) || (existing.cloudOnly && !nextSession)),
    updatedAt: new Date().toISOString(),
  };
}

function rebuildAccounts() {
  if (!state.authResolved) {
    state.accounts = [];
    state.selectedBulkIds.clear();
    return;
  }
  if (state.user) {
    state.accounts = state.cloudAccounts.map((account) => ({
      ...account,
      source: "cloud",
      hasLocalSecret: false,
      hasCloudSecret: true,
    })).sort((a, b) => {
      const priority = { primary: 0, normal: 1, reserve: 2 };
      return (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1)
        || (new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    });
    if (!state.accounts.some((account) => account.id === state.selectedId)) {
      state.selectedId = state.accounts[0]?.id || null;
    }
    const validIds = new Set(state.accounts.map((account) => account.id));
    state.selectedBulkIds = new Set([...state.selectedBulkIds].filter((id) => validIds.has(id)));
    return;
  }
  const remainingClouds = [...state.cloudAccounts];
  const visible = [];
  for (const local of state.localAccounts) {
    const cloudIndex = findAccountIndexByIdentity(remainingClouds, local);
    const cloud = cloudIndex >= 0 ? remainingClouds[cloudIndex] : null;
    const merged = cloud ? mergeAccount(local, cloud) : local;
    merged.source = cloud ? "local+cloud" : "local";
    merged.hasLocalSecret = Boolean(merged.session?.tokens?.access_token);
    merged.hasCloudSecret = Boolean(merged.cloudId);
    visible.push(merged);
    if (cloudIndex >= 0) remainingClouds.splice(cloudIndex, 1);
  }
  for (const cloud of remainingClouds) {
    cloud.source = "cloud";
    cloud.hasLocalSecret = false;
    cloud.hasCloudSecret = true;
    visible.push(cloud);
  }
  state.accounts = visible.sort((a, b) => {
    const priority = { primary: 0, normal: 1, reserve: 2 };
    return (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1)
      || (new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  });
  if (!state.accounts.some((account) => account.id === state.selectedId)) {
    state.selectedId = state.accounts[0]?.id || null;
  }
  const validIds = new Set(state.accounts.map((account) => account.id));
  state.selectedBulkIds = new Set([...state.selectedBulkIds].filter((id) => validIds.has(id)));
}

function loadLocalStore() {
  let raw = localStorage.getItem(localStoreKey);
  let migrated = false;
  if (!raw) {
    raw = localStorage.getItem(previousStoreKey);
    migrated = Boolean(raw);
  }
  if (!raw) {
    raw = localStorage.getItem(legacyStoreKey);
    migrated = Boolean(raw);
  }
  if (!raw) {
    state.localAccounts = [];
    state.syncChoices = {};
    return;
  }
  try {
    const store = JSON.parse(raw);
    state.localAccounts = (store.accounts || []).map(normalizeLocalAccount);
    state.syncChoices = store.syncChoices || {};
    state.selectedId = store.selectedId || state.selectedId;
    state.accountLayout = store.accountLayout === "cards" ? "cards" : "list";
    state.accountFilters = { ...defaultAccountFilters, ...(store.accountFilters || {}) };
    state.accountSort = store.accountSort || "updated";
    state.smartSwitchSettings = { ...defaultSmartSwitchSettings, ...(store.smartSwitchSettings || {}) };
    state.autoSwitchSettings = { ...defaultAutoSwitchSettings, ...(store.autoSwitchSettings || {}) };
    state.selectedBulkIds = new Set(Array.isArray(store.selectedBulkIds) ? store.selectedBulkIds : []);
    if (migrated) {
      saveLocalStore();
      toast("已自动迁移旧本地账号池。");
    }
  } catch {
    state.localAccounts = [];
    state.syncChoices = {};
  }
}

function accountForStorage(account) {
  return {
    id: account.id,
    cloudId: account.cloudId || "",
    name: account.name,
    email: account.email || "",
    group: account.group || "默认",
    priority: account.priority || "normal",
    usageNote: account.usageNote || "",
    expiryNote: account.expiryNote || "",
    accountId: account.accountId || "",
    expiresAt: account.expiresAt || "",
    hasRefreshToken: Boolean(account.hasRefreshToken),
    planType: account.planType || "",
    usage: account.usage || null,
    session: account.session || null,
    cloudOnly: Boolean(account.cloudOnly && !account.session),
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: account.updatedAt || new Date().toISOString(),
    lastSwitchAt: account.lastSwitchAt || "",
  };
}

function saveLocalStore() {
  localStorage.setItem(localStoreKey, JSON.stringify({
    version: 5,
    savedAt: new Date().toISOString(),
    selectedId: state.selectedId,
    syncChoices: state.syncChoices,
    accountLayout: state.accountLayout,
    accountFilters: state.accountFilters,
    accountSort: state.accountSort,
    smartSwitchSettings: state.smartSwitchSettings,
    autoSwitchSettings: state.autoSwitchSettings,
    selectedBulkIds: [...state.selectedBulkIds],
    accounts: state.localAccounts.map(accountForStorage),
  }));
}

function syncMode() {
  return state.user ? state.syncChoices[state.user.id]?.mode || "merge" : "";
}

function setSyncMode(mode) {
  if (!state.user) return;
  state.syncChoices[state.user.id] = { mode, updatedAt: new Date().toISOString() };
  saveLocalStore();
}

function cloudBackupEnabled() {
  return Boolean(state.user && syncMode() !== "local-only");
}

function selectedAccount() {
  return state.accounts.find((account) => account.id === state.selectedId) || null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function shortId(value) {
  if (!value) return "未识别";
  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatTime(value) {
  if (!value) return "无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRefreshTime(value) {
  if (!value) return "未刷新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatResetTime(value) {
  if (!value) return "重置未知";
  const number = numeric(value);
  const date = Number.isFinite(number) && number > 1000000000 ? new Date(number * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "重置未知";
  return `重置 ${date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function planLabel(plan) {
  const value = String(plan || "未知").toLowerCase();
  if (value === "plus") return "Plus";
  if (value === "pro") return "Pro";
  if (value === "team") return "Team";
  if (value === "enterprise") return "Enterprise";
  if (value === "free") return "Free";
  return plan || "未知";
}

function planClass(plan) {
  const value = canonicalPlan(plan);
  return value ? `plan-${value}` : "plan-unknown";
}

function formatTokenTime(date) {
  if (!date || Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function explainError(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (
    text.includes("封") ||
    text.includes("停用") ||
    text.includes("账号已被禁用") ||
    lower.includes("account_deactivated") ||
    lower.includes("user_deactivated") ||
    lower.includes("organization_deactivated") ||
    lower.includes("account_disabled") ||
    lower.includes("disabled account") ||
    lower.includes("suspended") ||
    lower.includes("banned")
  ) {
    return "账号不可用，请检查是否被停用";
  }
  if (/\b401\b/.test(text) || lower.includes("authentication token has been invalidated") || lower.includes("unauthorized")) {
    return "Token 已失效，请重新登录";
  }
  if (/\b403\b/.test(text) || lower.includes("forbidden")) {
    return "无权限访问，请检查账号状态";
  }
  if (/\b429\b/.test(text) || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "请求过于频繁，稍后再试";
  }
  if (/\b5\d\d\b/.test(text)) {
    return "服务暂时不可用，稍后重试";
  }
  if (lower.includes("abort") || text.includes("请求被中止") || text.includes("连接被意外关闭")) {
    return "请求中断，请重试";
  }
  if (lower.includes("network") || lower.includes("fetch failed") || text.includes("网络")) {
    return "网络连接失败";
  }
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function errorSeverity(label) {
  const text = String(label || "").toLowerCase();
  if (!text) return "neutral";
  if (
    text.includes("封") ||
    text.includes("停用") ||
    text.includes("账号已被禁用") ||
    text.includes("账号不可用") ||
    text.includes("banned") ||
    text.includes("suspended") ||
    text.includes("deactivated") ||
    text.includes("disabled account")
  ) {
    return "bad";
  }
  return "warn";
}

function usageIssue(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  if (!usage.error) return null;
  const label = explainError(usage.error);
  return {
    label,
    className: errorSeverity(label),
  };
}

function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function tokenState(account) {
  if (!account) return { label: "未选择", className: "warn", score: 0, detail: "" };
  if (!account.session && !account.cloudId) {
    return { label: "无本地 token", className: "warn", score: 10, detail: "本地没有可用于切换的 auth/session 原文。" };
  }
  const expiry = accessTokenExpiry(account);
  const hasRt = hasUsableRefreshToken(account);
  const kind = hasRt ? "RT" : "AT";
  if (!expiry) {
    return hasRt
      ? { label: "RT", className: "ok", score: 70, detail: "RT" }
      : { label: "AT", className: "ok", score: 35, detail: "AT" };
  }
  const left = expiry.getTime() - Date.now();
  if (left <= 0) {
    return hasRt
      ? { label: `RT · ${formatTokenTime(expiry)}`, className: "warn", score: 45, detail: `RT · ${expiry.toLocaleString()}` }
      : { label: `AT · ${formatTokenTime(expiry)}`, className: "warn", score: 5, detail: `AT · ${expiry.toLocaleString()}` };
  }
  return {
    label: `${kind} · ${formatTokenTime(expiry)}`,
    className: "ok",
    score: hasRt ? 95 : 58,
    detail: `${kind} · ${expiry.toLocaleString()}`,
  };
}

function usagePenalty(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  const fiveHourUsed = usage.five_hour?.used_percent;
  const oneWeekUsed = usage.one_week?.used_percent;
  let penalty = 0;
  if (Number.isFinite(fiveHourUsed)) penalty += Math.max(0, fiveHourUsed - 80) * 0.7;
  if (Number.isFinite(oneWeekUsed)) penalty += Math.max(0, oneWeekUsed - 90) * 0.5;
  return penalty;
}

function accountScore(account) {
  const settings = state.smartSwitchSettings || defaultSmartSwitchSettings;
  if (!canUseAccount(account)) return -9999;
  if (settings.paidOnly && !isPaidPlan(account)) return -9000;
  if (!settings.allowAt && !hasUsableRefreshToken(account)) return -8500;
  if (settings.avoidCurrent && isCurrentAccount(account)) return -8000;
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  if (settings.avoidLow5h && Number.isFinite(usage.five_hour?.remaining_percent) && usage.five_hour.remaining_percent <= 30) return -7000;
  if (settings.avoidLow7d && Number.isFinite(usage.one_week?.remaining_percent) && usage.one_week.remaining_percent <= 30) return -7000;
  const cooldown = Number(settings.cooldownMinutes || 0);
  if (cooldown && account.lastSwitchAt && Date.now() - new Date(account.lastSwitchAt).getTime() < cooldown * 60 * 1000) return -6500;
  const priorityBoost = account.priority === "primary" ? 12 : account.priority === "reserve" ? -12 : 0;
  const rtBoost = settings.preferRt && hasUsableRefreshToken(account) ? 12 : 0;
  const paidBoost = isPaidPlan(account) ? 8 : 0;
  return tokenState(account).score + priorityBoost + rtBoost + paidBoost - usagePenalty(account);
}

function bestAccount() {
  return [...state.accounts].filter((account) => !isInvalidAccount(account) && accountScore(account) > -6000).sort((a, b) => accountScore(b) - accountScore(a))[0] || null;
}

function smartSwitchReasons(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  const reasons = [];
  if (isPaidPlan(account)) reasons.push(planLabel(accountPlan(account)));
  reasons.push(hasUsableRefreshToken(account) ? "RT" : "AT");
  if (Number.isFinite(usage.five_hour?.remaining_percent)) reasons.push(`5H ${usage.five_hour.remaining_percent}%`);
  if (Number.isFinite(usage.one_week?.remaining_percent)) reasons.push(`7D ${usage.one_week.remaining_percent}%`);
  if (account.priority === "primary") reasons.push("优先使用");
  if (!account.lastSwitchAt) reasons.push("最近未切换");
  return reasons.join("、");
}

function canUseAccount(account) {
  return Boolean(account && (account.session?.tokens?.access_token || (state.user && account.cloudId)));
}

function isPaidPlan(account) {
  return ["plus", "pro", "team", "enterprise"].includes(String(accountPlan(account)).toLowerCase());
}

function accountMinRemaining(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  const values = [usage.five_hour?.remaining_percent, usage.one_week?.remaining_percent].filter(Number.isFinite);
  return values.length ? Math.min(...values) : -1;
}

function isExpiredWithoutRt(account) {
  const expiry = accessTokenExpiry(account);
  return Boolean(expiry && expiry.getTime() <= Date.now() && !hasUsableRefreshToken(account));
}

function isInvalidAccount(account) {
  if (!canUseAccount(account)) return true;
  if (isExpiredWithoutRt(account)) return true;
  if (usageIssue(account)) return true;
  return false;
}

function tokenFilterValue(account) {
  if (!canUseAccount(account)) return "missing";
  if (isExpiredWithoutRt(account)) return "expired";
  const expiry = accessTokenExpiry(account);
  if (expiry && expiry.getTime() - Date.now() < 24 * 60 * 60 * 1000) return "soon";
  return hasUsableRefreshToken(account) ? "rt" : "at";
}

function usageFilterValue(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  if (usageIssue(account)) return "failed";
  if (!usage?.refreshed_at) return "unrefreshed";
  if (Number.isFinite(usage.five_hour?.remaining_percent) && usage.five_hour.remaining_percent <= 30) return "low5h";
  if (Number.isFinite(usage.one_week?.remaining_percent) && usage.one_week.remaining_percent <= 30) return "low7d";
  return "ready";
}

function accountActionMode(account) {
  if (!canUseAccount(account)) return "unavailable";
  if (isExpiredWithoutRt(account) || usageIssue(account)) return "unavailable";
  return state.helperReady ? "direct-switch" : "download-auth";
}

function accountStatusValue(account) {
  if (isInvalidAccount(account)) return "attention";
  if (isCurrentAccount(account)) return "current";
  const actionMode = accountActionMode(account);
  if (actionMode === "direct-switch") return "direct";
  if (actionMode === "download-auth") return "download";
  return "attention";
}

function accountMatchesFilters(account) {
  const filters = state.accountFilters || defaultAccountFilters;
  const plan = String(accountPlan(account)).toLowerCase();
  if (filters.plan === "paid" && !isPaidPlan(account)) return false;
  if (filters.plan === "plus" && plan !== "plus") return false;
  if (filters.plan === "free" && plan !== "free") return false;
  if (filters.plan === "pro-team" && !["pro", "team", "enterprise"].includes(plan)) return false;
  if (filters.plan === "unknown" && plan !== "未知".toLowerCase() && plan !== "unknown" && plan) return false;
  if (filters.token !== "all" && tokenFilterValue(account) !== filters.token) return false;
  if (filters.usage !== "all" && usageFilterValue(account) !== filters.usage) return false;
  if (filters.status !== "all" && accountStatusValue(account) !== filters.status) return false;
  if (state.accountFilter === "paid" && !isPaidPlan(account)) return false;
  if (state.accountFilter === "attention" && !isInvalidAccount(account)) return false;
  return true;
}

function sortAccounts(accounts) {
  const sort = state.accountSort || "updated";
  return [...accounts].sort((a, b) => {
    if (sort === "name") return String(a.name || a.email).localeCompare(String(b.name || b.email));
    if (sort === "last-switch") return new Date(b.lastSwitchAt || 0).getTime() - new Date(a.lastSwitchAt || 0).getTime();
    if (sort === "quota") return accountMinRemaining(b) - accountMinRemaining(a);
    if (sort === "token-expiry") {
      const ax = accessTokenExpiry(a)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bx = accessTokenExpiry(b)?.getTime() || Number.MAX_SAFE_INTEGER;
      return ax - bx;
    }
    if (sort === "created") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

function visibleAccounts() {
  const query = state.accountSearch.trim().toLowerCase();
  return sortAccounts(state.accounts.filter((account) => accountMatchesFilters(account)).filter((account) => accountMatchesSearch(account, query)));
}

function helperDisplayBase() {
  if (!state.helperReady) return "未连接";
  return state.helperBase || "本机";
}

function render() {
  rebuildAccounts();
  renderShell();
  renderMetrics();
  renderAccounts();
  renderSelected();
  renderAudit();
  renderDevice();
  renderSecurity();
  renderSettings();
  renderAdmin();
  renderImportPreview();
  renderOperationProgress();
}

function switchView(view) {
  if (view === "admin" && state.user?.role !== "admin") return;
  state.currentView = view;
  document.querySelectorAll(".view").forEach((el) => {
    const active = el.id === `${view}View`;
    el.hidden = !active;
    el.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  const titles = {
    accounts: ["账号池", ""],
    helper: ["Dock Helper", "安装后即可自动写入 auth 并重启 Codex。"],
    admin: ["管理", "查看用户、设备和最近操作。"],
  };
  $("viewTitle").textContent = titles[view]?.[0] || "账号池";
  $("viewSubtitle").textContent = titles[view]?.[1] || "";
  if (view === "admin") loadAdminData();
}

function renderShell() {
  const total = state.accounts.length;
  const localSecretCount = state.accounts.filter((account) => account.hasLocalSecret).length;
  const cloudCount = state.cloudAccounts.length;
  const cloudText = state.user ? `${state.user.email}${cloudBackupEnabled() ? " · 已同步" : ""}` : "未登录";
  const helperText = state.helperReady ? "Helper 在线" : "Helper 未连接";
  const codexStatus = state.codexStatus || {};
  const codexLabel = state.helperReady
    ? (codexStatus.label || "状态确认中")
    : "Codex 未探测";
  const codexClass = codexStatus.state === "idle"
    ? "ready"
    : ["active", "waiting", "cooling"].includes(codexStatus.state) ? "warn"
      : codexStatus.state === "not_running" ? ""
        : "warn";
  const subtitles = {
    accounts: "",
    helper: "安装后即可自动写入 auth 并重启 Codex。",
    admin: "查看用户、设备和最近操作。",
  };
  $("viewSubtitle").textContent = subtitles[state.currentView] || "";
  if ($("homeHeadline")) {
    $("homeHeadline").textContent = !state.authResolved ? "正在加载账号池" : (total ? "选择一个账号，或交给智能切换" : "导入账号后开始切换");
  }
  if ($("homeSubcopy")) {
    $("homeSubcopy").textContent = !state.authResolved ? "正在确认登录状态。" : (state.user ? "已开启多设备账号池。" : "登录后可在多台设备同步账号池。");
  }
  $("vaultTitle").textContent = !state.authResolved ? "账号池" : `${state.user ? "账号池" : "本地账号池"} · ${total} 个账号`;
  $("vaultCopy").textContent = "";
  $("sideCloudStatus").textContent = cloudText;
  $("sideCloudStatus").className = state.user ? "ready" : "";
  $("sideHelperStatus").textContent = helperText;
  $("sideHelperStatus").className = state.helperReady ? "ready" : "warn";
  $("syncPill").innerHTML = `<span class="status-dot ${state.user ? "ok" : ""}"></span>${escapeHtml(state.user ? (cloudBackupEnabled() ? "已同步" : "已登录") : "本地")}`;
  $("syncPill").className = `status-pill ${state.user ? "ready" : ""}`;
  const autoEnabled = Boolean(state.autoSwitchSettings?.enabled);
  const autoAuthorized = Boolean(state.autoSwitchStatus?.helperAuthorized || state.helperInfo?.auto_switch?.authorized);
  const autoRuntimeLabel = codexStatus.state === "idle"
    ? "自动切换已开启 · 当前空闲"
    : codexStatus.state === "active" ? "自动切换已开启 · 等待任务结束"
      : codexStatus.state === "cooling" ? "自动切换已开启 · 等待稳定空闲"
        : codexStatus.state === "unknown" ? "检测未知，已暂停自动切换"
          : codexStatus.state === "not_running" ? "Codex 未运行，自动切换暂停"
            : "自动切换已开启";
  const autoLabel = !state.user
    ? "自动切换需登录"
    : !autoEnabled ? "自动切换未开启"
      : !state.helperReady ? "自动切换待 Helper"
        : !autoAuthorized ? "自动切换待授权"
          : autoRuntimeLabel;
  const autoClass = autoEnabled && autoAuthorized && state.helperReady && codexStatus.state === "idle"
    ? "ready"
    : autoEnabled ? "warn" : "";
  $("autoSwitchPill").innerHTML = `<span class="status-dot ${autoClass === "ready" ? "ok" : autoClass === "warn" ? "warn" : ""}"></span>${escapeHtml(autoLabel)}`;
  $("autoSwitchPill").className = `status-pill ${autoClass}`;
  const helperLabel = state.currentAuthChecking ? "确认 auth" : (state.helperReady ? "Helper 在线" : "Helper 离线");
  $("codexPill").innerHTML = `<span class="status-dot ${codexClass === "ready" ? "ok" : codexClass === "warn" ? "warn" : ""}"></span>${escapeHtml(codexLabel)}`;
  $("codexPill").className = `status-pill ${codexClass}`;
  $("helperPill").innerHTML = `<span class="status-dot ${state.helperReady ? "ok" : "warn"}"></span>${escapeHtml(helperLabel)}`;
  $("helperPill").className = `status-pill ${state.helperReady ? "ready" : "warn"}`;
  $("userMenuBtn").textContent = state.user ? state.user.email : "登录以同步";
  $("sidebarLoginBtn").textContent = state.user ? "账号设置" : "登录以同步";
  $("sidebarSyncCard").querySelector("strong").textContent = state.user ? "已登录" : "快速切换";
  $("sidebarSyncCard").querySelector("span").textContent = state.user
    ? (cloudBackupEnabled() ? "账号池会自动同步。" : "可在设置里开启同步。")
    : "安装 Helper 后可一键切换。";
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.hidden = state.user?.role !== "admin";
  });
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  $("collapseSidebarBtn").setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  $("collapseSidebarBtn").setAttribute("aria-label", state.sidebarCollapsed ? "展开侧边栏" : "隐藏侧边栏");
  $("refreshAllUsageBtn").disabled = !state.helperReady || !state.accounts.some(canUseAccount) || state.refreshingUsage;
  $("importLocalAuthBtn").disabled = !state.helperReady;
  renderShellState();
}

function renderMetrics() {
  const total = state.accounts.length;
  const plusLike = state.accounts.filter((account) => ["plus", "pro", "team", "enterprise"].includes(String(accountPlan(account)).toLowerCase())).length;
  const usageReady = state.accounts.filter((account) => account.usage?.refreshed_at && !account.usage?.error).length;
  const attention = state.accounts.filter((account) => ["warn", "bad"].includes(tokenState(account).className)).length;
  const current = resolveCurrentAccountId() ? 1 : 0;
  $("metricsGrid").innerHTML = [
    ["账号总数", total],
    ["付费等级", plusLike],
    ["额度已刷新", usageReady],
    ["需处理账号", attention],
    ["当前选择", current],
  ].map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function sourceLabel(account) {
  if (account.hasLocalSecret && account.hasCloudSecret) return "本地 + 云端";
  if (account.hasCloudSecret) return "云端";
  if (account.hasLocalSecret) return "本地";
  return "无 token";
}

function accountFingerprint(account) {
  return authFingerprint(account?.session);
}

function currentAccountIdValue(account) {
  return String(account?.accountId || account?.account_id || account?.session?.tokens?.account_id || "").trim().toLowerCase();
}

function currentEmailValue(account) {
  return String(account?.email || account?.session?.email || "").trim().toLowerCase();
}

function pickCurrentCandidate(candidates) {
  return [...candidates].sort((a, b) => {
    const selectedScore = (b.id === state.selectedId ? 1 : 0) - (a.id === state.selectedId ? 1 : 0);
    if (selectedScore) return selectedScore;
    const localScore = (b.hasLocalSecret ? 1 : 0) - (a.hasLocalSecret ? 1 : 0);
    if (localScore) return localScore;
    const priorityScore = (b.priority === "primary" ? 1 : 0) - (a.priority === "primary" ? 1 : 0);
    if (priorityScore) return priorityScore;
    return new Date(b.lastSwitchAt || b.updatedAt || 0).getTime() - new Date(a.lastSwitchAt || a.updatedAt || 0).getTime();
  })[0] || null;
}

function resolveCurrentAccountId() {
  if (state.currentAuthChecking || !state.accounts.length) return "";
  const current = state.currentAuthAccount || {};
  const currentAccountId = currentAccountIdValue(current);
  if (currentAccountId) {
    const match = pickCurrentCandidate(state.accounts.filter((account) => currentAccountIdValue(account) === currentAccountId));
    if (match) return match.id;
  }

  const currentFingerprint = state.localAuthFingerprint || accountFingerprint(current);
  if (currentFingerprint && currentFingerprint.replace(/\|/g, "")) {
    const match = pickCurrentCandidate(state.accounts.filter((account) => accountFingerprint(account) === currentFingerprint));
    if (match) return match.id;
  }

  const currentEmail = currentEmailValue(current);
  if (currentEmail) {
    const match = pickCurrentCandidate(state.accounts.filter((account) => currentEmailValue(account) === currentEmail));
    if (match) return match.id;
  }

  if (state.currentAuthKey) {
    const match = pickCurrentCandidate(state.accounts.filter((account) => accountDedupeKey(account) === state.currentAuthKey));
    if (match) return match.id;
  }
  return "";
}

function isCurrentAccount(account) {
  return Boolean(account && account.id === resolveCurrentAccountId());
}

function accountInitial(account) {
  const seed = account.name || account.email || account.accountId || "?";
  return seed.trim().slice(0, 1).toUpperCase() || "?";
}

function priorityLabel(value) {
  if (value === "primary") return "优先使用";
  if (value === "reserve") return "尽量少用";
  return "正常使用";
}

function quotaMini(window, label, usage = null) {
  const issueLabel = usage?.error ? explainError(usage.error) : "";
  const issue = issueLabel ? { label: issueLabel, className: errorSeverity(issueLabel) } : null;
  if (!window) {
    return `
      <div class="quota-mini empty ${issue?.className || ""}" ${issue ? `title="${escapeHtml(issue.label)}"` : ""}>
        <div class="quota-mini-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(issue ? "不可用" : "未刷新")}</strong></div>
        <div class="mini-bar"><i style="width:0%"></i></div>
      </div>
    `;
  }
  const remaining = Number.isFinite(window.remaining_percent) ? window.remaining_percent : null;
  const used = Number.isFinite(window.used_percent) ? window.used_percent : (remaining === null ? null : 100 - remaining);
  const percent = remaining === null ? Math.max(0, 100 - (used || 0)) : remaining;
  const className = percent <= 10 ? "bad" : percent <= 30 ? "warn" : "";
  return `
    <div class="quota-mini ${className}">
      <div class="quota-mini-head"><span>${escapeHtml(label)}</span><strong>${percent}%</strong></div>
      <div class="mini-bar"><i style="width:${percent}%"></i></div>
    </div>
  `;
}

function accountMatchesSearch(account, query) {
  if (!query) return true;
  const haystack = [
    account.name,
    account.email,
    account.group,
    account.accountId,
    account.usageNote,
    account.expiryNote,
    accountPlan(account),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function renderAccounts() {
  const filtered = visibleAccounts();
  renderToolbarState(filtered);
  $("accountGrid").className = `${state.accountLayout === "cards" ? "account-card-grid" : "account-list chat-list"} ${state.selectedBulkIds.size ? "bulk-mode" : ""}`;
  if (!state.authResolved) {
    $("accountGrid").innerHTML = `
      <div class="empty">
        <strong>正在加载账号池</strong>
        <span>正在确认登录状态，登录后将直接显示云端账号。</span>
      </div>
    `;
    return;
  }
  if (!filtered.length) {
    $("accountGrid").innerHTML = `
      <div class="empty">
        <strong>${state.accounts.length ? "没有匹配账号" : "还没有账号"}</strong>
        <span>${state.accounts.length ? "换个关键词或调整筛选。" : "导入 auth.json 后开始管理账号。"}</span>
      </div>
    `;
    return;
  }
  const currentId = resolveCurrentAccountId();
  const renderAction = (account, current) => {
    const mode = accountActionMode(account);
    const label = mode === "direct-switch" ? (current ? "重启" : "切换") : (mode === "download-auth" ? "下载 auth" : "不可用");
    return `<button class="primary" data-account-action="switch" data-id="${escapeHtml(account.id)}" ${mode === "unavailable" ? "disabled" : ""}>${label}</button>`;
  };
  const renderMeta = (account) => {
    const subItems = [account.email || account.accountId || "未识别邮箱", state.user ? "" : sourceLabel(account)].filter(Boolean);
    return subItems.map((item, index) => `${index ? "<span>·</span>" : ""}<span>${escapeHtml(item)}</span>`).join("");
  };
  const renderRow = (account) => {
    const token = tokenState(account);
    const issue = usageIssue(account);
    const plan = accountPlan(account);
    const current = account.id === currentId;
    const selected = state.selectedBulkIds.has(account.id);
    return `
      <div class="account-row ${account.id === state.selectedId ? "active" : ""} ${current ? "current" : ""}" data-id="${escapeHtml(account.id)}" role="button" tabindex="0">
        <label class="bulk-check" title="选择账号"><input type="checkbox" data-bulk-id="${escapeHtml(account.id)}" ${selected ? "checked" : ""} /></label>
        <div class="account-symbol">${escapeHtml(accountInitial(account))}</div>
        <div class="account-row-main">
          <div class="account-row-title">
            <strong>${escapeHtml(account.name)}</strong>
            ${current ? '<span class="current-chip">正在使用</span>' : ""}
            <span class="plan-chip ${planClass(plan)}">${escapeHtml(planLabel(plan))}</span>
          </div>
          <div class="account-row-sub">${renderMeta(account)}</div>
          <div class="account-row-status ${issue?.className || token.className}">
            <span class="status-dot ${issue?.className || token.className}"></span>
            <span>${escapeHtml(issue?.label || token.label)}</span>
            <span>·</span>
            <span>${escapeHtml(formatRefreshTime(account.usage?.refreshed_at))}</span>
          </div>
        </div>
        <div class="account-row-quota">
          ${quotaMini(account.usage?.five_hour, "5H", account.usage)}
          ${quotaMini(account.usage?.one_week, "7D", account.usage)}
        </div>
        <div class="account-row-actions">
          <button class="icon-action" data-account-action="refresh-usage" data-id="${escapeHtml(account.id)}" ${state.helperReady ? "" : "disabled"} title="刷新额度" aria-label="刷新额度">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M18.2 9A7 7 0 0 0 6.4 6.8L4 12"></path><path d="M5.8 15A7 7 0 0 0 17.6 17.2L20 12"></path></svg>
          </button>
          ${renderAction(account, current)}
          <button class="subtle-danger" data-account-action="delete" data-id="${escapeHtml(account.id)}" title="删除账号">删除</button>
        </div>
      </div>
    `;
  };
  const renderCard = (account) => {
    const token = tokenState(account);
    const issue = usageIssue(account);
    const plan = accountPlan(account);
    const current = account.id === currentId;
    const selected = state.selectedBulkIds.has(account.id);
    return `
      <div class="account-card ${account.id === state.selectedId ? "active" : ""} ${current ? "current" : ""}" data-id="${escapeHtml(account.id)}" role="button" tabindex="0">
        <div class="account-card-top">
          <label class="bulk-check" title="选择账号"><input type="checkbox" data-bulk-id="${escapeHtml(account.id)}" ${selected ? "checked" : ""} /></label>
          <div class="account-symbol">${escapeHtml(accountInitial(account))}</div>
          <div class="account-card-identity">
            <strong>${escapeHtml(account.name)}</strong>
            <span>${escapeHtml(account.email || shortId(account.accountId))}</span>
          </div>
          <div class="account-card-badges">
            ${current ? '<span class="current-chip">正在使用</span>' : ""}
            <span class="plan-chip ${planClass(plan)}">${escapeHtml(planLabel(plan))}</span>
          </div>
        </div>
        <div class="account-row-status ${issue?.className || token.className}">
          <span class="status-dot ${issue?.className || token.className}"></span>
          <span>${escapeHtml(issue?.label || token.label)}</span>
          <span>·</span>
          <span>${escapeHtml(formatRefreshTime(account.usage?.refreshed_at))}</span>
        </div>
        <div class="account-card-quota">
          ${quotaMini(account.usage?.five_hour, "5H", account.usage)}
          ${quotaMini(account.usage?.one_week, "7D", account.usage)}
        </div>
        <div class="account-row-actions">
          <button class="icon-action" data-account-action="refresh-usage" data-id="${escapeHtml(account.id)}" ${state.helperReady ? "" : "disabled"} title="刷新额度" aria-label="刷新额度">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M18.2 9A7 7 0 0 0 6.4 6.8L4 12"></path><path d="M5.8 15A7 7 0 0 0 17.6 17.2L20 12"></path></svg>
          </button>
          ${renderAction(account, current)}
          <button class="subtle-danger" data-account-action="delete" data-id="${escapeHtml(account.id)}" title="删除账号">删除</button>
        </div>
      </div>
    `;
  };
  $("accountGrid").innerHTML = filtered.map((account) => state.accountLayout === "cards" ? renderCard(account) : renderRow(account)).join("");
}

function quotaCell(window, label, usage = null) {
  const issue = usage?.error ? explainError(usage.error) : "";
  const issueClass = issue ? errorSeverity(issue) : "";
  if (!window) {
    return `
      <div class="quota-cell empty-quota ${issueClass}" ${issue ? `title="${escapeHtml(issue)}"` : ""}>
        <strong>${escapeHtml(issue ? "不可用" : "未刷新")}</strong>
        <span>${label}</span>
        <div class="quota-bar"><i style="width:0%"></i></div>
      </div>
    `;
  }
  const remaining = Number.isFinite(window.remaining_percent) ? window.remaining_percent : null;
  const used = Number.isFinite(window.used_percent) ? window.used_percent : (remaining === null ? null : 100 - remaining);
  const percent = remaining === null ? Math.max(0, 100 - (used || 0)) : remaining;
  const className = percent <= 10 ? "bad" : percent <= 30 ? "warn" : "";
  return `
    <div class="quota-cell ${className}">
      <strong>${percent}% 剩余</strong>
      <span>${escapeHtml(formatResetTime(window.reset_at))}</span>
      <div class="quota-bar"><i style="width:${percent}%"></i></div>
    </div>
  `;
}

function renderSelected() {
  const account = selectedAccount();
  if (!account) {
    $("selectedState").textContent = "未选择账号";
    $("detailTitle").textContent = "当前选择";
    $("selectedAccountPanel").innerHTML = '<div class="empty small">选择左侧账号后显示详情。</div>';
    $("switchBtn").textContent = state.helperReady ? "立即切换" : "下载 auth.json";
    $("switchBtn").disabled = true;
    $("copyAuthBtn").disabled = true;
    return;
  }
  const token = tokenState(account);
  const issue = usageIssue(account);
  const current = isCurrentAccount(account);
  $("selectedState").textContent = [
    account.email || "",
    issue?.label || token.label,
    planLabel(accountPlan(account)),
  ].filter(Boolean).join(" · ");
  $("detailTitle").textContent = account.name || "当前选择";
  $("selectedAccountPanel").innerHTML = `
    <div class="account-hero">
      <div class="badge-row">
        ${current ? '<span class="badge current-badge">正在使用</span>' : ""}
        ${state.user ? "" : `<span class="badge">${escapeHtml(sourceLabel(account))}</span>`}
        <span class="badge ${issue?.className || token.className}"><span class="status-dot ${issue?.className || token.className}"></span>${escapeHtml(issue?.label || token.label)}</span>
        <span class="badge ${planClass(accountPlan(account))}">${escapeHtml(planLabel(accountPlan(account)))}</span>
      </div>
      <div class="quota-summary">
        ${quotaCell(account.usage?.five_hour, "5H", account.usage)}
        ${quotaCell(account.usage?.one_week, "7D", account.usage)}
      </div>
      <div class="signal-grid">
        <div class="signal wide signal-with-action">
          <span>邮箱</span>
          <strong>${escapeHtml(account.email || "未识别")}</strong>
          ${account.email ? `<button type="button" data-selected-action="copy-email" data-email="${escapeHtml(account.email)}">复制</button>` : ""}
        </div>
        <div class="signal"><span>名称</span><strong>${escapeHtml(account.name || "未命名")}</strong></div>
        <div class="signal"><span>状态</span><strong>${escapeHtml(issue?.label || token.detail || token.label)}</strong></div>
        <div class="signal"><span>套餐</span><strong>${escapeHtml(planLabel(accountPlan(account)))}</strong></div>
        <div class="signal"><span>最近切换</span><strong>${escapeHtml(formatTime(account.lastSwitchAt))}</strong></div>
        <div class="signal wide"><span>账号 ID</span><strong>${escapeHtml(shortId(account.accountId))}</strong></div>
      </div>
      ${issue || token.className === "warn" || !canUseAccount(account) ? authAcquirePanel("授权需要更新") : ""}
      <div class="detail-edit">
        <div class="detail-edit-head">
          <strong>编辑</strong>
          <span>备注和智能切换偏好只影响账号池管理。</span>
        </div>
        <div class="detail-edit-grid">
          <label><span>名称</span><input id="editAccountName" value="${escapeHtml(account.name || "")}" /></label>
          <label><span>分组</span><input id="editAccountGroup" value="${escapeHtml(account.group || "默认")}" /></label>
          <label>
            <span>智能切换偏好</span>
            <select id="editAccountPriority">
              <option value="primary" ${account.priority === "primary" ? "selected" : ""}>优先使用</option>
              <option value="normal" ${account.priority !== "primary" && account.priority !== "reserve" ? "selected" : ""}>正常使用</option>
              <option value="reserve" ${account.priority === "reserve" ? "selected" : ""}>尽量少用</option>
            </select>
          </label>
          <label><span>备注</span><input id="editUsageNote" value="${escapeHtml(account.usageNote || "")}" /></label>
        </div>
        <button type="button" data-selected-action="save-details">保存修改</button>
      </div>
    </div>
  `;
  $("switchBtn").textContent = state.helperReady ? "立即切换" : "下载 auth.json";
  $("switchBtn").disabled = !canUseAccount(account);
  $("copyAuthBtn").disabled = !canUseAccount(account);
}

async function saveSelectedDetails() {
  const account = selectedAccount();
  if (!account) return;
  const name = $("editAccountName")?.value.trim() || account.name;
  const group = $("editAccountGroup")?.value.trim() || "默认";
  const priority = $("editAccountPriority")?.value || "normal";
  const usageNote = $("editUsageNote")?.value.trim() || "";
  const next = { ...account, name, group, priority, usageNote, updatedAt: new Date().toISOString() };
  updateLocalAccount(next);
  if (state.user && account.cloudId) {
    await api(`/api/accounts/${encodeURIComponent(account.cloudId)}`, {
      method: "PATCH",
      body: { name, group, priority, usageNote },
    }).catch((error) => toast(error.message || "保存失败。"));
    await loadCloudData();
  } else {
    render();
  }
  toast("账号信息已保存。");
}

function renderAudit() {
  const list = state.audit.slice(0, 8);
  if (!list.length) {
    $("auditList").innerHTML = '<div class="empty small">还没有云端运行记录。本地离线切换不会强制写云审计。</div>';
    return;
  }
  $("auditList").innerHTML = list.map((item) => `
    <div class="audit-item">
      <span>${escapeHtml(formatTime(item.at || item.createdAt))}</span>
      <strong>${escapeHtml(auditTitle(item))}</strong>
      <span>${escapeHtml(auditDescription(item))}</span>
    </div>
  `).join("");
}

function auditTitle(item) {
  const action = String(item.action || item.result || "").toLowerCase();
  const result = String(item.result || "");
  if (action.includes("switch")) return "账号已切换";
  if (action.includes("import") || /added|updated|failed/i.test(result)) return "账号已更新";
  if (action.includes("usage")) return "额度已刷新";
  return item.accountName || "操作已记录";
}

function auditDescription(item) {
  const result = String(item.result || "");
  const match = result.match(/added:(\d+),updated:(\d+),failed:(\d+)/i);
  if (match) {
    const [, added, updated, failed] = match;
    return `新增 ${added}，更新 ${updated}，失败 ${failed}`;
  }
  if (item.accountName) return item.accountName;
  return result || "已完成";
}

function renderDevice() {
  const helper = state.helperInfo || {};
  const codex = state.codexStatus || {};
  const idleSeconds = Number(codex.idle_seconds);
  const stableSeconds = Number(codex.stable_seconds);
  const idleText = Number.isFinite(idleSeconds) && idleSeconds >= 0
    ? `${Math.floor(idleSeconds)} 秒`
    : Number.isFinite(stableSeconds) && stableSeconds >= 0 ? `${Math.floor(stableSeconds)} 秒` : "未确认";
  const lastEventTime = codex.last_task_event_at ? ` · ${formatTime(codex.last_task_event_at)}` : "";
  const lastEvent = codex.last_task_event ? `${codex.last_task_event}${lastEventTime}` : "暂无近期任务事件";
  const pendingReason = codex.pending_switch_reason || "无";
  const switchSafety = codex.safe_to_switch ? "可安全切换" : "暂不切换";
  $("deviceKeyBox").textContent = state.deviceKey || "未生成";
  const rows = [
    ["连接", state.helperReady ? "在线" : "未连接"],
    ["地址", state.helperReady ? helperDisplayBase() : "未探测到"],
    ["端口", helper.port || "未识别"],
    ["Codex 状态", state.helperReady ? (codex.label || "确认中") : "未探测"],
    ["状态来源", state.helperReady ? codexStatusSourceLabel(codex) : "未连接"],
    ["空闲时长", state.helperReady ? idleText : "未确认"],
    ["最近任务", state.helperReady ? lastEvent : "未连接"],
    ["待切换原因", state.helperReady ? pendingReason : "未连接"],
    ["安全门", state.helperReady ? switchSafety : "未连接"],
    ["当前 auth", state.currentAuthChecking ? "正在确认" : (resolveCurrentAccountId() ? "已识别" : "未匹配账号池")],
    ["执行", "写入 auth 并重启 Codex"],
  ];
  $("devicePanel").innerHTML = `
    <div class="device-grid">
      ${rows.map(([label, value]) => `
        <div class="device-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("")}
    </div>
    <p class="muted-line">Helper 只读取本机任务日志中的事件类型，不展示或上传对话内容。</p>
  `;
}

function renderSecurity() {
  const account = selectedAccount();
  if (!account) {
    $("authPreview").textContent = "选择账号后显示摘要。";
    $("tokenWarning").hidden = true;
    return;
  }
  $("authPreview").textContent = JSON.stringify({
    account_id: account.accountId || "",
    email: account.email || "",
    plan_type: accountPlan(account),
    expires_at: account.expiresAt || "",
    has_refresh_token: hasUsableRefreshToken(account),
  }, null, 2);
  const warning = $("tokenWarning");
  if (!account.hasLocalSecret && account.cloudId && !state.user) {
    warning.hidden = false;
    warning.textContent = "这个账号只有云端元数据，需要登录云账号后才能获取切换 payload。";
  } else if (!hasUsableRefreshToken(account)) {
    warning.hidden = false;
    warning.textContent = "这个账号的 refresh_token 缺失或是占位值，长期可用性取决于 Codex 是否还能刷新。";
  } else {
    warning.hidden = true;
    warning.textContent = "";
  }
}

function renderSettings() {
  const codex = state.codexStatus || {};
  $("settingsAccountState").innerHTML = state.user
    ? `<strong>${escapeHtml(state.user.email)}</strong><span>${state.user.role === "admin" ? "管理员账号" : "同步账号"} · ${state.user.status === "disabled" ? "已停用" : "可用"}</span><button id="logoutInlineBtn" type="button">退出登录</button>`
    : `<strong>未登录</strong><span>本地账号池仍可使用；登录后可同步云端。</span><button id="loginInlineBtn" type="button">登录或注册</button>`;
  $("changePasswordForm").hidden = !state.user;
  $("settingsHelperState").innerHTML = `
    <strong>${state.helperReady ? "Helper 在线" : "Helper 离线"}</strong>
    <span>${escapeHtml(state.helperReady ? `Codex：${codex.label || "状态确认中"}` : "未安装时可下载 auth.json 手动替换。")}</span>
    ${state.helperReady && codex.detail ? `<span>${escapeHtml(codex.detail)}</span>` : ""}
    ${state.helperReady && codex.pending_switch_reason ? `<span>${escapeHtml(codex.pending_switch_reason)}</span>` : ""}
  `;
  $("backupCloudState").innerHTML = state.user
    ? `
      <label class="setting-toggle">
        <span><strong>自动备份到云端</strong><small>登录后导入的账号自动保存到云端。本机离线副本 ${state.localAccounts.length} 个。</small></span>
        <input id="autoBackupCloudToggle" type="checkbox" ${cloudBackupEnabled() ? "checked" : ""} />
      </label>
    `
    : `<strong>自动备份到云端</strong><span>登录后可开启。未登录时账号只保存在当前浏览器。</span>`;
  renderSmartSwitchSettings();
}

function renderSmartSwitchSettings() {
  const target = $("smartSettingsState");
  if (!target) return;
  const settings = state.smartSwitchSettings;
  const auto = state.autoSwitchSettings || defaultAutoSwitchSettings;
  const authorized = Boolean(state.autoSwitchStatus?.helperAuthorized || state.helperInfo?.auto_switch?.authorized);
  const autoStateText = !state.user
    ? "登录后可开启。"
    : !state.helperReady ? "等待 Dock Helper 在线。"
      : authorized ? "本机 Helper 已授权。"
        : "需要授权本机 Helper。";
  target.innerHTML = `
    <div class="settings-section-title">自动切换</div>
    <label class="setting-toggle">
      <span><strong>后台自动切换</strong><small>账号耗尽、限流或授权失效时，Helper 会静默切换到可用账号。</small></span>
      <input type="checkbox" data-auto-switch-setting="enabled" ${auto.enabled ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <div class="setting-box compact">
      <strong>${escapeHtml(autoStateText)}</strong>
      <span>触发阈值：5H ≤ ${Number(auto.fiveHourThreshold || 5)}%，7D ≤ ${Number(auto.oneWeekThreshold || 5)}%。额度检查约 ${Number(state.helperInfo?.auto_switch?.effective_poll_seconds || auto.pollSeconds || 15)} 秒一次。</span>
      <div class="setting-actions inline">
        <button id="authorizeAutoSwitchBtn" type="button" ${state.user && state.helperReady ? "" : "disabled"}>${authorized ? "重新授权 Helper" : "授权本机 Helper"}</button>
        <button id="revokeAutoSwitchBtn" type="button" ${state.user && authorized ? "" : "disabled"}>解除授权</button>
      </div>
    </div>
    <label class="setting-toggle">
      <span><strong>只用付费账号</strong><small>自动切换只选择 Plus、Pro 或 Team。</small></span>
      <input type="checkbox" data-auto-switch-setting="paidOnly" ${auto.paidOnly ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <label class="setting-toggle">
      <span><strong>优先 RT</strong><small>优先选择长期可刷新账号。</small></span>
      <input type="checkbox" data-auto-switch-setting="preferRt" ${auto.preferRt ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <label class="setting-toggle">
      <span><strong>允许 AT</strong><small>关闭后，只选择带 RT 的账号。</small></span>
      <input type="checkbox" data-auto-switch-setting="allowAt" ${auto.allowAt ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <label class="setting-toggle">
      <span><strong>避开当前账号</strong><small>自动切换不会重新选中当前账号。</small></span>
      <input type="checkbox" data-auto-switch-setting="avoidCurrent" ${auto.avoidCurrent ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <label class="setting-toggle">
      <span><strong>只在空闲时切换</strong><small>根据本机任务日志判断 Codex 是否空闲，避免打断正在执行的任务。</small></span>
      <input type="checkbox" data-auto-switch-setting="onlyWhenIdle" ${auto.onlyWhenIdle !== false ? "checked" : ""} ${state.user ? "" : "disabled"} />
    </label>
    <label class="setting-line">
      <span><strong>空闲保护</strong><small>连续空闲达到该时间后才允许自动重启 Codex。</small></span>
      <select data-auto-switch-setting="idleSeconds" ${state.user ? "" : "disabled"}>
        <option value="30" ${Number(auto.idleSeconds || 30) === 30 ? "selected" : ""}>30 秒</option>
        <option value="60" ${Number(auto.idleSeconds) === 60 ? "selected" : ""}>1 分钟</option>
        <option value="90" ${Number(auto.idleSeconds) === 90 ? "selected" : ""}>90 秒</option>
        <option value="120" ${Number(auto.idleSeconds) === 120 ? "selected" : ""}>2 分钟</option>
      </select>
    </label>
    <label class="setting-line">
      <span><strong>切换冷却</strong><small>自动切换后账号暂时不再参与候选。</small></span>
      <select data-auto-switch-setting="cooldownMinutes" ${state.user ? "" : "disabled"}>
        <option value="10" ${auto.cooldownMinutes === 10 ? "selected" : ""}>10 分钟</option>
        <option value="30" ${auto.cooldownMinutes === 30 ? "selected" : ""}>30 分钟</option>
        <option value="60" ${auto.cooldownMinutes === 60 ? "selected" : ""}>1 小时</option>
      </select>
    </label>
    <div class="settings-section-title">手动智能切换</div>
    <label class="setting-toggle">
      <span><strong>只使用付费账号</strong><small>智能切换优先选择 Plus、Pro 或 Team。</small></span>
      <input type="checkbox" data-smart-setting="paidOnly" ${settings.paidOnly ? "checked" : ""} />
    </label>
    <label class="setting-toggle">
      <span><strong>优先 RT</strong><small>有 RT 的账号会获得更高分。</small></span>
      <input type="checkbox" data-smart-setting="preferRt" ${settings.preferRt ? "checked" : ""} />
    </label>
    <label class="setting-toggle">
      <span><strong>允许 AT</strong><small>关闭后，只选择带 RT 的账号。</small></span>
      <input type="checkbox" data-smart-setting="allowAt" ${settings.allowAt ? "checked" : ""} />
    </label>
    <label class="setting-toggle">
      <span><strong>避开当前账号</strong><small>尽量不要重复选中正在使用的账号。</small></span>
      <input type="checkbox" data-smart-setting="avoidCurrent" ${settings.avoidCurrent ? "checked" : ""} />
    </label>
    <label class="setting-toggle">
      <span><strong>避开 5H 低余量</strong><small>5H 余量低于 30% 时跳过。</small></span>
      <input type="checkbox" data-smart-setting="avoidLow5h" ${settings.avoidLow5h ? "checked" : ""} />
    </label>
    <label class="setting-toggle">
      <span><strong>避开 7D 低余量</strong><small>7D 余量低于 30% 时跳过。</small></span>
      <input type="checkbox" data-smart-setting="avoidLow7d" ${settings.avoidLow7d ? "checked" : ""} />
    </label>
    <label class="setting-line">
      <span><strong>切换冷却</strong><small>最近切换过的账号暂时不参与智能切换。</small></span>
      <select data-smart-setting="cooldownMinutes">
        <option value="0" ${settings.cooldownMinutes === 0 ? "selected" : ""}>不限制</option>
        <option value="10" ${settings.cooldownMinutes === 10 ? "selected" : ""}>10 分钟</option>
        <option value="30" ${settings.cooldownMinutes === 30 ? "selected" : ""}>30 分钟</option>
        <option value="60" ${settings.cooldownMinutes === 60 ? "selected" : ""}>1 小时</option>
      </select>
    </label>
  `;
}

function codexStatusSourceLabel(status = {}) {
  if (status.source === "logs_2.sqlite") return "任务日志";
  if (status.source === "process") return "进程检测";
  if (!status.protocol_connected) return "任务日志";
  return "任务日志";
}

function renderAdmin() {
  if (state.user?.role !== "admin") return;
  if ($("adminUserSearch")) $("adminUserSearch").value = state.adminFilters.userQuery || "";
  if ($("adminRoleFilter")) $("adminRoleFilter").value = state.adminFilters.role || "";
  if ($("adminStatusFilter")) $("adminStatusFilter").value = state.adminFilters.status || "";
  if ($("adminAuditSearch")) $("adminAuditSearch").value = state.adminFilters.auditQuery || "";
  if ($("adminAuditActionFilter")) $("adminAuditActionFilter").value = state.adminFilters.auditAction || "";
  if (state.adminSummary) {
    const summary = state.adminSummary;
    $("adminSummary").innerHTML = [
      ["用户数", summary.users],
      ["启用用户", summary.activeUsers],
      ["账号数", summary.accounts],
      ["设备数", state.adminDevices.length],
      ["在线 session", summary.onlineSessions],
      ["24h 导入", summary.imports24h],
      ["24h 切换", summary.switches24h],
    ].map(([label, value]) => `
      <div class="metric flat">
        <span>${label}</span>
        <strong>${value ?? 0}</strong>
      </div>
    `).join("");
  }
  $("adminUsers").innerHTML = state.adminUsers.length ? `
    <table class="admin-table">
      <thead>
        <tr>
          <th></th>
          <th>用户</th>
          <th>角色</th>
          <th>状态</th>
          <th>账号</th>
          <th>会话</th>
          <th>最近活跃</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${state.adminUsers.map((user) => `
          <tr>
            <td><input type="checkbox" data-admin-user-select="${escapeHtml(user.id)}" ${state.selectedAdminUserIds.has(user.id) ? "checked" : ""} /></td>
            <td><button class="table-link" data-admin-action="user-summary" data-id="${escapeHtml(user.id)}"><strong>${escapeHtml(user.email)}</strong><span>${escapeHtml(shortId(user.id))}</span></button></td>
            <td>${escapeHtml(user.role === "admin" ? "管理员" : "用户")}</td>
            <td>${escapeHtml(user.status === "disabled" ? "已停用" : "可用")}</td>
            <td>${user.accountCount || 0}</td>
            <td>${user.sessionCount || 0}</td>
            <td>${escapeHtml(formatTime(user.lastSeenAt || user.lastLoginAt))}</td>
            <td>
              <div class="row-actions">
                <button data-admin-action="toggle-status" data-id="${escapeHtml(user.id)}" data-status="${escapeHtml(user.status)}">${user.status === "active" ? "禁用" : "启用"}</button>
                <button data-admin-action="toggle-role" data-id="${escapeHtml(user.id)}" data-role="${escapeHtml(user.role)}">${user.role === "admin" ? "降级" : "升管"}</button>
                <button data-admin-action="reset-password" data-id="${escapeHtml(user.id)}">重置密码</button>
                <button data-admin-action="kick" data-id="${escapeHtml(user.id)}">踢下线</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : '<div class="empty small">暂无用户数据。</div>';
  const selectedCount = state.selectedAdminUserIds.size;
  $("adminSelectAllBtn").textContent = selectedCount ? `已选 ${selectedCount}` : "选择结果";
  $("adminAudit").innerHTML = state.adminAudit.length ? state.adminAudit.slice(0, 30).map((item) => `
    <div class="audit-item">
      <span>${escapeHtml(formatTime(item.createdAt))}</span>
      <strong>${escapeHtml(item.userEmail || "未知用户")} · ${escapeHtml(auditTitle(item))}</strong>
      <span>${escapeHtml(auditDescription(item))}</span>
    </div>
  `).join("") : '<div class="empty small">暂无审计记录。</div>';
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("codex-sidebar-collapsed-v1", state.sidebarCollapsed ? "1" : "0");
  renderShell();
}

async function checkHelper() {
  const candidates = [
    "http://127.0.0.1:18766",
    "http://127.0.0.1:18767",
    "http://127.0.0.1:18768",
    "http://127.0.0.1:18769",
    "http://127.0.0.1:18770",
  ];
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/api/health`, { cache: "no-store" });
      const result = await response.json();
      const knownHelper = result.mode === "local-helper" || result.mode === "native-helper" || result.mode === "codex-plus-helper";
      if (response.ok && result.ok && knownHelper) {
        state.helperReady = true;
        state.helperBase = base;
        state.helperInfo = result;
        state.codexProxy = result.codex_proxy || result.codexProxy || null;
        state.codexStatus = result.codex_status || result.codexStatus || null;
        state.autoSwitchStatus.helperAuthorized = Boolean(result.auto_switch?.authorized);
        state.autoSwitchStatus.lastCheck = result.auto_switch?.last_check || "";
        state.autoSwitchStatus.lastSwitch = result.auto_switch?.last_switch || "";
        state.autoSwitchStatus.lastReason = result.auto_switch?.last_reason || "";
        state.currentAuthChecking = true;
        render();
        await registerDevice();
        await detectCurrentAuth();
        return true;
      }
    } catch {
      // Continue probing.
    }
  }
  state.helperReady = false;
  state.helperBase = "";
  state.helperInfo = null;
  state.codexProxy = null;
  state.codexStatus = null;
  state.autoSwitchStatus.helperAuthorized = false;
  state.currentAuthChecking = false;
  state.localAuthFingerprint = "";
  state.currentAuthKey = "";
  state.currentAuthAccount = null;
  render();
  return false;
}

async function refreshHelperRuntimeStatus() {
  if (!state.helperReady || !state.helperBase) return false;
  try {
    const previousCheck = state.autoSwitchStatus.lastCheck || "";
    const previousSwitch = state.autoSwitchStatus.lastSwitch || "";
    const response = await fetch(`${state.helperBase}/api/health`, { cache: "no-store" });
    const result = await response.json();
    const knownHelper = result.mode === "local-helper" || result.mode === "native-helper" || result.mode === "codex-plus-helper";
    if (!response.ok || !result.ok || !knownHelper) return false;
    state.helperInfo = result;
    state.codexProxy = result.codex_proxy || result.codexProxy || state.codexProxy;
    state.codexStatus = result.codex_status || result.codexStatus || state.codexStatus;
    state.autoSwitchStatus.helperAuthorized = Boolean(result.auto_switch?.authorized);
    state.autoSwitchStatus.lastCheck = result.auto_switch?.last_check || "";
    state.autoSwitchStatus.lastSwitch = result.auto_switch?.last_switch || "";
    state.autoSwitchStatus.lastReason = result.auto_switch?.last_reason || "";
    renderShell();
    renderDevice();
    renderSettings();
    const checkChanged = Boolean(state.autoSwitchStatus.lastCheck && state.autoSwitchStatus.lastCheck !== previousCheck);
    const switchChanged = Boolean(state.autoSwitchStatus.lastSwitch && state.autoSwitchStatus.lastSwitch !== previousSwitch);
    if (state.user && (checkChanged || switchChanged) && !state.cloudReloadingFromHelper) {
      state.cloudReloadingFromHelper = true;
      try {
        if (switchChanged) await detectCurrentAuth().catch(() => {});
        await loadCloudData().catch(() => {});
      } finally {
        state.cloudReloadingFromHelper = false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function configureCodexProxy(action) {
  if (!state.helperReady || !state.helperBase) {
    toast("Dock Helper 未连接。");
    return;
  }
  try {
    const response = await fetch(`${state.helperBase}/api/codex/proxy/${action}`, { method: "POST" });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || "状态监控配置失败");
    state.codexProxy = result.codex_proxy || result.codexProxy || state.codexProxy;
    state.helperInfo = { ...(state.helperInfo || {}), codex_proxy: state.codexProxy };
    renderDevice();
    renderSettings();
    toast(result.message || (action === "install" ? "状态监控已启用。" : "状态监控已关闭。"));
  } catch (error) {
    toast(error.message || "状态监控配置失败。");
  }
}

async function detectCurrentAuth() {
  if (!state.helperReady) return false;
  state.currentAuthChecking = true;
  renderAccounts();
  renderDevice();
  try {
    const response = await fetch(`${state.helperBase}/api/current-auth`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.authJson) {
      state.localAuthFingerprint = "";
      state.currentAuthKey = "";
      state.currentAuthAccount = null;
      return false;
    }
    const session = parseSession(JSON.stringify(result.authJson));
    state.localAuthFingerprint = authFingerprint(session);
    const normalized = normalizeLocalAccount({
      id: "current-auth",
      name: session.email || session.tokens.account_id || "当前 auth",
      email: session.email || "",
      accountId: session.tokens.account_id || "",
      planType: session.profile?.plan || "",
      expiresAt: session.expires || "",
      session,
    });
    state.currentAuthKey = accountDedupeKey(normalized);
    state.currentAuthAccount = normalized;
    return true;
  } catch {
    state.localAuthFingerprint = "";
    state.currentAuthKey = "";
    state.currentAuthAccount = null;
    return false;
  } finally {
    state.currentAuthChecking = false;
    render();
  }
}

async function loadMe() {
  try {
    const result = await api("/api/me");
    state.user = result.user || null;
    state.authResolved = true;
    if (state.user) {
      await loadCloudData();
      await registerDevice();
    } else {
      state.cloudAccounts = [];
      state.audit = [];
      render();
    }
  } catch {
    state.user = null;
    state.authResolved = true;
    state.cloudAccounts = [];
    state.audit = [];
    render();
  }
}

async function loadCloudData() {
  if (!state.user) {
    state.cloudAccounts = [];
    state.audit = [];
    render();
    return;
  }
  const [accountsResult, auditResult, autoResult] = await Promise.all([
    api("/api/accounts"),
    api("/api/audit"),
    api("/api/settings/auto-switch").catch(() => ({ settings: { ...defaultAutoSwitchSettings } })),
  ]);
  state.cloudAccounts = (accountsResult.accounts || []).map(normalizeCloudAccount);
  state.autoSwitchSettings = { ...defaultAutoSwitchSettings, ...(autoResult.settings || {}) };
  state.audit = (auditResult.audit || []).map((item) => ({
    at: item.createdAt || item.created_at,
    accountId: item.accountId || item.account_id,
    accountName: item.accountName || item.account_name || "",
    result: item.result || item.action || "",
    action: item.action || "",
  }));
  render();
}

async function loadAdminData() {
  if (state.user?.role !== "admin") return;
  try {
    const params = new URLSearchParams();
    if (state.adminFilters.userQuery) params.set("query", state.adminFilters.userQuery);
    if (state.adminFilters.role) params.set("role", state.adminFilters.role);
    if (state.adminFilters.status) params.set("status", state.adminFilters.status);
    const auditParams = new URLSearchParams();
    if (state.adminFilters.auditQuery) auditParams.set("query", state.adminFilters.auditQuery);
    if (state.adminFilters.auditAction) auditParams.set("action", state.adminFilters.auditAction);
    const [summary, users, audit, devices] = await Promise.all([
      api("/api/admin/summary"),
      api(`/api/admin/users${params.toString() ? `?${params}` : ""}`),
      api(`/api/admin/audit${auditParams.toString() ? `?${auditParams}` : ""}`),
      api("/api/admin/devices").catch(() => ({ devices: [] })),
    ]);
    state.adminSummary = summary.summary || null;
    state.adminUsers = users.users || [];
    state.adminAudit = audit.audit || [];
    state.adminDevices = devices.devices || [];
    const userIds = new Set(state.adminUsers.map((user) => user.id));
    state.selectedAdminUserIds = new Set([...state.selectedAdminUserIds].filter((id) => userIds.has(id)));
    renderAdmin();
  } catch (error) {
    toast(error.message || "加载管理员数据失败。");
  }
}

async function registerDevice() {
  if (!state.user || !state.deviceKey) return;
  try {
    await api("/api/devices/register", {
      method: "POST",
      body: {
        deviceKey: state.deviceKey,
        name: navigator.platform || "Browser",
        helperOnline: state.helperReady,
        helperBase: state.helperBase,
      },
    });
    if (state.helperReady) {
      await fetch(`${state.helperBase}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceKey: state.deviceKey, cloudUserId: state.user.id }),
      }).catch(() => {});
    }
  } catch {
    // Device registration should not block switching.
  }
}

async function saveAutoSwitchSettings(patch = {}) {
  if (!state.user) {
    toast("登录后才能开启自动切换。");
    renderSmartSwitchSettings();
    return;
  }
  const next = { ...state.autoSwitchSettings, ...patch };
  try {
    const result = await api("/api/settings/auto-switch", {
      method: "PATCH",
      body: { settings: next },
    });
    state.autoSwitchSettings = { ...defaultAutoSwitchSettings, ...(result.settings || next) };
    saveLocalStore();
    const authorized = Boolean(state.autoSwitchStatus?.helperAuthorized || state.helperInfo?.auto_switch?.authorized);
    if (state.helperReady && authorized) {
      await configureHelperAutoSwitch({
        enabled: state.autoSwitchSettings.enabled,
        settings: state.autoSwitchSettings,
      }).catch(() => {});
    }
    render();
  } catch (error) {
    toast(error.message || "保存自动切换设置失败。");
    renderSmartSwitchSettings();
  }
}

async function configureHelperAutoSwitch(config) {
  if (!state.helperReady) throw new Error("Dock Helper 未连接");
  const response = await fetch(`${state.helperBase}/api/auto-switch/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Helper 配置失败");
  state.helperInfo = { ...(state.helperInfo || {}), auto_switch: result.auto_switch || result.autoSwitch || {} };
  state.autoSwitchStatus.helperAuthorized = Boolean(state.helperInfo.auto_switch?.authorized);
  state.autoSwitchStatus.lastCheck = state.helperInfo.auto_switch?.last_check || "";
  state.autoSwitchStatus.lastSwitch = state.helperInfo.auto_switch?.last_switch || "";
  state.autoSwitchStatus.lastReason = state.helperInfo.auto_switch?.last_reason || "";
  return result;
}

async function authorizeAutoSwitchHelper() {
  if (!state.user) {
    openModal("authModal");
    return;
  }
  if (!state.helperReady) {
    await checkHelper();
    if (!state.helperReady) {
      toast("Dock Helper 未连接。");
      return;
    }
  }
  try {
    const tokenResult = await api("/api/devices/auto-switch-token", {
      method: "POST",
      body: {
        deviceKey: state.deviceKey,
        name: "Dock Helper",
        helperBase: state.helperBase,
      },
    });
    const settings = { ...defaultAutoSwitchSettings, ...(tokenResult.settings || state.autoSwitchSettings), enabled: true };
    await configureHelperAutoSwitch({
      enabled: true,
      cloudBase: tokenResult.cloudBase || window.location.origin,
      deviceToken: tokenResult.deviceToken,
      deviceKey: state.deviceKey,
      settings,
    });
    await saveAutoSwitchSettings(settings);
    toast("已授权本机 Helper，自动切换已开启。");
    await checkHelper();
  } catch (error) {
    toast(error.message || "授权 Helper 失败。");
  }
}

async function revokeAutoSwitchHelper() {
  if (!state.user) return;
  try {
    await api("/api/devices/auto-switch-token", {
      method: "DELETE",
      body: { deviceKey: state.deviceKey },
    });
    if (state.helperReady) {
      await configureHelperAutoSwitch({ enabled: false, clearToken: true }).catch(() => {});
    }
    state.autoSwitchStatus.helperAuthorized = false;
    await saveAutoSwitchSettings({ enabled: false });
    toast("已解除本机 Helper 授权。");
  } catch (error) {
    toast(error.message || "解除授权失败。");
  }
}

function normalizeAuthPayload(session) {
  const tokens = session?.tokens || {};
  const accessToken = tokens.access_token || "";
  if (!accessToken) throw new Error("账号缺少 access_token");
  const refreshToken = tokens.refresh_token && tokens.refresh_token !== accessToken
    ? tokens.refresh_token
    : "rt_mock_token";
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: accessToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: tokens.account_id || "",
    },
    last_refresh: new Date().toISOString(),
  };
}

async function fetchSwitchPayload(account, audit = true) {
  if (account.session?.tokens?.access_token) {
    return normalizeAuthPayload(account.session);
  }
  if (!state.user || !account.cloudId) {
    throw new Error("这个账号没有本地 token，登录云账号后才能切换。");
  }
  const result = await api(`/api/accounts/${encodeURIComponent(account.cloudId)}/switch-payload`, {
    method: "POST",
    body: { deviceKey: state.deviceKey, audit },
  });
  if (!result.authJson) throw new Error("云端没有返回 auth payload");
  return result.authJson;
}

function authDownloadName(account) {
  const seed = (account?.email || account?.name || account?.accountId || "codex-auth").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${seed || "codex-auth"}.auth.json`;
}

async function downloadAccountAuth(account, options = {}) {
  const authJson = await fetchSwitchPayload(account, options.audit ?? true);
  downloadText(authDownloadName(account), JSON.stringify(authJson, null, 2));
  toast("auth.json 已下载。替换到 %USERPROFILE%\\.codex\\auth.json 后重启 Codex。");
  return authJson;
}

async function applySelectedAccount() {
  const account = selectedAccount();
  if (!account) return;
  if (!state.helperReady) {
    try {
      await downloadAccountAuth(account);
    } catch (error) {
      toast(error.message || "下载 auth.json 失败。");
    }
    return;
  }
  try {
    const authJson = await fetchSwitchPayload(account, true);
    const response = await fetch(`${state.helperBase}/api/apply-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authJson, launch: true, restart: true, deviceKey: state.deviceKey }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Helper 执行失败");
    account.lastSwitchAt = new Date().toISOString();
    state.currentAuthKey = accountDedupeKey(account);
    state.currentAuthAccount = account;
    state.localAuthFingerprint = accountFingerprint(account);
    updateLocalAccount(account);
    if (state.user && account.cloudId) {
      await api("/api/audit", {
        method: "POST",
        body: {
          accountId: account.cloudId,
          action: "switch",
          result: result.launch_mode || "已写入 auth.json",
          deviceKey: state.deviceKey,
          metadata: { helperBase: state.helperBase, accepted: Boolean(result.accepted), stoppedCount: result.stopped_count ?? 0 },
        },
      }).catch(() => {});
      await loadCloudData();
    } else {
      render();
    }
    toast(result.accepted ? "后台切换已接管，Codex 会自动重启。" : "切换完成，Codex 已重启。");
  } catch (error) {
    toast(error.message || "切换失败。");
  }
}

async function refreshAccountUsage(id, options = {}) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return false;
  if (!state.helperReady) {
    if (!options.silent) toast("Helper 未连接，不能刷新额度。");
    return false;
  }
  try {
    account.usage = { ...normalizeUsage(account.usage, accountPlan(account)), status: "刷新中", error: "" };
    renderAccounts();
    renderSelected();
    const authJson = await fetchSwitchPayload(account, false);
    const response = await fetch(`${state.helperBase}/api/usage/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authJson, deviceKey: state.deviceKey }),
    });
    const result = await response.json();
    const snapshot = result.usage_snapshot || result.usage || {};
    const normalized = normalizeUsage(snapshot, accountPlan(account));
    normalized.plan_type = bestPlan(accountPlan(account), normalized.plan_type);
    if (!result.ok) {
      normalized.error = explainError(result.error || normalized.error || "刷新失败");
      normalized.status = "刷新失败";
      normalized.refreshed_at = normalized.refreshed_at || new Date().toISOString();
    }
    account.usage = normalized;
    account.planType = bestPlan(account.planType, normalized.plan_type);
    updateLocalAccount(account);
    if (state.user && account.cloudId) {
      await api(`/api/accounts/${encodeURIComponent(account.cloudId)}/usage`, {
        method: "POST",
        body: { usage: normalized, ok: Boolean(result.ok), error: result.ok ? "" : (result.error || "刷新失败") },
      }).catch(() => {});
      await loadCloudData();
    } else {
      render();
    }
    if (!options.silent) toast(result.ok ? `已刷新 ${account.name} 的额度。` : `${account.name} 额度刷新失败：${normalized.error || "刷新失败"}`);
    return Boolean(result.ok);
  } catch (error) {
    const message = explainError(error.message || "刷新失败");
    account.usage = {
      ...normalizeUsage(account.usage, accountPlan(account)),
      status: "刷新失败",
      error: message,
      refreshed_at: new Date().toISOString(),
    };
    updateLocalAccount(account);
    render();
    if (!options.silent) toast(`${account.name} 额度刷新失败：${message}`);
    return false;
  }
}

async function refreshAllUsage() {
  if (!state.helperReady) {
    toast("Helper 未连接，不能刷新额度。");
    return;
  }
  if (!state.accounts.length || state.refreshingUsage) return;
  state.refreshingUsage = true;
  renderShell();
  const accounts = [...state.accounts];
  openProgress("刷新额度", accounts.map((account) => ({ label: account.email || account.name })));
  let ok = 0;
  for (const [index, account] of accounts.entries()) {
    updateProgressItem(index, "刷新中");
    const success = await refreshAccountUsage(account.id, { silent: true });
    if (success) {
      ok++;
      updateProgressItem(index, "已完成");
    } else {
      updateProgressItem(index, "失败", "额度刷新失败");
    }
  }
  state.refreshingUsage = false;
  render();
  finishProgress(`额度刷新完成：${ok}/${accounts.length}`);
  toast(`额度刷新完成：${ok}/${state.accounts.length}`);
}

async function smartSwitchBestAccount() {
  const account = bestAccount();
  if (!account) {
    toast("没有可切换账号。");
    return;
  }
  state.selectedId = account.id;
  saveLocalStore();
  render();
  toast(`智能切换选择：${account.name || account.email}。${smartSwitchReasons(account)}`);
  await applySelectedAccount();
}

function findAccountIndexByIdentity(accounts, account) {
  const keys = new Set(importIdentityKeys(account));
  if (!keys.size) return -1;
  return accounts.findIndex((item) => importIdentityKeys(item).some((key) => keys.has(key)));
}

function upsertLocalAccounts(accounts) {
  let added = 0;
  let updated = 0;
  for (const account of accounts.map(normalizeLocalAccount)) {
    const index = findAccountIndexByIdentity(state.localAccounts, account);
    if (index >= 0) {
      state.localAccounts[index] = mergeAccount(state.localAccounts[index], account);
      updated++;
    } else {
      account.id = account.id || crypto.randomUUID();
      account.localId = account.localId || account.id;
      state.localAccounts.unshift(account);
      added++;
    }
  }
  saveLocalStore();
  render();
  return { added, updated };
}

function updateLocalAccount(account) {
  const index = state.localAccounts.findIndex((item) => item.id === account.localId || item.id === account.id);
  const normalized = normalizeLocalAccount({ ...account, id: account.localId || account.id });
  const identityIndex = index >= 0 ? index : findAccountIndexByIdentity(state.localAccounts, normalized);
  if (identityIndex >= 0) state.localAccounts[identityIndex] = mergeAccount(state.localAccounts[identityIndex], normalized);
  else if (account.session) state.localAccounts.unshift(normalized);
  saveLocalStore();
}

function accountToImportPayload(account) {
  return {
    name: account.name,
    email: account.email,
    group: account.group || "默认",
    priority: account.priority || "normal",
    usageNote: account.usageNote || "",
    expiryNote: account.expiryNote || "",
    session: account.session,
    usage: account.usage || null,
  };
}

async function uploadLocalToCloud(accounts = state.localAccounts) {
  if (!state.user) return { added: 0, updated: 0, failed: 0 };
  const payload = accounts.filter((account) => account.session?.tokens?.access_token).map(accountToImportPayload);
  if (!payload.length) return { added: 0, updated: 0, failed: 0 };
  const result = await api("/api/accounts/import", { method: "POST", body: { accounts: payload } });
  await loadCloudData();
  return result;
}

async function maybeAutoUpload() {
  if (cloudBackupEnabled()) {
    try {
      await uploadLocalToCloud();
    } catch (error) {
      toast(error.message || "云端同步失败。");
    }
  }
}

async function importParsedEntries(entries, defaults = {}) {
  const usable = entries.filter((entry) => entry.ok && entry.session);
  const failed = entries.length - usable.length;
  if (!usable.length) return { added: 0, updated: 0, skipped: 0, failed, total: entries.length, cloud: null };
  const accounts = usable.map((entry, index) => {
    const session = entry.session;
    return {
      id: crypto.randomUUID(),
      name: defaults.name && usable.length === 1 ? defaults.name : entry.accountName || session.email || shortId(session.tokens.account_id) || `Account ${index + 1}`,
      email: defaults.email && usable.length === 1 ? defaults.email : session.email,
      group: defaults.group || "默认",
      priority: defaults.priority || "normal",
      usageNote: defaults.usageNote || `${defaults.sourceLabel ? `${defaults.sourceLabel} · ` : ""}${session.sourceType || "导入"}`,
      expiryNote: defaults.expiryNote || session.expires || "",
      accountId: session.tokens.account_id || "",
      expiresAt: session.expires || "",
      planType: session.profile?.plan || "",
      usage: hasUsageSnapshot(session.usage) ? normalizeUsage(session.usage, session.profile?.plan) : null,
      session,
    };
  });
  const result = upsertLocalAccounts(accounts);
  let cloud = null;
  if (cloudBackupEnabled()) {
    try {
      cloud = await uploadLocalToCloud(accounts);
    } catch (error) {
      toast(error.message || "云端备份失败。");
    }
  }
  render();
  return { added: result.added, updated: result.updated, skipped: 0, failed, total: entries.length, cloud };
}

async function confirmPendingImport() {
  const importable = state.pendingImportItems.filter((item) => item.ok && item.account);
  const failed = state.pendingImportItems.filter((item) => item.status === "无法解析").length;
  if (!importable.length) {
    showImportResult({ message: "没有可导入账号。请先解析有效 JSON。", failed });
    return;
  }
  const button = $("confirmImportBtn");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = cloudBackupEnabled() ? "正在导入并备份..." : "正在导入...";
  showImportResult({ message: cloudBackupEnabled() ? "正在写入账号池并备份到云端..." : "正在写入本地账号池..." });
  try {
    const accounts = importable.map((item) => item.account);
    const result = upsertLocalAccounts(accounts);
    let cloud = null;
    if (cloudBackupEnabled()) {
      cloud = await uploadLocalToCloud(accounts);
    }
    await loadCloudData().catch(() => {});
    state.importCompleted = true;
    render();
    if (state.helperReady) {
      const refreshed = await refreshImportedAccounts(accounts);
      if (refreshed.total) cloud = { ...(cloud || {}), refreshed: refreshed.ok, refreshFailed: refreshed.failed };
    }
    showImportResult({
      added: result.added,
      updated: result.updated,
      failed,
      total: state.pendingImportItems.length,
      cloud,
    });
    toast(`导入完成：新增 ${result.added}，更新 ${result.updated}。`);
  } catch (error) {
    state.importCompleted = false;
    showImportResult({ failed: failed + 1, message: error.message || "导入失败。" });
  } finally {
    button.textContent = originalText;
    renderImportPreview();
  }
}

function findImportedVisibleAccounts(importedAccounts) {
  const wantedKeys = new Set();
  for (const account of importedAccounts) {
    for (const key of importIdentityKeys(account)) wantedKeys.add(key);
  }
  const found = [];
  const seen = new Set();
  for (const account of state.accounts) {
    const matched = importIdentityKeys(account).some((key) => wantedKeys.has(key));
    if (!matched || seen.has(account.id)) continue;
    seen.add(account.id);
    found.push(account);
  }
  return found;
}

async function refreshImportedAccounts(importedAccounts) {
  const accounts = findImportedVisibleAccounts(importedAccounts);
  if (!accounts.length) return { total: 0, ok: 0, failed: 0 };
  openProgress("刷新导入账号", accounts.map((account) => ({ id: account.id, label: account.name || account.email || "账号" })));
  let ok = 0;
  let failed = 0;
  for (let index = 0; index < accounts.length; index++) {
    updateProgressItem(index, "刷新中");
    const success = await refreshAccountUsage(accounts[index].id, { silent: true });
    if (success) {
      ok++;
      updateProgressItem(index, "已完成");
    } else {
      failed++;
      updateProgressItem(index, "失败", "需要重新登录或稍后重试");
    }
  }
  finishProgress(`刷新完成：成功 ${ok}，失败 ${failed}`);
  return { total: accounts.length, ok, failed };
}

function hasUsageSnapshot(usage) {
  return Boolean(usage && (usage.refreshed_at || usage.fetched_at || usage.five_hour || usage.one_week));
}

async function importAccountsFromText(text, defaults = {}) {
  const entries = parseImportEntries(text);
  return importParsedEntries(entries, defaults);
}

function previewImportText(text) {
  const entries = parseImportEntries(text);
  const ok = entries.filter((entry) => entry.ok);
  const failed = entries.length - ok.length;
  return {
    added: 0,
    updated: 0,
    skipped: 0,
    failed,
    total: entries.length,
    preview: true,
    message: ok.length
      ? `识别到 ${ok.length} 个账号${failed ? `，${failed} 个无法解析` : ""}。确认无误后保存。`
      : (entries[0]?.error || "没有识别到可导入账号。"),
  };
}

async function importAccountsFromFiles(fileList, defaults = {}) {
  const files = Array.from(fileList || []).filter((file) => /\.json$/i.test(file.name) || file.type === "application/json" || !file.type);
  const totals = { added: 0, updated: 0, skipped: 0, failed: 0, total: 0, cloud: { added: 0, updated: 0, failed: 0 } };
  if (!files.length && fileList?.length) {
    return { added: 0, updated: 0, skipped: fileList.length, failed: 0, total: fileList.length };
  }
  for (const file of files) {
    try {
      const result = await importAccountsFromText(await file.text(), { ...defaults, sourceLabel: file.name });
      totals.added += result.added;
      totals.updated += result.updated;
      totals.failed += result.failed;
      totals.total += result.total;
      if (result.cloud) {
        totals.cloud.added += result.cloud.added || 0;
        totals.cloud.updated += result.cloud.updated || 0;
        totals.cloud.failed += result.cloud.failed || 0;
      }
    } catch {
      totals.failed += 1;
      totals.total += 1;
    }
  }
  if (!totals.cloud.added && !totals.cloud.updated && !totals.cloud.failed) totals.cloud = null;
  return totals;
}

async function pullCloudToLocal() {
  if (!state.user) {
    toast("请先登录云账号。");
    return;
  }
  if (!state.cloudAccounts.length) {
    toast("云端账号池为空。");
    return;
  }
  openProgress("拉取云端到本机", state.cloudAccounts.map((account) => ({
    label: account.email || account.name || shortId(account.accountId),
  })));
  const accounts = [];
  let failed = 0;
  for (const [index, account] of state.cloudAccounts.entries()) {
    try {
      updateProgressItem(index, "拉取中");
      const authJson = await fetchSwitchPayload(account, false);
      const session = parseSession(JSON.stringify(authJson));
      accounts.push({
        id: crypto.randomUUID(),
        cloudId: account.cloudId,
        name: account.name,
        email: account.email || session.email,
        group: account.group,
        priority: account.priority,
        usageNote: "从云端拉取到本机",
        expiryNote: account.expiryNote || session.expires || "",
        accountId: account.accountId || session.tokens.account_id || "",
        expiresAt: account.expiresAt || session.expires || "",
        planType: accountPlan(account) || session.profile?.plan || "",
        usage: account.usage,
        session,
      });
      updateProgressItem(index, "已完成");
    } catch (error) {
      updateProgressItem(index, "失败", error.message || "无法获取 auth");
      failed++;
    }
  }
  const result = upsertLocalAccounts(accounts);
  await loadCloudData();
  finishProgress(`新增 ${result.added}，更新 ${result.updated}${failed ? `，失败 ${failed}` : ""}。`);
  toast(`已拉取云端到本机：新增 ${result.added}，更新 ${result.updated}${failed ? `，失败 ${failed}` : ""}。`);
}

async function importCurrentLocalAuth(options = {}) {
  const silent = Boolean(options.silent);
  if (state.autoImportingLocalAuth) return false;
  if (!state.helperReady) {
    if (!silent) toast("Helper 未连接，无法读取本机 auth。");
    return false;
  }
  state.autoImportingLocalAuth = true;
  if (!silent) openProgress("同步本机 auth", [{ label: "读取当前 auth.json" }]);
  try {
    if (!silent) updateProgressItem(0, "读取中");
    const response = await fetch(`${state.helperBase}/api/current-auth`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "读取本机 auth 失败");
    const session = parseSession(JSON.stringify(result.authJson));
    const fingerprint = authFingerprint(session);
    if (fingerprint && fingerprint === state.localAuthFingerprint) {
      if (!silent) {
        updateProgressItem(0, "已完成", "本机授权已在账号池中");
        finishProgress("本机授权已是最新。");
      }
      return false;
    }
    state.localAuthFingerprint = fingerprint;
    const imported = await importParsedEntries([{ ok: true, session, accountName: session.email || "本机授权" }], {
      group: "本机",
      priority: "primary",
      usageNote: `从本机 auth.json 导入${result.path ? `：${result.path}` : ""}`,
    });
    if (!silent) {
      updateProgressItem(0, "已完成");
      finishProgress(`新增 ${imported.added}，更新 ${imported.updated}。`);
    }
    if (!silent) toast(`已同步本机授权：新增 ${imported.added}，更新 ${imported.updated}。`);
    return imported.added > 0 || imported.updated > 0;
  } catch (error) {
    if (!silent) {
      updateProgressItem(0, "失败", error.message || "导入本机授权失败");
      finishProgress(error.message || "导入本机授权失败。");
    }
    if (!silent) toast(error.message || "导入本机授权失败。");
    return false;
  } finally {
    state.autoImportingLocalAuth = false;
  }
}

function legacyCacheImportUrl() {
  if (!state.helperBase) return "";
  return `${state.helperBase}/migrate-cache?target=${encodeURIComponent(window.location.origin)}`;
}

async function migrateLegacyCache() {
  if (!state.helperReady) await checkHelper();
  if (!state.helperReady) {
    toast("Helper 未连接，不能迁移旧缓存。");
    return;
  }
  const popup = window.open(legacyCacheImportUrl(), "codexLegacyCacheMigrator", "width=520,height=420");
  if (!popup) toast("浏览器拦截了迁移窗口，请允许弹窗后重试。");
}

function isTrustedLegacyOrigin(origin) {
  if (!origin) return false;
  const helperOrigin = state.helperBase ? new URL(state.helperBase).origin : "";
  if (origin === helperOrigin) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost):18\d{3}$/.test(origin) || origin === "http://127.0.0.1:8766";
}

async function handleLegacyCacheMessage(event) {
  if (!isTrustedLegacyOrigin(event.origin)) return;
  const data = event.data || {};
  if (data.type !== "codex-plus-legacy-cache") return;
  if (data.error) {
    toast(`旧缓存读取失败：${data.error}`);
    return;
  }
  const store = data.store || {};
  const accounts = Array.isArray(store.accounts) ? store.accounts : [];
  if (!accounts.length) {
    toast("没有在旧浏览器缓存里找到账号池。");
    return;
  }
  const normalized = accounts.map((account) => normalizeLocalAccount({
    ...account,
    usageNote: account.usageNote || "从旧本地缓存迁移",
  }));
  const result = upsertLocalAccounts(normalized);
  await maybeAutoUpload();
  toast(`旧缓存迁移完成：新增 ${result.added}，更新 ${result.updated}。`);
}

function syncStats() {
  const localKeys = new Set(state.localAccounts.map(accountDedupeKey));
  const duplicate = state.cloudAccounts.filter((account) => localKeys.has(accountDedupeKey(account))).length;
  return {
    local: state.localAccounts.length,
    cloud: state.cloudAccounts.length,
    duplicate,
  };
}

function openSyncModal() {
  if (!state.user) return;
  const stats = syncStats();
  $("syncStats").innerHTML = `
    <div><span>本地账号</span><strong>${stats.local}</strong></div>
    <div><span>云端账号</span><strong>${stats.cloud}</strong></div>
    <div><span>重复账号</span><strong>${stats.duplicate}</strong></div>
  `;
  openModal("syncModal");
}

async function mergeAndSync() {
  const cloudByKey = new Map(state.cloudAccounts.map((account) => [accountDedupeKey(account), account]));
  const merged = [];
  for (const local of state.localAccounts) {
    const cloud = cloudByKey.get(accountDedupeKey(local));
    merged.push(cloud ? mergeAccount(local, cloud) : local);
    if (cloud) cloudByKey.delete(accountDedupeKey(local));
  }
  for (const cloud of cloudByKey.values()) merged.push(cloud);
  state.localAccounts = merged.map((account) => normalizeLocalAccount(account));
  setSyncMode("merge");
  saveLocalStore();
  await uploadLocalToCloud();
  closeModal("syncModal");
  toast("已合并本地与云端账号池。");
}

function useLocalOnly() {
  setSyncMode("local-only");
  closeModal("syncModal");
  toast("已保持本地优先，不上传本机账号池。");
}

function overwriteLocalFromCloud() {
  state.localAccounts = state.cloudAccounts.map((account) => normalizeLocalAccount({
    ...account,
    id: account.id,
    cloudId: account.cloudId,
    cloudOnly: true,
  }));
  setSyncMode("cloud");
  saveLocalStore();
  closeModal("syncModal");
  render();
  toast("已用云端账号池覆盖本地缓存。");
}

function openModal(id) {
  const modal = $(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const modal = $(id);
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function setDrawer(open) {
  $("importDrawer").classList.toggle("open", open);
  $("importDrawer").setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    $("importResult").hidden = true;
    refreshOauthAuthorizeUrl().catch(() => toast("OAuth 授权链接生成失败。"));
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  $("authTitle").textContent = "登录或注册";
  $("authCopy").textContent = isRegister
    ? "创建云账户后，本地账号池仍需你确认才会上传。"
    : "登录后可把本地账号池同步到云端，并在其他设备继续使用。";
  $("authSubmitBtn").textContent = isRegister ? "创建并继续" : "继续";
  $("toggleAuthModeBtn").textContent = isRegister ? "已有账号？登录" : "没有账号？创建一个";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  try {
    const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(path, { method: "POST", body: { email, password } });
    localStorage.setItem(cachedEmailStorage, email);
    state.user = result.user;
    closeModal("authModal");
    await loadCloudData();
    await registerDevice();
    render();
    openSyncModal();
    toast(state.authMode === "register" ? "云账号已创建。" : "已登录。");
  } catch (error) {
    toast(error.message || "登录失败。");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Local mode still continues.
  }
  state.user = null;
  state.cloudAccounts = [];
  state.audit = [];
  state.adminSummary = null;
  state.adminUsers = [];
  state.adminAudit = [];
  if (state.currentView === "admin") switchView("accounts");
  render();
  toast("已退出云账号，本地账号池仍可使用。");
}

function initDeviceKey() {
  let key = localStorage.getItem(deviceKeyStorage);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(deviceKeyStorage, key);
  }
  state.deviceKey = key;
}

async function rotateDeviceKey() {
  const key = crypto.randomUUID();
  localStorage.setItem(deviceKeyStorage, key);
  state.deviceKey = key;
  await registerDevice();
  render();
  toast("本机设备 Key 已重新生成。");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openLocalStatus() {
  if (!state.helperReady) {
    toast("Helper 未连接。");
    return;
  }
  window.open(state.helperBase, "_blank", "noopener,noreferrer");
}

async function changePassword(event) {
  event.preventDefault();
  if (!state.user) return;
  const currentPassword = $("currentPassword").value;
  const nextPassword = $("nextPassword").value;
  try {
    await api("/api/auth/change-password", { method: "POST", body: { currentPassword, nextPassword } });
    $("changePasswordForm").reset();
    toast("密码已修改。");
  } catch (error) {
    toast(error.message || "修改密码失败。");
  }
}

async function handleAdminAction(action, id, dataset) {
  try {
    if (action === "toggle-status") {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status: dataset.status === "active" ? "disabled" : "active" },
      });
      $("adminMessage").hidden = false;
      $("adminMessage").textContent = dataset.status === "active" ? "用户已停用。" : "用户已启用。";
      toast("用户状态已更新。");
    }
    if (action === "toggle-role") {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { role: dataset.role === "admin" ? "user" : "admin" },
      });
      $("adminMessage").hidden = false;
      $("adminMessage").textContent = dataset.role === "admin" ? "用户已调整为普通用户。" : "用户已调整为管理员。";
      toast("用户角色已更新。");
    }
    if (action === "reset-password") {
      const result = await api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: "POST" });
      $("adminMessage").hidden = false;
      $("adminMessage").textContent = `临时密码：${result.temporaryPassword}`;
    }
    if (action === "kick") {
      await api(`/api/admin/users/${encodeURIComponent(id)}/sessions`, { method: "DELETE" });
      $("adminMessage").hidden = false;
      $("adminMessage").textContent = "该用户的在线会话已清理。";
      toast("已踢下线。");
    }
    await loadAdminData();
  } catch (error) {
    toast(error.message || "管理员操作失败。");
  }
}

async function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  state.localAccounts = state.localAccounts.filter((item) => item.id !== account.localId && item.id !== account.id && accountDedupeKey(item) !== accountDedupeKey(account));
  if (state.user && account.cloudId) {
    await api(`/api/accounts/${encodeURIComponent(account.cloudId)}`, { method: "DELETE" }).catch(() => {});
    await loadCloudData();
  }
  if (state.selectedId === id) state.selectedId = state.accounts[0]?.id || null;
  saveLocalStore();
  render();
  toast("账号已删除。");
}

function selectedBulkAccounts() {
  const ids = state.selectedBulkIds;
  return state.accounts.filter((account) => ids.has(account.id));
}

function setBulkSelection(accounts) {
  state.selectedBulkIds = new Set(accounts.map((account) => account.id));
  saveLocalStore();
  renderAccounts();
}

async function bulkDeleteAccounts() {
  const accounts = selectedBulkAccounts();
  if (!accounts.length) return;
  const invalid = accounts.filter(isInvalidAccount).length;
  const normal = accounts.length - invalid;
  if (!confirm(`确认删除 ${accounts.length} 个账号？其中失效 ${invalid} 个，正常 ${normal} 个。`)) return;
  for (const account of accounts) {
    state.localAccounts = state.localAccounts.filter((item) => item.id !== account.localId && item.id !== account.id && accountDedupeKey(item) !== accountDedupeKey(account));
    if (state.user && account.cloudId) {
      await api(`/api/accounts/${encodeURIComponent(account.cloudId)}`, { method: "DELETE" }).catch(() => {});
    }
  }
  state.selectedBulkIds.clear();
  if (state.user) await loadCloudData().catch(() => {});
  saveLocalStore();
  render();
  toast(`已删除 ${accounts.length} 个账号。`);
}

async function bulkRefreshAccounts() {
  const accounts = selectedBulkAccounts().filter(canUseAccount);
  if (!accounts.length || !state.helperReady) return;
  startProgress("批量刷新额度", accounts.map((account) => ({ label: account.name || account.email, status: "等待" })));
  let ok = 0;
  for (let index = 0; index < accounts.length; index++) {
    updateProgressItem(index, "刷新中");
    const success = await refreshAccountUsage(accounts[index].id, { silent: true });
    if (success) {
      ok++;
      updateProgressItem(index, "已完成");
    } else {
      updateProgressItem(index, "失败");
    }
  }
  finishProgress(`额度刷新完成：${ok}/${accounts.length}`);
}

function bulkExportAccounts() {
  const accounts = selectedBulkAccounts();
  if (!accounts.length) return;
  downloadText(`codex-dock-selected-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
    version: 5,
    exportedAt: new Date().toISOString(),
    accounts: accounts.map(accountForStorage),
  }, null, 2));
  toast(`已导出 ${accounts.length} 个账号。`);
}

async function bulkSetPriority(priority) {
  const accounts = selectedBulkAccounts();
  if (!accounts.length || !priority) return;
  for (const account of accounts) {
    const next = { ...account, priority, updatedAt: new Date().toISOString() };
    updateLocalAccount(next);
    if (state.user && account.cloudId) {
      await api(`/api/accounts/${encodeURIComponent(account.cloudId)}`, {
        method: "PATCH",
        body: { priority },
      }).catch(() => {});
    }
  }
  if (state.user) await loadCloudData().catch(() => {});
  render();
  toast(`已更新 ${accounts.length} 个账号的偏好。`);
}

function activateSettingsTab(tab) {
  state.settingsTab = tab;
  document.querySelectorAll("[data-settings-tab]").forEach((el) => el.classList.toggle("active", el.dataset.settingsTab === tab));
  document.querySelectorAll(".settings-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
}

async function showAdminUserSummary(id) {
  try {
    const [summary, accounts] = await Promise.all([
      api(`/api/admin/users/${encodeURIComponent(id)}/summary`),
      api(`/api/admin/users/${encodeURIComponent(id)}/accounts`),
    ]);
    const detail = summary.summary;
    if (!detail) return;
    $("adminMessage").hidden = false;
    $("adminMessage").innerHTML = `
      <strong>${escapeHtml(detail.user.email)}</strong>
      <span>账号 ${detail.accountCount} · 会话 ${detail.sessionCount} · 设备 ${detail.deviceCount}</span>
      <span>最近账号：${(accounts.accounts || []).slice(0, 5).map((account) => escapeHtml(account.email || account.name)).join("、") || "无"}</span>
    `;
  } catch (error) {
    toast(error.message || "用户详情加载失败。");
  }
}

async function adminBulkAction(action) {
  const ids = [...state.selectedAdminUserIds];
  if (!ids.length) return;
  if (!confirm(`确认对 ${ids.length} 个用户执行此操作？`)) return;
  for (const id of ids) {
    if (action === "disable") await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "disabled" } }).catch(() => {});
    if (action === "enable") await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "active" } }).catch(() => {});
    if (action === "kick") await api(`/api/admin/users/${encodeURIComponent(id)}/sessions`, { method: "DELETE" }).catch(() => {});
  }
  state.selectedAdminUserIds.clear();
  await loadAdminData();
  toast("批量操作完成。");
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });
  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.toggle).classList.toggle("collapsed"));
  });
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => activateSettingsTab(button.dataset.settingsTab));
  });

  $("authForm").addEventListener("submit", handleAuthSubmit);
  $("toggleAuthModeBtn").addEventListener("click", () => setAuthMode(state.authMode === "login" ? "register" : "login"));
  $("collapseSidebarBtn").addEventListener("click", toggleSidebar);
  $("userMenuBtn").addEventListener("click", () => state.user ? openModal("settingsModal") : openModal("authModal"));
  $("sidebarLoginBtn").addEventListener("click", () => state.user ? openModal("settingsModal") : openModal("authModal"));
  $("sidebarSettingsBtn").addEventListener("click", () => openModal("settingsModal"));
  $("openSettingsNav").addEventListener("click", () => openModal("settingsModal"));
  $("settingsAccountState").addEventListener("click", (event) => {
    if (event.target.closest("#logoutInlineBtn")) logout();
    if (event.target.closest("#loginInlineBtn")) openModal("authModal");
  });
  $("changePasswordForm").addEventListener("submit", changePassword);

  $("mergeSyncBtn").addEventListener("click", mergeAndSync);
  $("localOnlyBtn").addEventListener("click", useLocalOnly);
  $("cloudOverwriteBtn").addEventListener("click", overwriteLocalFromCloud);

  $("openImportBtn").addEventListener("click", () => setDrawer(true));
  $("settingsImportBtn").addEventListener("click", () => setDrawer(true));
  $("closeImportBtn").addEventListener("click", () => setDrawer(false));
  $("drawerBackdrop").addEventListener("click", () => setDrawer(false));
  document.querySelectorAll("[data-import-mode]").forEach((button) => {
    button.addEventListener("click", () => setImportMode(button.dataset.importMode));
  });
  $("pickJsonBtn").addEventListener("click", () => $("jsonFileInput").click());
  $("openOauthAuthBtn").addEventListener("click", () => handleAuthAcquireAction("open-oauth-login"));
  $("copyOauthUrlBtn").addEventListener("click", () => handleAuthAcquireAction("copy-oauth-url"));
  $("parseOauthCallbackBtn").addEventListener("click", parseOauthCallbackToPreview);
  $("previewImportBtn").addEventListener("click", parseImportTextToPreview);
  $("jsonFileInput").addEventListener("change", async () => {
    await parseImportFilesToPreview($("jsonFileInput").files);
  });
  $("confirmImportBtn").addEventListener("click", confirmPendingImport);
  $("finishImportBtn").addEventListener("click", () => setDrawer(false));
  $("clearFormBtn").addEventListener("click", clearImportWorkflow);
  $("accountForm").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-auth-action]");
    if (!button) return;
    await handleAuthAcquireAction(button.dataset.authAction);
  });

  $("importLocalAuthBtn").addEventListener("click", importCurrentLocalAuth);
  $("smartSettingsBtn").addEventListener("click", () => {
    openModal("settingsModal");
    activateSettingsTab("smart");
  });
  $("accountSearchInput").addEventListener("input", (event) => {
    state.accountSearch = event.target.value;
    renderAccounts();
  });
  $("accountSortSelect").addEventListener("change", (event) => {
    state.accountSort = event.target.value;
    saveLocalStore();
    renderAccounts();
  });
  for (const [id, key] of Object.entries({ filterPlan: "plan", filterToken: "token", filterUsage: "usage", filterStatus: "status" })) {
    $(id).addEventListener("change", (event) => {
      state.accountFilters[key] = event.target.value;
      state.selectedBulkIds.clear();
      saveLocalStore();
      renderAccounts();
    });
  }
  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.accountLayout = button.dataset.layout;
      saveLocalStore();
      renderAccounts();
    });
  });
  $("selectAllFilteredBtn").addEventListener("click", () => setBulkSelection(visibleAccounts()));
  $("selectInvalidBtn").addEventListener("click", () => setBulkSelection(visibleAccounts().filter(isInvalidAccount)));
  $("bulkRefreshBtn").addEventListener("click", bulkRefreshAccounts);
  $("bulkExportBtn").addEventListener("click", bulkExportAccounts);
  $("bulkDeleteBtn").addEventListener("click", bulkDeleteAccounts);
  $("bulkPrioritySelect").addEventListener("change", async (event) => {
    await bulkSetPriority(event.target.value);
    event.target.value = "";
  });
  $("smartSettingsState").addEventListener("change", (event) => {
    const autoInput = event.target.closest("[data-auto-switch-setting]");
    if (autoInput) {
      const key = autoInput.dataset.autoSwitchSetting;
      const value = autoInput.type === "checkbox" ? autoInput.checked : Number(autoInput.value);
      state.autoSwitchSettings[key] = value;
      saveLocalStore();
      saveAutoSwitchSettings({ [key]: value });
      return;
    }
    const input = event.target.closest("[data-smart-setting]");
    if (!input) return;
    const key = input.dataset.smartSetting;
    state.smartSwitchSettings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    saveLocalStore();
    render();
  });
  $("smartSettingsState").addEventListener("click", async (event) => {
    if (event.target.closest("#authorizeAutoSwitchBtn")) {
      await authorizeAutoSwitchHelper();
    }
    if (event.target.closest("#revokeAutoSwitchBtn")) {
      await revokeAutoSwitchHelper();
    }
  });
  $("commandShell").addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    $("commandShell").classList.add("drag-over");
  });
  $("commandShell").addEventListener("dragleave", (event) => {
    if (!$("commandShell").contains(event.relatedTarget)) $("commandShell").classList.remove("drag-over");
  });
  $("commandShell").addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    $("commandShell").classList.remove("drag-over");
    setCommandFiles(event.dataTransfer.files);
  });
  $("commandAttachments").addEventListener("click", (event) => {
    const button = event.target.closest("[data-attachment-index]");
    if (!button) return;
    state.commandFiles.splice(Number(button.dataset.attachmentIndex), 1);
    renderCommandAttachments();
    renderShellState();
  });
  $("refreshHelperBtn").addEventListener("click", checkHelper);
  $("settingsRefreshHelperBtn").addEventListener("click", checkHelper);
  $("devicePanel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-codex-proxy-action]");
    if (!button) return;
    configureCodexProxy(button.dataset.codexProxyAction);
  });
  $("rotateDeviceKeyBtn").addEventListener("click", rotateDeviceKey);
  $("openLocalStatusBtn").addEventListener("click", openLocalStatus);
  $("settingsOpenLocalStatusBtn").addEventListener("click", openLocalStatus);
  $("migrateLegacyCacheBtn").addEventListener("click", migrateLegacyCache);
  $("pullCloudLocalBtn").addEventListener("click", pullCloudToLocal);
  $("backupCloudState").addEventListener("change", async (event) => {
    const input = event.target.closest("#autoBackupCloudToggle");
    if (!input) return;
    setSyncMode(input.checked ? "merge" : "local-only");
    render();
    if (input.checked) {
      await uploadLocalToCloud();
      toast("已开启自动备份到云端。");
    } else {
      toast("已关闭自动备份。");
    }
  });
  $("refreshAllUsageBtn").addEventListener("click", refreshAllUsage);
  $("quickSwitchBtn").addEventListener("click", parseCommandFilesToPreview);
  $("switchBtn").addEventListener("click", applySelectedAccount);
  $("copyAuthBtn").addEventListener("click", async () => {
    const account = selectedAccount();
    if (!account) return;
    try {
      const authJson = await fetchSwitchPayload(account, false);
      await navigator.clipboard.writeText(JSON.stringify(authJson, null, 2));
      toast("auth payload 已复制。");
    } catch (error) {
      toast(error.message || "复制失败。");
    }
  });
  $("selectedAccountPanel").addEventListener("click", async (event) => {
    const authButton = event.target.closest("[data-auth-action]");
    if (authButton) {
      await handleAuthAcquireAction(authButton.dataset.authAction);
      return;
    }
    const copyEmailButton = event.target.closest("[data-selected-action='copy-email']");
    if (copyEmailButton) {
      await navigator.clipboard.writeText(copyEmailButton.dataset.email || "");
      toast("邮箱已复制。");
      return;
    }
    const button = event.target.closest("[data-selected-action='save-details']");
    if (button) await saveSelectedDetails();
  });
  $("progressCloseBtn").addEventListener("click", () => closeModal("progressModal"));
  $("clearAuditBtn").addEventListener("click", async () => {
    await loadCloudData();
    toast("运行记录已刷新。");
  });
  $("adminUserSearch").addEventListener("input", debounce((event) => {
    state.adminFilters.userQuery = event.target.value;
    loadAdminData();
  }, 250));
  $("adminRoleFilter").addEventListener("change", (event) => {
    state.adminFilters.role = event.target.value;
    loadAdminData();
  });
  $("adminStatusFilter").addEventListener("change", (event) => {
    state.adminFilters.status = event.target.value;
    loadAdminData();
  });
  $("adminAuditSearch").addEventListener("input", debounce((event) => {
    state.adminFilters.auditQuery = event.target.value;
    loadAdminData();
  }, 250));
  $("adminAuditActionFilter").addEventListener("change", (event) => {
    state.adminFilters.auditAction = event.target.value;
    loadAdminData();
  });
  $("adminSelectAllBtn").addEventListener("click", () => {
    state.selectedAdminUserIds = new Set(state.adminUsers.map((user) => user.id));
    renderAdmin();
  });
  $("adminBulkDisableBtn").addEventListener("click", () => adminBulkAction("disable"));
  $("adminBulkEnableBtn").addEventListener("click", () => adminBulkAction("enable"));
  $("adminBulkKickBtn").addEventListener("click", () => adminBulkAction("kick"));

  document.querySelector('.segmented[aria-label="账号筛选"]').addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.accountFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((el) => el.classList.toggle("active", el === button));
    state.selectedBulkIds.clear();
    saveLocalStore();
    renderAccounts();
  });

  $("accountGrid").addEventListener("click", async (event) => {
    const checkbox = event.target.closest("[data-bulk-id]");
    if (checkbox) {
      event.stopPropagation();
      if (checkbox.checked) state.selectedBulkIds.add(checkbox.dataset.bulkId);
      else state.selectedBulkIds.delete(checkbox.dataset.bulkId);
      saveLocalStore();
      renderAccounts();
      return;
    }
    const button = event.target.closest("button");
    if (button) {
      const id = button.dataset.id;
      if (button.dataset.accountAction === "switch") {
        state.selectedId = id;
        saveLocalStore();
        render();
        await applySelectedAccount();
      }
      if (button.dataset.accountAction === "refresh-usage") await refreshAccountUsage(id);
      if (button.dataset.accountAction === "delete") await deleteAccount(id);
      return;
    }
    const row = event.target.closest(".account-row[data-id], .account-card[data-id]");
    if (row) {
      state.selectedId = row.dataset.id;
      saveLocalStore();
      render();
      openModal("accountDetailModal");
    }
  });

  $("exportLocalBtn").addEventListener("click", () => {
    downloadText(`codex-dock-local-store-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
      version: 5,
      exportedAt: new Date().toISOString(),
      accounts: state.localAccounts.map(accountForStorage),
    }, null, 2));
  });
  $("clearLocalBtn").addEventListener("click", () => {
    state.localAccounts = [];
    state.selectedId = null;
    saveLocalStore();
    render();
    toast("本地缓存已清空。");
  });
  $("goAdminBtn").addEventListener("click", () => {
    closeModal("settingsModal");
    switchView("admin");
  });
  $("refreshAdminBtn").addEventListener("click", loadAdminData);
  $("adminUsers").addEventListener("click", async (event) => {
    const checkbox = event.target.closest("[data-admin-user-select]");
    if (checkbox) {
      if (checkbox.checked) state.selectedAdminUserIds.add(checkbox.dataset.adminUserSelect);
      else state.selectedAdminUserIds.delete(checkbox.dataset.adminUserSelect);
      renderAdmin();
      return;
    }
    const button = event.target.closest("button[data-admin-action]");
    if (!button) return;
    if (button.dataset.adminAction === "user-summary") {
      await showAdminUserSummary(button.dataset.id);
      return;
    }
    await handleAdminAction(button.dataset.adminAction, button.dataset.id, button.dataset);
  });
}

function init() {
  initDeviceKey();
  loadLocalStore();
  window.addEventListener("message", handleLegacyCacheMessage);
  bindEvents();
  setAuthMode("login");
  $("authEmail").value = localStorage.getItem(cachedEmailStorage) || "";
  render();
  checkHelper();
  window.setInterval(refreshHelperRuntimeStatus, 3000);
  loadMe();
}

init();
