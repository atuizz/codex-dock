const localStoreKey = "codex-local-store-v5";
const previousStoreKey = "codex-local-store-v4";
const legacyStoreKey = "codex-account-switcher-store-v3";
const deviceKeyStorage = "codex-dock-device-key-v1";
const previousDeviceKeyStorage = "codex-plus-device-key-v1";
const cachedEmailStorage = "codex-dock-email-v1";
const previousCachedEmailStorage = "codex-cloud-console-email-v1";
const chatgptLoginUrl = "https://chatgpt.com/auth/login";
const chatgptSessionUrl = "https://chatgpt.com/api/auth/session";
const codexLoginCommand = "codex login";
const oauthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const oauthRedirectUri = "http://localhost:1455/auth/callback";
const oauthPkceStorage = "codex-dock-oauth-pkce-v1";
const oauthPkceHistoryStorage = "codex-dock-oauth-pkce-history-v1";
const oauthFlowDurationMs = 3 * 60 * 1000;
const { auditTitle, auditDescription } = window.CodexAuditCore;
const {
  escapeHtml,
  shortId,
  formatTime,
  formatRefreshTime,
  formatResetTime,
  planLabel,
  planClass,
  formatTokenTime,
  formatBytes,
  errorSeverity,
} = window.CodexFormatCore;
if (!window.CodexSettingsUi) {
  throw new Error("CodexSettingsUi 未加载，请检查 settings-ui.js。");
}
const settingsUi = window.CodexSettingsUi.createSettingsUi({ escapeHtml });
if (!window.CodexAccountListUi) {
  throw new Error("CodexAccountListUi 未加载，请检查 account-list-ui.js。");
}
if (!window.CodexAccountDetailUi) {
  throw new Error("CodexAccountDetailUi 未加载，请检查 account-detail-ui.js。");
}
if (!window.CodexAdminUi) {
  throw new Error("CodexAdminUi 未加载，请检查 admin-ui.js。");
}
if (!window.CodexPanelsUi) {
  throw new Error("CodexPanelsUi 未加载，请检查 panels-ui.js。");
}
if (!window.CodexProgressUi) {
  throw new Error("CodexProgressUi 未加载，请检查 progress-ui.js。");
}
if (!window.CodexShellUi) {
  throw new Error("CodexShellUi 未加载，请检查 shell-ui.js。");
}
if (!window.CodexDialogUi) {
  throw new Error("CodexDialogUi 未加载，请检查 dialog-ui.js。");
}
if (!window.CodexOauthCore) {
  throw new Error("CodexOauthCore 未加载，请检查 oauth-core.js。");
}
const oauthCore = window.CodexOauthCore;

const defaultAccountFilters = {
  plan: "all",
  token: "all",
  usage: "all",
  status: "all",
};

const defaultSmartSwitchSettings = {
  paidOnly: true,
  preferRt: true,
  allowAt: false,
  showExperimentalAt: false,
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

const defaultUsageRefreshSettings = {
  usageRefreshMode: "helper",
  cloudUsageRefreshEnabled: false,
  helperFallbackToCloud: false,
  usageRefreshConcurrency: 1,
  usageRefreshIntervalMs: 1500,
  lastUsageRefreshSource: "",
  lastUsageRefreshAt: "",
};
const minimumHelperVersion = "0.4.2";

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
  accountHealthFilter: "all",
  accountFilters: { ...defaultAccountFilters },
  accountSort: "updated",
  accountLayout: "list",
  selectedBulkIds: new Set(),
  cleanupPendingIds: [],
  smartSwitchSettings: { ...defaultSmartSwitchSettings },
  autoSwitchSettings: { ...defaultAutoSwitchSettings },
  usageRefreshSettings: { ...defaultUsageRefreshSettings },
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
  importMode: "oauth",
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
  oauthCallbackPoll: null,
  lastOauthCallbackUrl: "",
  oauthFlowTimer: null,
  oauthFlow: {
    active: false,
    phase: "idle",
    state: "",
    authUrl: "",
    startedAt: 0,
    expiresAt: 0,
    error: "",
    summary: "",
  },
};

const $ = (id) => document.getElementById(id);
if (!window.CodexAccountCore) {
  throw new Error("CodexAccountCore 未加载，请检查 account-core.js。");
}
const {
  decodeJwtPayload,
  bestPlan,
  explainError,
  normalizeUsage,
  newestUsage,
  parseImportEntries,
  parseSession,
  authFingerprint,
  accountDedupeKey,
  hasUsableRefreshToken,
  accessTokenExpiry,
  accountPlan,
  normalizeLocalAccount,
  normalizeCloudAccount,
} = window.CodexAccountCore;
if (!window.CodexImportCore) {
  throw new Error("CodexImportCore 未加载，请检查 import-core.js。");
}
const {
  importStatusClass,
  importIdentityKeys,
  buildPendingImportItems: buildPendingImportItemsCore,
  normalizePendingImportStatuses: normalizePendingImportStatusesCore,
  summarizeImportPreview,
  accountToImportPayload,
  findImportedAccounts,
  previewImportEntries,
  hasUsageSnapshot,
} = window.CodexImportCore.createImportCore({
  accountCore: window.CodexAccountCore,
  formatCore: window.CodexFormatCore,
  tokenState,
});
if (!window.CodexImportUi) {
  throw new Error("CodexImportUi 未加载，请检查 import-ui.js。");
}
if (!window.CodexPlatformClients) {
  throw new Error("CodexPlatformClients 未加载，请检查 platform-clients.js。");
}
const {
  createCloudApiClient,
  createHelperClient,
  helperBaseCandidates,
  isKnownHelperHealth,
} = window.CodexPlatformClients;
const cloudApi = createCloudApiClient();
const api = (path, options = {}) => cloudApi.request(path, options);
const accountListUi = window.CodexAccountListUi.createAccountListUi({
  formatCore: window.CodexFormatCore,
  escapeHtml,
  shortId,
  formatRefreshTime,
  planLabel,
  planClass,
  errorSeverity,
  explainError,
  accountPlan,
  tokenState,
  usageIssue,
  accountActionMode,
  sourceLabel,
});
const accountDetailUi = window.CodexAccountDetailUi.createAccountDetailUi({
  formatCore: window.CodexFormatCore,
  escapeHtml,
  shortId,
  formatTime,
  formatResetTime,
  planLabel,
  planClass,
  errorSeverity,
  explainError,
  accountPlan,
  tokenState,
  usageIssue,
  canUseAccount,
  sourceLabel,
});
const adminUi = window.CodexAdminUi.createAdminUi({
  formatCore: window.CodexFormatCore,
  auditCore: window.CodexAuditCore,
  escapeHtml,
  shortId,
  formatTime,
  auditTitle,
  auditDescription,
});
const panelsUi = window.CodexPanelsUi.createPanelsUi({
  formatCore: window.CodexFormatCore,
  auditCore: window.CodexAuditCore,
  escapeHtml,
  formatTime,
  auditTitle,
  auditDescription,
});
const progressUi = window.CodexProgressUi.createProgressUi({
  escapeHtml,
});
const shellUi = window.CodexShellUi.createShellUi({
  formatCore: window.CodexFormatCore,
  escapeHtml,
  formatBytes,
  cloudBackupEnabled,
  canUseAccount,
  resolveCurrentAccountId,
  accountPlan,
  tokenState,
});
const dialogUi = window.CodexDialogUi.createDialogUi({
  escapeHtml,
});
const importUi = window.CodexImportUi.createImportUi({
  formatCore: window.CodexFormatCore,
  escapeHtml,
  shortId,
  importStatusClass,
  summarizeImportPreview,
});

function helperClient() {
  return createHelperClient(state.helperBase);
}

function helperAuthorizedForCurrentConsole(helper = state.helperInfo) {
  const autoSwitch = helper?.auto_switch || helper?.autoSwitch || {};
  if (!autoSwitch.authorized || !autoSwitch.cloud_base) return false;
  try {
    return new URL(autoSwitch.cloud_base).origin === window.location.origin;
  } catch {
    return false;
  }
}

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
  el.innerHTML = importUi.renderImportResult(result);
  renderImportPreview();
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function oauthFlowView(flow = state.oauthFlow) {
  const now = Date.now();
  const remaining = Math.max(0, Number(flow.expiresAt || 0) - now);
  const elapsed = Math.max(0, now - Number(flow.startedAt || now));
  const total = Math.max(1, Number(flow.expiresAt || 0) - Number(flow.startedAt || 0));
  const waitProgress = Math.min(42, Math.max(4, Math.round((elapsed / total) * 42)));
  const phase = flow.phase || "idle";
  const views = {
    opening: {
      iconClass: "busy",
      title: "正在打开授权页面",
      detail: "请在新打开的浏览器页面完成登录授权。",
      hint: "本页正在监听授权回调。",
      busy: true,
      progress: 8,
      showCountdown: true,
      showCancel: true,
      showRetry: false,
      showDone: false,
    },
    waiting: {
      iconClass: "busy",
      title: "等待授权中",
      detail: "请在新打开的浏览器页面完成登录。授权完成后，本页会自动接收回调。",
      hint: "完成后会自动换取 RT 并导入账号。",
      busy: true,
      progress: waitProgress,
      showCountdown: true,
      showCancel: true,
      showRetry: true,
      showDone: false,
    },
    received: {
      iconClass: "busy",
      title: "已收到授权回调",
      detail: "正在校验授权结果。",
      hint: "请保持本页打开。",
      busy: true,
      progress: 55,
      showCountdown: true,
      showCancel: false,
      showRetry: false,
      showDone: false,
    },
    exchanging: {
      iconClass: "busy",
      title: "正在换取 RT",
      detail: "已收到 OAuth code，正在换取可用于 Codex 的 refresh token。",
      hint: "这一步通常只需要几秒。",
      busy: true,
      progress: 72,
      showCountdown: false,
      showCancel: false,
      showRetry: false,
      showDone: false,
    },
    importing: {
      iconClass: "busy",
      title: "正在导入账号",
      detail: "RT 已获取，正在写入账号池并同步云端。",
      hint: "导入完成后会自动刷新账号状态。",
      busy: true,
      progress: 90,
      showCountdown: false,
      showCancel: false,
      showRetry: false,
      showDone: false,
    },
    success: {
      iconClass: "success",
      title: "导入成功",
      detail: flow.summary || "账号已导入账号池，可用于 Codex。",
      hint: "可以继续导入其它账号，或关闭导入窗口。",
      busy: false,
      progress: 100,
      showCountdown: false,
      showCancel: false,
      showRetry: false,
      showDone: true,
    },
    expired: {
      iconClass: "warning",
      title: "授权等待已过期",
      detail: "本次授权监听已超过有效时间。旧回调可能无法再使用，请重新打开授权页面。",
      hint: "倒计时按真实时间计算，页面后台或系统卡顿不会延长有效期。",
      busy: false,
      progress: 100,
      showCountdown: false,
      showCancel: true,
      showRetry: true,
      showDone: false,
    },
    error: {
      iconClass: "error",
      title: "导入失败",
      detail: flow.error || "授权或导入过程中出现错误。",
      hint: "请重新打开授权页面，不要复用旧回调。",
      busy: false,
      progress: 100,
      showCountdown: false,
      showCancel: true,
      showRetry: true,
      showDone: false,
    },
  };
  return { remaining, ...(views[phase] || views.waiting) };
}

function renderOauthFlow() {
  const overlay = $("oauthFlowOverlay");
  if (!overlay) return;
  const flow = state.oauthFlow || {};
  overlay.hidden = !flow.active;
  if (!flow.active) return;
  const view = oauthFlowView(flow);
  $("oauthFlowIcon").textContent = "";
  $("oauthFlowIcon").className = `oauth-flow-icon ${view.iconClass || ""}`.trim();
  $("oauthFlowTitle").textContent = view.title;
  $("oauthFlowDetail").textContent = view.detail;
  $("oauthFlowCountdown").textContent = view.showCountdown ? `剩余 ${formatCountdown(view.remaining)}` : "";
  $("oauthFlowHint").textContent = view.hint;
  $("oauthFlowMeter").style.width = `${view.progress}%`;
  $("oauthFlowCancelBtn").hidden = !view.showCancel;
  $("oauthFlowRetryBtn").hidden = !view.showRetry;
  $("oauthFlowDoneBtn").hidden = !view.showDone;
}

function stopOauthFlowTimer() {
  if (state.oauthFlowTimer) {
    clearInterval(state.oauthFlowTimer);
    state.oauthFlowTimer = null;
  }
}

function setOauthFlow(patch = {}) {
  state.oauthFlow = { ...state.oauthFlow, ...patch };
  renderOauthFlow();
  const phase = state.oauthFlow.phase;
  if (!state.oauthFlow.active || ["success", "error", "expired"].includes(phase)) stopOauthFlowTimer();
}

function startOauthFlowTimer() {
  stopOauthFlowTimer();
  state.oauthFlowTimer = setInterval(() => {
    const flow = state.oauthFlow;
    if (!flow.active) {
      stopOauthFlowTimer();
      return;
    }
    if (["opening", "waiting"].includes(flow.phase) && Date.now() >= Number(flow.expiresAt || 0)) {
      stopOauthCallbackPolling();
      setOauthFlow({ phase: "expired" });
      return;
    }
    renderOauthFlow();
  }, 1000);
  renderOauthFlow();
}

function cancelOauthFlow(options = {}) {
  stopOauthCallbackPolling();
  stopOauthFlowTimer();
  state.oauthFlow = {
    active: false,
    phase: "idle",
    state: "",
    authUrl: "",
    startedAt: 0,
    expiresAt: 0,
    error: "",
    summary: "",
  };
  renderOauthFlow();
  if (!options.silent) toast("已取消 OAuth 导入。");
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

function isFreshOauthPkce(payload) {
  return Boolean(payload?.verifier && payload?.state && Date.now() - Number(payload.createdAt || 0) < 30 * 60 * 1000);
}

function readOauthPkceHistory() {
  const history = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(oauthPkceHistoryStorage) || "{}");
    for (const [key, payload] of Object.entries(parsed || {})) {
      if (isFreshOauthPkce(payload)) history[key] = payload;
    }
  } catch {
    // Ignore broken cache; a fresh authorization link will rebuild it.
  }
  try {
    const current = JSON.parse(localStorage.getItem(oauthPkceStorage) || "{}");
    if (isFreshOauthPkce(current)) history[current.state] = current;
  } catch {
    // Ignore legacy cache parse errors.
  }
  return history;
}

function writeOauthPkceHistory(history) {
  const fresh = Object.values(history || {})
    .filter(isFreshOauthPkce)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 12)
    .reduce((acc, payload) => {
      acc[payload.state] = payload;
      return acc;
    }, {});
  localStorage.setItem(oauthPkceHistoryStorage, JSON.stringify(fresh));
}

function rememberOauthPkce(verifier, stateValue, authUrl = state.oauthAuthUrl || "") {
  const payload = { verifier, state: stateValue, redirectUri: oauthRedirectUri, clientId: oauthClientId, createdAt: Date.now(), authUrl };
  state.oauthCodeVerifier = verifier;
  state.oauthState = stateValue;
  localStorage.setItem(oauthPkceStorage, JSON.stringify(payload));
  const history = readOauthPkceHistory();
  history[stateValue] = payload;
  writeOauthPkceHistory(history);
}

function oauthPkce(stateValue = "") {
  if (stateValue) return readOauthPkceHistory()[stateValue] || {};
  try {
    const payload = JSON.parse(localStorage.getItem(oauthPkceStorage) || "{}");
    if (isFreshOauthPkce(payload)) return payload;
  } catch {
    return {};
  }
  return {};
}

function forgetOauthPkce(stateValue) {
  if (!stateValue) return;
  const current = oauthPkce();
  if (current.state === stateValue) localStorage.removeItem(oauthPkceStorage);
  const history = readOauthPkceHistory();
  delete history[stateValue];
  writeOauthPkceHistory(history);
}

async function refreshOauthAuthorizeUrl(options = {}) {
  const reuse = options.reuse !== false;
  const existing = reuse ? oauthPkce() : {};
  if (existing?.verifier && existing?.state && existing?.authUrl) {
    state.oauthCodeVerifier = existing.verifier;
    state.oauthState = existing.state;
    state.oauthAuthUrl = existing.authUrl;
    if ($("oauthAuthUrl")) $("oauthAuthUrl").value = state.oauthAuthUrl;
    return state.oauthAuthUrl;
  }
  const verifier = randomBase64Url(64);
  const stateValue = randomBase64Url(18);
  const challenge = await sha256Base64Url(verifier);
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
  rememberOauthPkce(verifier, stateValue, state.oauthAuthUrl);
  if ($("oauthAuthUrl")) $("oauthAuthUrl").value = state.oauthAuthUrl;
  return state.oauthAuthUrl;
}

async function resetOauthAuthorizeUrl() {
  localStorage.removeItem(oauthPkceStorage);
  state.oauthAuthUrl = "";
  state.oauthCodeVerifier = "";
  state.oauthState = "";
  return refreshOauthAuthorizeUrl({ reuse: false });
}

async function currentOauthAuthorizeUrl(options = {}) {
  if (options.fresh) return refreshOauthAuthorizeUrl({ reuse: false });
  const current = oauthPkce();
  if (state.oauthAuthUrl && current.authUrl === state.oauthAuthUrl) return state.oauthAuthUrl;
  return refreshOauthAuthorizeUrl();
}

async function beginOauthAuthorization(options = {}) {
  setImportMode("oauth");
  const authUrl = await currentOauthAuthorizeUrl({ fresh: true });
  const pkce = oauthPkce();
  const now = Date.now();
  setOauthFlow({
    active: true,
    phase: options.copyOnly ? "waiting" : "opening",
    state: pkce.state || state.oauthState || "",
    authUrl,
    startedAt: now,
    expiresAt: now + oauthFlowDurationMs,
    error: "",
    summary: "",
  });
  startOauthFlowTimer();
  startOauthCallbackPolling();
  if (options.copyOnly) {
    await navigator.clipboard.writeText(authUrl);
    toast("授权链接已复制，本页正在等待回调。");
    return;
  }
  const popup = window.open(authUrl, "_blank");
  if (!popup) {
    setOauthFlow({
      phase: "error",
      error: "浏览器拦截了授权页面弹窗。请允许弹窗后重新打开授权页面，或复制授权链接手动打开。",
    });
    return;
  }
  setOauthFlow({ phase: "waiting" });
  toast(state.helperReady ? "授权页面已打开，本页正在等待回调。" : "授权页面已打开；Helper 未连接时可能需要手动粘贴回调。");
}

async function handleAuthAcquireAction(action) {
  if (action === "open-import-oauth-login") {
    closeModal("accountDetailModal");
    setDrawer(true, { mode: "oauth" });
    await beginOauthAuthorization();
    return;
  }
  if (action === "open-import-session" || action === "open-import-oauth" || action === "open-import-file") {
    closeModal("accountDetailModal");
    setDrawer(true, { mode: action === "open-import-file" ? "file" : (action === "open-import-oauth" ? "oauth" : "session") });
    toast(action === "open-import-file" ? "请导入该账号自己的 auth.json。" : (action === "open-import-oauth" ? "已打开 OAuth 导入。" : "已打开 Session 导入。"));
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
    toast("Codex 登录命令已复制。它会改变当前 Codex 登录态，只用于登录你要导入的目标账号。");
    return;
  }
  if (action === "open-oauth-login") {
    await beginOauthAuthorization();
    return;
  }
  if (action === "copy-oauth-url") {
    await beginOauthAuthorization({ copyOnly: true });
    return;
  }
  if (action === "sync-local-auth") {
    await importCurrentLocalAuth();
  }
}

function buildPendingImportItems(entries, sourceName) {
  return buildPendingImportItemsCore(entries, sourceName, {
    existingAccounts: state.user ? state.cloudAccounts : state.localAccounts,
  });
}

function normalizePendingImportStatuses(items) {
  return normalizePendingImportStatusesCore(items, {
    existingAccounts: state.user ? state.cloudAccounts : state.localAccounts,
  });
}

function renderImportPreview() {
  const list = $("importPreviewList");
  const summary = $("importPreviewSummary");
  const confirm = $("confirmImportBtn");
  if (!list || !summary || !confirm) return;
  const rendered = importUi.renderImportPreview(state.pendingImportItems, {
    importCompleted: state.importCompleted,
    operationActive: state.operationProgress.active,
  });
  const finish = $("finishImportBtn");
  const clear = $("clearFormBtn");
  confirm.hidden = rendered.confirmHidden;
  confirm.disabled = rendered.confirmDisabled;
  finish.hidden = rendered.finishHidden;
  finish.classList.toggle("primary", rendered.finishPrimary);
  clear.textContent = rendered.clearText;
  clear.classList.toggle("soft-action", rendered.clearSoft);
  summary.textContent = rendered.summaryText;
  list.innerHTML = rendered.listHtml;
}

function setImportMode(mode) {
  state.importMode = mode;
  document.querySelectorAll("[data-import-mode]").forEach((button) => {
    button.classList.toggle("active", importUi.modeIsActive(mode, button.dataset.importMode));
  });
  document.querySelectorAll("[data-import-panel]").forEach((panel) => {
    panel.classList.toggle("active", importUi.modeIsActive(mode, panel.dataset.importPanel));
  });
  const advancedPanel = document.querySelector(".advanced-import-panel");
  if (advancedPanel) advancedPanel.open = mode !== "oauth";
  if (mode === "oauth") refreshOauthAuthorizeUrl().catch(() => toast("OAuth 授权链接生成失败。"));
}

function clearImportWorkflow() {
  cancelOauthFlow({ silent: true });
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
  list.innerHTML = shellUi.renderCommandAttachments(state.commandFiles);
}

function renderShellState() {
  const button = $("quickSwitchBtn");
  const shell = $("commandShell");
  if (!button || !shell) return;
  const view = shellUi.commandShellState({
    files: state.commandFiles,
    accounts: state.accounts,
  });
  button.textContent = view.quickSwitchText;
  button.disabled = view.quickSwitchDisabled;
  shell.classList.toggle("has-attachments", view.hasFiles);
}

function renderToolbarState(filtered = visibleAccounts()) {
  const sort = $("accountSortSelect");
  if (sort) sort.value = state.accountSort;
  const filters = state.accountFilters || defaultAccountFilters;
  const map = { filterPlan: "plan", filterToken: "token", filterUsage: "usage", filterStatus: "status" };
  for (const [id, key] of Object.entries(map)) {
    if ($(id)) $(id).value = filters[key] || "all";
  }
  document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.accountFilter));
  document.querySelectorAll("[data-layout]").forEach((button) => button.classList.toggle("active", button.dataset.layout === state.accountLayout));
  const view = shellUi.toolbarState({
    filtered,
    selectedBulkIds: state.selectedBulkIds,
    helperReady: state.helperReady,
    canRefreshUsage: canRefreshAccountUsage,
    isInvalidAccount,
  });
  $("bulkCount").textContent = view.bulkText;
  $("bulkBar").classList.toggle("has-selection", view.hasSelection);
  $("bulkRefreshBtn").disabled = view.refreshDisabled;
  $("bulkExportBtn").disabled = view.exportDisabled;
  $("bulkDeleteBtn").disabled = view.deleteDisabled;
  $("bulkDeleteBtn").textContent = view.deleteText;
  $("bulkCleanupHint").textContent = view.cleanupHint;
  $("bulkPrioritySelect").disabled = view.priorityDisabled;
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

function normalizeOauthCallbackValue(raw) {
  return oauthCore.normalizeOauthCallbackValue(raw, oauthRedirectUri);
}

function callbackParams(raw) {
  return oauthCore.callbackParams(raw, oauthRedirectUri);
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

async function parseOauthCallbackToPreview(rawCallback = null) {
  try {
    const callbackSource = typeof rawCallback === "string" ? rawCallback : $("oauthCallbackInput").value;
    const params = callbackParams(callbackSource);
    let accessToken = params.get("access_token") || params.get("accessToken") || "";
    let idToken = params.get("id_token") || params.get("idToken") || "";
    let refreshToken = params.get("refresh_token") || params.get("refreshToken") || "";
    const code = params.get("code") || "";
    const returnedState = params.get("state") || "";
    if (state.oauthFlow.active) {
      const stateStatus = oauthCore.callbackStateStatus(params, state.oauthFlow.state || state.oauthState || "", oauthRedirectUri);
      if (!stateStatus.ok) throw new Error(stateStatus.message);
    }
    let usedOauthCode = false;
    if (!accessToken && code) {
      const pkce = returnedState ? oauthPkce(returnedState) : oauthPkce();
      if (!pkce.verifier) throw new Error("OAuth code 已收到，但找不到对应授权链接的 PKCE 记录。请点“打开授权页面”重新授权，不要复用旧回调。");
      let token;
      try {
        if (state.oauthFlow.active) setOauthFlow({ phase: "exchanging" });
        token = await exchangeOauthCode(code, pkce);
      } catch (error) {
        const reason = oauthCore.exchangeFailureMessage(error.message);
        throw new Error(`OAuth code 已收到，但换 token 失败：${reason}。请点“打开授权页面”重新授权，并使用刚打开页面返回的回调。`);
      }
      accessToken = token.access_token || token.accessToken || "";
      idToken = token.id_token || token.idToken || "";
      refreshToken = token.refresh_token || token.refreshToken || "";
      usedOauthCode = true;
      forgetOauthPkce(returnedState || pkce.state);
    }
    if (!accessToken && !idToken && !refreshToken) {
      throw new Error(oauthCore.emptyCallbackMessage(usedOauthCode));
    }
    if (state.oauthFlow.active && !refreshToken) {
      throw new Error("授权已返回 token，但没有 refresh_token，不能用于 Codex。请重新打开授权页面。");
    }
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
    return true;
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
    if (state.oauthFlow.active) setOauthFlow({ phase: "error", error: error.message || "回调解析失败" });
    return false;
  }
}

async function handleOauthCallbackUrl(url, options = {}) {
  if ($("oauthCallbackInput")) $("oauthCallbackInput").value = url;
  if (state.oauthFlow.active) setOauthFlow({ phase: "received" });
  const ok = await parseOauthCallbackToPreview(url);
  if (!ok) return false;
  toast("已自动接收 OAuth 回调。");
  if (options.autoImport) {
    if (state.oauthFlow.active) setOauthFlow({ phase: "importing" });
    try {
      const result = await performPendingImport({ throwOnError: true, source: "oauth" });
      if (result && state.oauthFlow.active) {
        const summary = `新增 ${result.added || 0} · 更新 ${result.updated || 0} · 失败 ${result.failed || 0}`;
        setOauthFlow({ phase: "success", summary });
      }
    } catch (error) {
      if (state.oauthFlow.active) setOauthFlow({ phase: "error", error: error.message || "导入失败" });
      return false;
    }
  }
  return true;
}

function stopOauthCallbackPolling() {
  if (state.oauthCallbackPoll) {
    clearInterval(state.oauthCallbackPoll);
    state.oauthCallbackPoll = null;
  }
}

async function latestOauthCallbackAny() {
  if (!state.helperReady || !state.helperBase) return null;
  try {
    return await helperClient().oauthCallbackLatest("");
  } catch {
    return null;
  }
}

function oauthCallbackMatchesActiveFlow(callbackUrl) {
  if (!state.oauthFlow.active) return true;
  const expectedState = state.oauthFlow.state || state.oauthState || "";
  if (!expectedState || !callbackUrl) return true;
  try {
    return oauthCore.callbackStateStatus(callbackUrl, expectedState, oauthRedirectUri).ok;
  } catch {
    return true;
  }
}

function rejectMismatchedOauthCallback() {
  stopOauthCallbackPolling();
  setOauthFlow({
    phase: "error",
    error: "收到的授权回调不属于当前这次登录。请重新打开授权页面，并只使用刚打开页面返回的回调。",
  });
}

function startOauthCallbackPolling() {
  stopOauthCallbackPolling();
  const flow = state.oauthFlow || {};
  const stateValue = flow.state || state.oauthState || oauthPkce().state || "";
  const startedAt = Number(flow.startedAt || Date.now());
  const expiresAt = Number(flow.expiresAt || startedAt + oauthFlowDurationMs);
  state.oauthCallbackPoll = setInterval(async () => {
    if (!state.helperReady || !state.helperBase) return;
    if (Date.now() >= expiresAt) {
      stopOauthCallbackPolling();
      if (state.oauthFlow.active && ["opening", "waiting"].includes(state.oauthFlow.phase)) {
        setOauthFlow({ phase: "expired" });
      } else {
        toast("未检测到 OAuth 回调，可手动粘贴回调链接解析。");
      }
      return;
    }
    try {
      const result = await helperClient().oauthCallbackLatest(stateValue);
      if (result?.pending) {
        const latest = await latestOauthCallbackAny();
        const receivedAt = latest?.receivedAt ? new Date(latest.receivedAt).getTime() : 0;
        if (latest && !latest.pending && latest.url && receivedAt >= startedAt - 3000) {
          if (!oauthCallbackMatchesActiveFlow(latest.url)) {
            rejectMismatchedOauthCallback();
            return;
          }
          stopOauthCallbackPolling();
          await handleOauthCallbackUrl(latest.url, { autoImport: true });
        }
        return;
      }
      stopOauthCallbackPolling();
      if (result.error) {
        setOauthFlow({ phase: "error", error: `OAuth 授权失败：${result.error}` });
        toast(`OAuth 授权失败：${result.error}`);
        return;
      }
      if (!oauthCallbackMatchesActiveFlow(result.url || `?code=${encodeURIComponent(result.code || "")}&state=${encodeURIComponent(result.state || "")}`)) {
        rejectMismatchedOauthCallback();
        return;
      }
      await handleOauthCallbackUrl(result.url || `?code=${encodeURIComponent(result.code || "")}&state=${encodeURIComponent(result.state || "")}`, { autoImport: true });
    } catch {
      stopOauthCallbackPolling();
    }
  }, 1200);
}

function isTrustedOauthCallbackOrigin(origin) {
  return origin === "http://localhost:1455" || origin === "http://127.0.0.1:1455";
}

async function handleOauthCallbackMessage(event) {
  if (!isTrustedOauthCallbackOrigin(event.origin)) return;
  const data = event.data || {};
  if (data.type !== "codex-dock-oauth-callback" || !data.url) return;
  if (state.lastOauthCallbackUrl === data.url) return;
  state.lastOauthCallbackUrl = data.url;
  if (!oauthCallbackMatchesActiveFlow(data.url)) {
    rejectMismatchedOauthCallback();
    return;
  }
  stopOauthCallbackPolling();
  try {
    event.source?.postMessage?.({ type: "codex-dock-oauth-received" }, event.origin);
  } catch {
    // Best-effort acknowledgement so the callback tab can close itself.
  }
  await handleOauthCallbackUrl(data.url, { autoImport: true });
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
  clearCommandFiles();
  setDrawer(true, { mode: "file" });
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
  if (!$("progressTitle")) return;
  const view = progressUi.renderOperationProgress(state.operationProgress);
  $("progressTitle").textContent = view.title;
  $("progressSummary").textContent = view.summary;
  $("progressMeterBar").style.width = `${view.percent}%`;
  $("progressCloseBtn").disabled = view.closeDisabled;
  $("progressList").innerHTML = view.listHtml;
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
    state.accountHealthFilter = store.accountHealthFilter || "all";
    state.accountFilters = { ...defaultAccountFilters, ...(store.accountFilters || {}) };
    state.accountSort = store.accountSort || "updated";
    state.smartSwitchSettings = { ...defaultSmartSwitchSettings, ...(store.smartSwitchSettings || {}) };
    state.autoSwitchSettings = { ...defaultAutoSwitchSettings, ...(store.autoSwitchSettings || {}) };
    state.usageRefreshSettings = { ...defaultUsageRefreshSettings, ...(store.usageRefreshSettings || {}) };
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
    accountHealthFilter: state.accountHealthFilter,
    accountFilters: state.accountFilters,
    accountSort: state.accountSort,
    smartSwitchSettings: state.smartSwitchSettings,
    autoSwitchSettings: state.autoSwitchSettings,
    usageRefreshSettings: state.usageRefreshSettings,
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

function canRefreshAccountUsage(account) {
  const settings = state.usageRefreshSettings || defaultUsageRefreshSettings;
  const cloudAvailable = Boolean(state.user && account?.cloudId && settings.cloudUsageRefreshEnabled);
  if (settings.usageRefreshMode === "helper") return state.helperReady;
  if (settings.usageRefreshMode === "cloud") return cloudAvailable;
  if (settings.usageRefreshMode === "auto") return state.helperReady || Boolean(settings.helperFallbackToCloud && cloudAvailable);
  return state.helperReady || cloudAvailable;
}

function readMigratedLocalStorage(currentKey, previousKey) {
  const current = localStorage.getItem(currentKey);
  if (current) return current;
  const previous = previousKey ? localStorage.getItem(previousKey) : "";
  if (previous) {
    localStorage.setItem(currentKey, previous);
    localStorage.removeItem(previousKey);
  }
  return previous || "";
}

function writeMigratedLocalStorage(currentKey, value, previousKey = "") {
  localStorage.setItem(currentKey, value);
  if (previousKey) localStorage.removeItem(previousKey);
}

function selectedAccount() {
  return state.accounts.find((account) => account.id === state.selectedId) || null;
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

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasAccountSecret(account) {
  return Boolean(account && (account.session?.tokens?.access_token || (state.user && account.cloudId)));
}

function experimentalAtEnabled(settings = state.smartSwitchSettings) {
  return Boolean(settings?.showExperimentalAt && settings?.allowAt);
}

function refreshTokenInvalidText(value) {
  return /(?:invalid_grant|refresh token was already used|access token could not be refreshed|could not be refreshed|rt 已失效|refresh_token 已失效)/i.test(String(value || ""));
}

function accountCredentialKind(account) {
  if (account?.credentialKind) return account.credentialKind;
  if (hasUsableRefreshToken(account)) return "rt";
  if (hasAccountSecret(account)) return "at";
  return "unknown";
}

function codexBlockReason(account, settings = state.smartSwitchSettings) {
  if (!hasAccountSecret(account)) return "missing_secret";
  const explicit = account?.codexBlockReason || "";
  const kind = accountCredentialKind(account);
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  if (kind === "rt") {
    if (explicit && explicit !== "at_unsupported" && explicit !== "rt_stale") return explicit;
    if (refreshTokenInvalidText(usage.error)) return "rt_invalid";
    return "";
  }
  if (!experimentalAtEnabled(settings)) return "at_unsupported";
  const expiry = accessTokenExpiry(account);
  if (expiry && expiry.getTime() <= Date.now()) return "token_expired";
  return "";
}

function codexBlockLabel(reason) {
  if (reason === "at_unsupported") return "不支持 Codex";
  if (reason === "rt_invalid") return "RT 已失效";
  if (reason === "token_expired") return "Token 已过期";
  if (reason === "missing_secret") return "缺少密钥";
  return "不可用";
}

function codexBlockDetail(reason) {
  if (reason === "at_unsupported") return "缺少 RT，当前不能用于 Codex，请重新登录 Codex 获取 RT。";
  if (reason === "rt_invalid") return "refresh_token 已失效或已被使用，请重新登录。";
  if (reason === "token_expired") return "access_token 已过期且没有可用 RT。";
  if (reason === "missing_secret") return "云端没有可下发的 auth 密文。";
  return "";
}

function codexUsable(account, settings = state.smartSwitchSettings) {
  return Boolean(account && hasAccountSecret(account) && !codexBlockReason(account, settings));
}

function tokenState(account) {
  if (!account) return { label: "未选择", className: "warn", score: 0, detail: "" };
  if (!hasAccountSecret(account)) {
    return { label: "无本地 token", className: "warn", score: 10, detail: "本地没有可用于切换的 auth/session 原文。" };
  }
  const block = codexBlockReason(account);
  if (block) {
    return {
      label: codexBlockLabel(block),
      className: block === "rt_invalid" || block === "token_expired" ? "bad" : "warn",
      score: block === "at_unsupported" ? 2 : 5,
      detail: codexBlockDetail(block),
    };
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
  if (!codexUsable(account, settings)) return -9999;
  if (settings.paidOnly && !isPaidPlan(account)) return -9000;
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
  reasons.push(hasUsableRefreshToken(account) ? "可用 RT" : "AT 实验");
  if (Number.isFinite(usage.five_hour?.remaining_percent)) reasons.push(`5H ${usage.five_hour.remaining_percent}%`);
  if (Number.isFinite(usage.one_week?.remaining_percent)) reasons.push(`7D ${usage.one_week.remaining_percent}%`);
  if (account.priority === "primary") reasons.push("优先使用");
  if (!account.lastSwitchAt) reasons.push("最近未切换");
  return reasons.join("、");
}

function canUseAccount(account) {
  return codexUsable(account);
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

function accountLowQuota(account) {
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  return Boolean(
    Number.isFinite(usage.five_hour?.remaining_percent) && usage.five_hour.remaining_percent <= 30
    || Number.isFinite(usage.one_week?.remaining_percent) && usage.one_week.remaining_percent <= 30
  );
}

function accountCooldownActive(account) {
  const cooldown = Number(state.smartSwitchSettings?.cooldownMinutes || defaultSmartSwitchSettings.cooldownMinutes || 0);
  if (!cooldown || !account?.lastSwitchAt) return false;
  const last = new Date(account.lastSwitchAt).getTime();
  return Number.isFinite(last) && Date.now() - last < cooldown * 60 * 1000;
}

function isInvalidAccount(account) {
  if (!hasAccountSecret(account) || codexBlockReason(account)) return true;
  if (isExpiredWithoutRt(account)) return true;
  if (usageIssue(account)) return true;
  return false;
}

function tokenFilterValue(account) {
  if (!hasAccountSecret(account)) return "missing";
  const block = codexBlockReason(account);
  if (block === "at_unsupported") return "at";
  if (block === "rt_invalid") return "expired";
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
  const block = codexBlockReason(account);
  if (block === "at_unsupported") return "update-rt";
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

function accountMatchesHealthFilter(account, key = state.accountHealthFilter) {
  if (!key || key === "all") return true;
  const block = codexBlockReason(account);
  const hasRt = hasUsableRefreshToken(account);
  const tokenFilter = tokenFilterValue(account);
  if (key === "ready-rt") return codexUsable(account) && hasRt && !usageIssue(account) && !accountLowQuota(account) && !accountCooldownActive(account);
  if (key === "missing-rt") return block === "at_unsupported" || (hasAccountSecret(account) && !hasRt && tokenFilter !== "expired");
  if (key === "rt-invalid") return block === "rt_invalid" || tokenFilter === "expired" || refreshTokenInvalidText(normalizeUsage(account?.usage, accountPlan(account)).error);
  if (key === "low-quota") return accountLowQuota(account);
  if (key === "cooldown") return accountCooldownActive(account);
  if (key === "current") return isCurrentAccount(account);
  if (key === "helper-blocked") return codexUsable(account) && !state.helperReady;
  if (key === "attention") return isInvalidAccount(account);
  return true;
}

function accountHealthGroups(accounts = state.accounts) {
  const count = (key) => accounts.filter((account) => accountMatchesHealthFilter(account, key)).length;
  return [
    { key: "all", label: "全部", count: accounts.length, className: "", description: "当前账号池" },
    { key: "ready-rt", label: "可用 RT", count: count("ready-rt"), className: "ok", description: "可直接切换" },
    { key: "missing-rt", label: "缺 RT", count: count("missing-rt"), className: "warn", description: "需重新登录" },
    { key: "rt-invalid", label: "RT/Token 失效", count: count("rt-invalid"), className: "bad", description: "需更新凭据" },
    { key: "low-quota", label: "额度低", count: count("low-quota"), className: "warn", description: "避免优先使用" },
    { key: "cooldown", label: "冷却中", count: count("cooldown"), className: "neutral", description: "等待冷却结束" },
    { key: "current", label: "当前使用", count: count("current"), className: "neutral", description: "本机 auth 匹配" },
    { key: "helper-blocked", label: "Helper 不可操作", count: count("helper-blocked"), className: state.helperReady ? "neutral" : "warn", description: "需启动 Helper" },
    { key: "attention", label: "需处理", count: count("attention"), className: "bad", description: "无法直接使用" },
  ];
}

function accountMatchesFilters(account) {
  const filters = state.accountFilters || defaultAccountFilters;
  const plan = String(accountPlan(account)).toLowerCase();
  if (!accountMatchesHealthFilter(account)) return false;
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
  const view = shellUi.shellViewModel(state);
  $("viewSubtitle").textContent = view.viewSubtitle;
  if ($("homeHeadline")) {
    $("homeHeadline").textContent = view.homeHeadline;
  }
  if ($("homeSubcopy")) {
    $("homeSubcopy").textContent = view.homeSubcopy;
  }
  $("vaultTitle").textContent = view.vaultTitle;
  $("vaultCopy").textContent = view.vaultCopy;
  $("sideCloudStatus").textContent = view.sideCloudText;
  $("sideCloudStatus").className = view.sideCloudClass;
  $("sideHelperStatus").textContent = view.sideHelperText;
  $("sideHelperStatus").className = view.sideHelperClass;
  $("syncPill").innerHTML = view.syncPillHtml;
  $("syncPill").className = view.syncPillClass;
  $("autoSwitchPill").innerHTML = view.autoSwitchPillHtml;
  $("autoSwitchPill").className = view.autoSwitchPillClass;
  $("codexPill").innerHTML = view.codexPillHtml;
  $("codexPill").className = view.codexPillClass;
  $("helperPill").innerHTML = view.helperPillHtml;
  $("helperPill").className = view.helperPillClass;
  $("userMenuBtn").textContent = view.userMenuText;
  $("sidebarLoginBtn").textContent = view.sidebarLoginText;
  $("sidebarSyncCard").querySelector("strong").textContent = view.sidebarSyncTitle;
  $("sidebarSyncCard").querySelector("span").textContent = view.sidebarSyncText;
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.hidden = view.adminOnlyHidden;
  });
  document.body.classList.toggle("sidebar-collapsed", view.sidebarCollapsed);
  $("collapseSidebarBtn").setAttribute("aria-expanded", view.sidebarExpanded);
  $("collapseSidebarBtn").setAttribute("aria-label", view.sidebarToggleLabel);
  $("refreshAllUsageBtn").disabled = view.refreshAllUsageDisabled;
  $("importLocalAuthBtn").disabled = view.importLocalAuthDisabled;
  renderShellState();
}

function renderMetrics() {
  const target = $("metricsGrid");
  target.hidden = !state.authResolved;
  target.innerHTML = shellUi.renderHealthCenter({
    groups: accountHealthGroups(state.accounts),
    activeKey: state.accountHealthFilter,
    total: state.accounts.length,
  });
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

function priorityLabel(value) {
  if (value === "primary") return "优先使用";
  if (value === "reserve") return "尽量少用";
  return "正常使用";
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
  const rendered = accountListUi.renderAccountGrid({
    accounts: filtered,
    layout: state.accountLayout,
    authResolved: state.authResolved,
    totalAccounts: state.accounts.length,
    selectedId: state.selectedId,
    currentId: resolveCurrentAccountId(),
    selectedBulkIds: state.selectedBulkIds,
    userPresent: Boolean(state.user),
    helperReady: state.helperReady,
    canRefreshUsage: canRefreshAccountUsage,
    operationActive: state.operationProgress.active,
  });
  $("accountGrid").className = rendered.className;
  $("accountGrid").innerHTML = rendered.html;
}

function renderSelected() {
  const account = selectedAccount();
  const rendered = accountDetailUi.renderSelectedAccount({
    account,
    current: isCurrentAccount(account),
    userPresent: Boolean(state.user),
    helperReady: state.helperReady,
    operationActive: state.operationProgress.active,
  });
  $("selectedState").textContent = rendered.selectedState;
  $("detailTitle").textContent = rendered.detailTitle;
  $("selectedAccountPanel").innerHTML = rendered.panelHtml;
  $("switchBtn").textContent = rendered.switchLabel;
  $("switchBtn").disabled = rendered.switchDisabled;
  $("copyAuthBtn").disabled = rendered.copyDisabled;
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

function auditMatchesAccount(item, account) {
  if (!item || !account) return false;
  if (String(item.action || "").toLowerCase() === "auto-switch-check") return false;
  const auditAccountId = String(item.accountId || item.account_id || "").trim();
  if (auditAccountId && account.cloudId && auditAccountId === account.cloudId) return true;
  const metadata = item.metadata || {};
  const target = String(metadata.target || metadata.account || metadata.email || "").trim().toLowerCase();
  if (!auditAccountId && target) {
    return target === String(account.email || "").trim().toLowerCase()
      || target === String(account.name || "").trim().toLowerCase();
  }
  return false;
}

function renderAudit() {
  const account = selectedAccount();
  const audit = account ? state.audit.filter((item) => auditMatchesAccount(item, account)) : state.audit;
  $("auditList").innerHTML = panelsUi.renderAudit(audit);
}

function renderDevice() {
  const helper = state.helperInfo || {};
  const codex = state.codexStatus || {};
  $("deviceKeyBox").textContent = state.deviceKey || "未生成";
  $("devicePanel").innerHTML = panelsUi.renderDevice({
    helperReady: state.helperReady,
    helper,
    codex,
    helperBase: helperDisplayBase(),
    helperAuthorized: state.autoSwitchStatus.helperAuthorized || helperAuthorizedForCurrentConsole(helper),
    userPresent: Boolean(state.user),
    minimumHelperVersion,
    currentAuthChecking: state.currentAuthChecking,
    currentAuthMatched: Boolean(resolveCurrentAccountId()),
  });
}

function renderSecurity() {
  const account = selectedAccount();
  const summary = panelsUi.securitySummary(account, {
    accountPlan,
    hasUsableRefreshToken,
    userPresent: Boolean(state.user),
  });
  $("authPreview").textContent = summary.preview;
  const warning = $("tokenWarning");
  warning.hidden = summary.warningHidden;
  warning.textContent = summary.warningText;
}

function renderSettings() {
  const codex = state.codexStatus || {};
  $("settingsAccountState").innerHTML = settingsUi.renderAccountState({ user: state.user });
  $("changePasswordForm").hidden = !state.user;
  $("settingsHelperState").innerHTML = settingsUi.renderHelperState({
    helperReady: state.helperReady,
    helper: state.helperInfo || {},
    codex,
    minimumHelperVersion,
  });
  $("backupCloudState").innerHTML = settingsUi.renderBackupCloudState({
    user: state.user,
    localAccountCount: state.localAccounts.length,
    cloudBackupEnabled: cloudBackupEnabled(),
  });
  $("usageRefreshState").innerHTML = settingsUi.renderUsageRefreshSettings({
    user: state.user,
    helperReady: state.helperReady,
    usageSettings: state.usageRefreshSettings,
  });
  renderSmartSwitchSettings();
}

function renderSmartSwitchSettings() {
  const target = $("smartSettingsState");
  if (!target) return;
  target.innerHTML = settingsUi.renderSmartSwitchSettings({
    user: state.user,
    helperReady: state.helperReady,
    helperInfo: state.helperInfo,
    autoSwitchStatus: state.autoSwitchStatus,
    autoSettings: state.autoSwitchSettings,
    smartSettings: state.smartSwitchSettings,
    defaultAutoSwitchSettings,
  });
}

function renderAdmin() {
  if (state.user?.role !== "admin") return;
  if ($("adminUserSearch")) $("adminUserSearch").value = state.adminFilters.userQuery || "";
  if ($("adminRoleFilter")) $("adminRoleFilter").value = state.adminFilters.role || "";
  if ($("adminStatusFilter")) $("adminStatusFilter").value = state.adminFilters.status || "";
  if ($("adminAuditSearch")) $("adminAuditSearch").value = state.adminFilters.auditQuery || "";
  if ($("adminAuditActionFilter")) $("adminAuditActionFilter").value = state.adminFilters.auditAction || "";
  const rendered = adminUi.renderAdmin({
    summary: state.adminSummary,
    users: state.adminUsers,
    audit: state.adminAudit,
    devices: state.adminDevices,
    selectedIds: state.selectedAdminUserIds,
  });
  $("adminSummary").innerHTML = rendered.summaryHtml;
  $("adminUsers").innerHTML = rendered.usersHtml;
  $("adminSelectAllBtn").textContent = rendered.selectAllLabel;
  $("adminDevices").innerHTML = rendered.devicesHtml;
  $("adminAudit").innerHTML = rendered.auditHtml;
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("codex-sidebar-collapsed-v1", state.sidebarCollapsed ? "1" : "0");
  renderShell();
}

async function checkHelper() {
  for (const base of helperBaseCandidates()) {
    try {
      const result = await createHelperClient(base).health();
      if (isKnownHelperHealth(result)) {
        state.helperReady = true;
        state.helperBase = base;
        state.helperInfo = result;
        state.codexProxy = result.codex_proxy || result.codexProxy || null;
        state.codexStatus = result.codex_status || result.codexStatus || null;
        state.autoSwitchStatus.helperAuthorized = helperAuthorizedForCurrentConsole(result);
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
    const result = await helperClient().health();
    if (!isKnownHelperHealth(result)) return false;
    state.helperInfo = result;
    state.codexProxy = result.codex_proxy || result.codexProxy || state.codexProxy;
    state.codexStatus = result.codex_status || result.codexStatus || state.codexStatus;
    state.autoSwitchStatus.helperAuthorized = helperAuthorizedForCurrentConsole(result);
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
    const result = await helperClient().configureProxy(action);
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
    const result = await helperClient().currentAuth();
    if (!result.authJson) {
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
  const [accountsResult, auditResult, autoResult, usageResult] = await Promise.all([
    api("/api/accounts"),
    api("/api/audit"),
    api("/api/settings/auto-switch").catch(() => ({ settings: { ...defaultAutoSwitchSettings } })),
    api("/api/settings/usage-refresh").catch(() => ({ settings: { ...defaultUsageRefreshSettings } })),
  ]);
  state.cloudAccounts = (accountsResult.accounts || []).map(normalizeCloudAccount);
  state.autoSwitchSettings = { ...defaultAutoSwitchSettings, ...(autoResult.settings || {}) };
  state.usageRefreshSettings = { ...defaultUsageRefreshSettings, ...(usageResult.settings || {}) };
  state.audit = (auditResult.audit || []).map((item) => ({
    at: item.createdAt || item.created_at,
    accountId: item.accountId || item.account_id,
    accountName: item.accountName || item.account_name || "",
    result: item.result || item.action || "",
    action: item.action || "",
    metadata: item.metadata || {},
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
        helperVersion: state.helperInfo?.version || "",
        helperBuildDate: state.helperInfo?.build_date || "",
      },
    });
    if (state.helperReady) {
      await helperClient().pair({ deviceKey: state.deviceKey, cloudUserId: state.user.id }).catch(() => {});
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

async function saveUsageRefreshSettings(patch = {}) {
  const next = { ...state.usageRefreshSettings, ...patch };
  state.usageRefreshSettings = next;
  saveLocalStore();
  if (!state.user) {
    render();
    return;
  }
  try {
    const result = await api("/api/settings/usage-refresh", {
      method: "PATCH",
      body: { settings: next },
    });
    state.usageRefreshSettings = { ...defaultUsageRefreshSettings, ...(result.settings || next) };
    saveLocalStore();
    render();
  } catch (error) {
    toast(error.message || "保存额度刷新设置失败。");
    renderSettings();
  }
}

async function noteUsageRefreshSource(source) {
  const at = new Date().toISOString();
  state.usageRefreshSettings = {
    ...state.usageRefreshSettings,
    lastUsageRefreshSource: source,
    lastUsageRefreshAt: at,
  };
  saveLocalStore();
  if (state.user) {
    const result = await api("/api/settings/usage-refresh/recent", {
      method: "POST",
      body: { source, at },
    }).catch(() => null);
    if (result?.settings) {
      state.usageRefreshSettings = { ...defaultUsageRefreshSettings, ...result.settings };
      saveLocalStore();
    }
  }
}

async function configureHelperAutoSwitch(config) {
  if (!state.helperReady) throw new Error("Dock Helper 未连接");
  const result = await helperClient().configureAutoSwitch(config);
  state.helperInfo = { ...(state.helperInfo || {}), auto_switch: result.auto_switch || result.autoSwitch || {} };
  state.autoSwitchStatus.helperAuthorized = helperAuthorizedForCurrentConsole(state.helperInfo);
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
        helperVersion: state.helperInfo?.version || "",
        helperBuildDate: state.helperInfo?.build_date || "",
      },
    });
    const settings = { ...defaultAutoSwitchSettings, ...(tokenResult.settings || state.autoSwitchSettings), enabled: true };
    await configureHelperAutoSwitch({
      enabled: true,
      cloudBase: tokenResult.cloudBase || window.location.origin,
      deviceToken: tokenResult.deviceToken,
      tokenExpiresAt: tokenResult.tokenExpiresAt || "",
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

function normalizeAuthPayload(session, options = {}) {
  const tokens = session?.tokens || {};
  const accessToken = tokens.access_token || "";
  if (!accessToken) throw new Error("账号缺少 access_token");
  const hasRefreshToken = tokens.refresh_token && tokens.refresh_token !== accessToken && tokens.refresh_token !== "rt_mock_token";
  if (!hasRefreshToken && !options.allowAtExperimental) {
    throw new Error("AT 账号当前不支持 Codex 使用，请重新登录 Codex 获取 RT。");
  }
  const refreshToken = hasRefreshToken ? tokens.refresh_token : "rt_mock_token";
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
  const allowAtExperimental = Boolean(experimentalAtEnabled(state.smartSwitchSettings) && !hasUsableRefreshToken(account));
  if (!codexUsable(account, state.smartSwitchSettings)) {
    throw new Error(codexBlockDetail(codexBlockReason(account, state.smartSwitchSettings)) || "账号当前不可用于 Codex。");
  }
  if (account.session?.tokens?.access_token) {
    return normalizeAuthPayload(account.session, { allowAtExperimental });
  }
  if (!state.user || !account.cloudId) {
    throw new Error("这个账号没有本地 token，登录云账号后才能切换。");
  }
  const result = await api(`/api/accounts/${encodeURIComponent(account.cloudId)}/switch-payload`, {
    method: "POST",
    body: { deviceKey: state.deviceKey, audit, allowAtExperimental },
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

function restoreTargetDetail(target) {
  if (!target?.available) return "未识别目标，将使用 Codex 默认窗口";
  const name = target.title || target.cwd || target.thread_id || "目标窗口";
  return target.is_goal ? `目标任务：${name}` : `窗口：${name}`;
}

function codexStatusDetail(codex) {
  if (!codex) return "等待状态回传";
  const label = codex.label || codex.state || "状态确认中";
  const running = Number(codex.running_process_count || 0);
  return running > 0 ? `${label}，进程 ${running}` : label;
}

async function waitForCodexRestartProgress(itemIndex, accepted) {
  if (!accepted) {
    updateProgressItem(itemIndex, "已完成", "auth 已写入");
    return;
  }

  let lastDetail = "等待 Codex 重启";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(attempt === 0 ? 900 : 1300);
    try {
      const result = await helperClient().codexStatus();
      const codex = result.codex_status || {};
      state.codexStatus = codex;
      state.codexProxy = result.codex_proxy || state.codexProxy;
      state.helperInfo = {
        ...(state.helperInfo || {}),
        codex_status: codex,
        codex_proxy: result.codex_proxy || state.helperInfo?.codex_proxy,
      };
      renderShell();
      lastDetail = codexStatusDetail(codex);
      updateProgressItem(itemIndex, "处理中", lastDetail);

      const stateName = String(codex.state || "");
      const runningCount = Number(codex.running_process_count || 0);
      const label = String(codex.label || "");
      if (runningCount > 0 && stateName !== "not_running" && label !== "Codex 未运行") {
        updateProgressItem(itemIndex, "已完成", lastDetail);
        return;
      }
    } catch (error) {
      lastDetail = error.message || "等待 Helper 状态回传";
      updateProgressItem(itemIndex, "处理中", lastDetail);
    }
  }

  updateProgressItem(itemIndex, "已完成", `${lastDetail}，后台仍会继续恢复`);
}

async function applySelectedAccount() {
  const account = selectedAccount();
  if (!account) return;
  if (state.operationProgress.active) {
    toast("已有切换任务正在进行。");
    return;
  }
  if (!state.helperReady) {
    try {
      await downloadAccountAuth(account);
    } catch (error) {
      toast(error.message || "下载 auth.json 失败。");
    }
    return;
  }
  let activeStep = 0;
  openProgress("正在切换账号", [
    { id: "payload", label: "获取账号授权" },
    { id: "target", label: "定位目标窗口" },
    { id: "helper", label: "交给 Dock Helper" },
    { id: "restart", label: "重启并恢复目标" },
    { id: "audit", label: "同步云端记录" },
  ]);
  try {
    activeStep = 0;
    updateProgressItem(activeStep, "处理中", account.name || account.email || "准备 auth");
    const authJson = await fetchSwitchPayload(account, true);
    updateProgressItem(activeStep, "已完成", "auth 已准备");

    activeStep = 1;
    updateProgressItem(activeStep, "处理中", "读取 Codex 当前目标");
    const target = await helperClient().restoreTarget().catch(() => null);
    updateProgressItem(activeStep, "已完成", restoreTargetDetail(target));

    activeStep = 2;
    updateProgressItem(activeStep, "处理中", "写入 auth 并请求重启");
    const result = await helperClient().applyAuth({
      authJson,
      launch: true,
      restart: true,
      deviceKey: state.deviceKey,
      allowAtExperimental: Boolean(experimentalAtEnabled(state.smartSwitchSettings) && !hasUsableRefreshToken(account)),
    });
    updateProgressItem(activeStep, "已完成", result.launch_mode || "Helper 已接管");

    activeStep = 3;
    updateProgressItem(activeStep, "处理中", result.accepted ? "等待 Codex 回到目标窗口" : "确认重启结果");
    await waitForCodexRestartProgress(activeStep, Boolean(result.accepted));

    account.lastSwitchAt = new Date().toISOString();
    state.currentAuthKey = accountDedupeKey(account);
    state.currentAuthAccount = account;
    state.localAuthFingerprint = accountFingerprint(account);
    updateLocalAccount(account);
    activeStep = 4;
    updateProgressItem(activeStep, "处理中", state.user && account.cloudId ? "写入审计并刷新列表" : "本地账号已更新");
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
    updateProgressItem(activeStep, "已完成", "记录已更新");
    finishProgress(result.accepted ? "后台切换已接管，Codex 正在恢复目标任务。" : "切换完成，Codex 已重启。");
    renderAccounts();
    renderSelected();
    toast(result.accepted ? "后台切换已接管，Codex 会自动重启。" : "切换完成，Codex 已重启。");
  } catch (error) {
    updateProgressItem(activeStep, "失败", error.message || "切换失败");
    finishProgress(error.message || "切换失败。");
    renderAccounts();
    renderSelected();
    toast(error.message || "切换失败。");
  }
}

function cloudUsageRefreshAvailable(account) {
  return Boolean(state.user && account?.cloudId && state.usageRefreshSettings.cloudUsageRefreshEnabled);
}

function configuredUsageRefreshChannel(account) {
  const settings = state.usageRefreshSettings || defaultUsageRefreshSettings;
  if (settings.usageRefreshMode === "helper") {
    if (!state.helperReady) throw new Error("本机 Helper 未连接，请启动 Helper 或更改额度刷新方式。");
    return { channel: "helper", source: "helper" };
  }
  if (settings.usageRefreshMode === "cloud") {
    if (!cloudUsageRefreshAvailable(account)) throw new Error("云端刷新未授权，或该账号尚未同步到云端。");
    return { channel: "cloud", source: "cloud-worker" };
  }
  if (settings.usageRefreshMode === "auto") {
    if (state.helperReady) return { channel: "helper", source: "auto-helper" };
    if (settings.helperFallbackToCloud && cloudUsageRefreshAvailable(account)) {
      return { channel: "cloud", source: "auto-cloud-fallback", autoFallback: true };
    }
    throw new Error("自动刷新未找到可用通道：请启动 Helper，或开启云端回退。");
  }
  if (state.helperReady) return { channel: "helper", source: "helper" };
  if (cloudUsageRefreshAvailable(account)) return { channel: "cloud", source: "cloud-worker" };
  throw new Error("仅手动模式下仍需要在线 Helper，或已授权的云端刷新通道。");
}

async function refreshUsageThroughHelper(account, route, options = {}) {
  const authJson = await fetchSwitchPayload(account, false);
  const result = await helperClient().previewUsage({ authJson, deviceKey: state.deviceKey });
  const snapshot = result.usage_snapshot || result.usage || {};
  const normalized = normalizeUsage({ ...snapshot, refresh_source: route.source }, accountPlan(account));
  normalized.plan_type = bestPlan(accountPlan(account), normalized.plan_type);
  normalized.refresh_source = route.source;
  if (!result.ok) {
    normalized.error = explainError(result.error || normalized.error || "刷新失败");
    normalized.status = "刷新失败";
    normalized.refreshed_at = normalized.refreshed_at || new Date().toISOString();
  }
  if (state.user && account.cloudId) {
    await api(`/api/accounts/${encodeURIComponent(account.cloudId)}/usage`, {
      method: "POST",
      body: {
        usage: normalized,
        source: route.source,
        batch: Boolean(options.batch),
        ok: Boolean(result.ok),
        error: result.ok ? "" : (result.error || "刷新失败"),
      },
    }).catch(() => {});
    if (!options.batch) {
      await api("/api/audit", {
        method: "POST",
        body: {
          accountId: account.cloudId,
          action: "usage-refresh",
          result: result.ok ? "ok" : "error",
          metadata: { source: route.source },
        },
      }).catch(() => {});
    }
  }
  return { ok: Boolean(result.ok), usage: normalized, source: route.source };
}

async function refreshUsageThroughCloud(account, route, options = {}) {
  const result = await api(`/api/accounts/${encodeURIComponent(account.cloudId)}/usage/refresh-cloud`, {
    method: "POST",
    body: { autoFallback: Boolean(route.autoFallback), batch: Boolean(options.batch), audit: !options.batch },
  });
  return {
    ok: true,
    usage: normalizeUsage({ ...(result.usage || {}), refresh_source: result.source || route.source }, accountPlan(account)),
    source: result.source || route.source,
  };
}

async function executeConfiguredUsageRefresh(account, options = {}) {
  const route = configuredUsageRefreshChannel(account);
  if (route.channel === "cloud") return refreshUsageThroughCloud(account, route, options);
  try {
    const result = await refreshUsageThroughHelper(account, route, options);
    if (result.ok || state.usageRefreshSettings.usageRefreshMode !== "auto") return result;
    if (!state.usageRefreshSettings.helperFallbackToCloud || !cloudUsageRefreshAvailable(account)) return result;
    return refreshUsageThroughCloud(account, { channel: "cloud", source: "auto-cloud-fallback", autoFallback: true }, options);
  } catch (error) {
    if (state.usageRefreshSettings.usageRefreshMode === "auto"
      && state.usageRefreshSettings.helperFallbackToCloud
      && cloudUsageRefreshAvailable(account)) {
      return refreshUsageThroughCloud(account, { channel: "cloud", source: "auto-cloud-fallback", autoFallback: true }, options);
    }
    throw error;
  }
}

async function refreshAccountUsage(id, options = {}) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return false;
  try {
    account.usage = { ...normalizeUsage(account.usage, accountPlan(account)), status: "刷新中", error: "" };
    renderAccounts();
    renderSelected();
    const result = await executeConfiguredUsageRefresh(account, options);
    account.usage = result.usage;
    account.planType = bestPlan(account.planType, result.usage.plan_type);
    updateLocalAccount(account);
    if (!options.batch) await noteUsageRefreshSource(result.source);
    if (state.user && account.cloudId && !options.batch) await loadCloudData();
    else render();
    if (!options.silent) {
      toast(result.ok
        ? `已通过 ${result.source} 刷新 ${account.name} 的额度。`
        : `${account.name} 额度刷新失败：${result.usage.error || "刷新失败"}`);
    }
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

async function refreshAccountsInBatches(accounts, title) {
  if (!accounts.length || state.refreshingUsage) return;
  state.refreshingUsage = true;
  renderShell();
  openProgress(title, accounts.map((account) => ({ label: account.email || account.name })));
  const concurrency = Math.max(1, Math.min(3, Number(state.usageRefreshSettings.usageRefreshConcurrency || 1)));
  const interval = Math.max(1000, Number(state.usageRefreshSettings.usageRefreshIntervalMs || 1500));
  let ok = 0;
  const sources = {};
  for (let start = 0; start < accounts.length; start += concurrency) {
    const group = accounts.slice(start, start + concurrency);
    const outcomes = await Promise.all(group.map(async (account, offset) => {
      const index = start + offset;
      updateProgressItem(index, "刷新中");
      const success = await refreshAccountUsage(account.id, { silent: true, batch: true });
      const source = account.usage?.refresh_source || "";
      updateProgressItem(index, success ? "已完成" : "失败", source || (success ? "" : "额度刷新失败"));
      return { success, source };
    }));
    for (const outcome of outcomes) {
      if (outcome.success) ok++;
      if (outcome.source) sources[outcome.source] = (sources[outcome.source] || 0) + 1;
    }
    if (start + concurrency < accounts.length) await wait(interval);
  }
  state.refreshingUsage = false;
  if (state.user) {
    await api("/api/audit", {
      method: "POST",
      body: {
        action: "usage-refresh-batch",
        result: `ok:${ok},failed:${accounts.length - ok}`,
        metadata: { sources, total: accounts.length },
      },
    }).catch(() => {});
  }
  const lastSource = Object.keys(sources).length === 1 ? Object.keys(sources)[0] : (Object.keys(sources).length ? "mixed" : "");
  if (lastSource) await noteUsageRefreshSource(lastSource);
  if (state.user) await loadCloudData().catch(() => {});
  render();
  finishProgress(`额度刷新完成：${ok}/${accounts.length}`);
  toast(`额度刷新完成：${ok}/${accounts.length}`);
}

async function refreshAllUsage() {
  const accounts = state.accounts.filter((account) => canUseAccount(account) && canRefreshAccountUsage(account));
  if (!accounts.length) {
    toast("当前没有可通过已配置通道刷新的账号。");
    return;
  }
  await refreshAccountsInBatches(accounts, "刷新额度");
}

async function smartSwitchBestAccount() {
  const account = bestAccount();
  if (!account) {
    const hasAtOnly = state.accounts.some((item) => accountCredentialKind(item) === "at");
    toast(hasAtOnly
      ? "没有可用 RT 账号。AT 账号当前不支持 Codex。"
      : "没有可切换账号。");
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
  const atOnly = accounts.filter((account) => !hasUsableRefreshToken(account)).length;
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
  return { added: result.added, updated: result.updated, skipped: 0, failed, total: entries.length, cloud, atOnly };
}

async function performPendingImport(options = {}) {
  const importable = state.pendingImportItems.filter((item) => item.ok && item.account);
  const failed = state.pendingImportItems.filter((item) => item.status === "无法解析").length;
  if (!importable.length) {
    showImportResult({ message: "没有可导入账号。请先解析有效 JSON。", failed });
    const error = new Error("没有可导入账号。请先解析有效 JSON。");
    if (options.throwOnError) throw error;
    return null;
  }
  const button = $("confirmImportBtn");
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = cloudBackupEnabled() ? "正在导入并备份..." : "正在导入...";
  }
  showImportResult({ message: cloudBackupEnabled() ? "正在写入账号池并备份到云端..." : "正在写入本地账号池..." });
  try {
    const accounts = importable.map((item) => item.account);
    const atOnly = accounts.filter((account) => !hasUsableRefreshToken(account)).length;
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
      message: atOnly
        ? `新增 ${result.added} · 更新 ${result.updated} · 失败 ${failed}。${atOnly} 个账号缺少 RT，当前不能用于 Codex，请重新登录 Codex 获取 RT。`
        : "",
    });
    toast(atOnly
      ? `导入完成：${atOnly} 个 AT-only 当前不支持 Codex。`
      : `导入完成：新增 ${result.added}，更新 ${result.updated}。`);
    return { ...result, failed, total: state.pendingImportItems.length, cloud, atOnly };
  } catch (error) {
    state.importCompleted = false;
    showImportResult({ failed: failed + 1, message: error.message || "导入失败。" });
    if (options.throwOnError) throw error;
    return null;
  } finally {
    if (button) button.textContent = originalText;
    renderImportPreview();
  }
}

async function confirmPendingImport() {
  await performPendingImport();
}

async function refreshImportedAccounts(importedAccounts) {
  const accounts = findImportedAccounts(state.accounts, importedAccounts);
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

async function importAccountsFromText(text, defaults = {}) {
  const entries = parseImportEntries(text);
  return importParsedEntries(entries, defaults);
}

function previewImportText(text) {
  return previewImportEntries(parseImportEntries(text));
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
      totals.atOnly = (totals.atOnly || 0) + (result.atOnly || 0);
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
  if (!silent) openProgress("导入当前 auth", [{ label: "读取当前 auth.json" }]);
  try {
    if (!silent) updateProgressItem(0, "读取中");
    const result = await helperClient().currentAuth();
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
    if (!silent) toast(`已导入当前授权：新增 ${imported.added}，更新 ${imported.updated}。`);
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
  return helperClient().migrateCacheUrl(window.location.origin);
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
  if (stats.local === 0 && stats.cloud === 0) {
    setSyncMode("merge");
    return;
  }
  $("syncStats").innerHTML = dialogUi.renderSyncStats(stats);
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
  const view = dialogUi.modalState(true);
  modal.classList.toggle("open", view.open);
  modal.setAttribute("aria-hidden", view.ariaHidden);
}

function closeModal(id) {
  const modal = $(id);
  const view = dialogUi.modalState(false);
  modal.classList.toggle("open", view.open);
  modal.setAttribute("aria-hidden", view.ariaHidden);
  if (id === "cleanupModal") state.cleanupPendingIds = [];
}

function setDrawer(open, options = {}) {
  const view = dialogUi.drawerState(open);
  $("importDrawer").classList.toggle("open", view.open);
  $("importDrawer").setAttribute("aria-hidden", view.ariaHidden);
  if (open) {
    setImportMode(options.mode || "oauth");
    $("importResult").hidden = true;
    renderOauthFlow();
  } else {
    cancelOauthFlow({ silent: true });
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const view = dialogUi.authModeView(mode);
  $("authTitle").textContent = view.title;
  $("authCopy").textContent = view.copy;
  $("authSubmitBtn").textContent = view.submitText;
  $("toggleAuthModeBtn").textContent = view.toggleText;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  try {
    const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(path, { method: "POST", body: { email, password } });
    writeMigratedLocalStorage(cachedEmailStorage, email, previousCachedEmailStorage);
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
  let key = readMigratedLocalStorage(deviceKeyStorage, previousDeviceKeyStorage);
  if (!key) {
    key = crypto.randomUUID();
    writeMigratedLocalStorage(deviceKeyStorage, key, previousDeviceKeyStorage);
  }
  state.deviceKey = key;
}

async function rotateDeviceKey() {
  const key = crypto.randomUUID();
  writeMigratedLocalStorage(deviceKeyStorage, key, previousDeviceKeyStorage);
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

async function repairHelperTray() {
  if (!state.helperReady || !state.helperBase) {
    await checkHelper();
    if (!state.helperReady || !state.helperBase) {
      toast("Helper 未连接，无法修复托盘图标。");
      return;
    }
  }
  try {
    const result = await helperClient().repairTray();
    if (result.tray) state.helperInfo = { ...(state.helperInfo || {}), tray: result.tray };
    renderDevice();
    renderSettings();
    toast("已请求 Helper 重新注册托盘图标。");
    window.setTimeout(checkHelper, 1200);
  } catch (error) {
    toast(error.message || "修复托盘图标失败。");
  }
}

async function exportHelperDiagnostics() {
  if (!state.helperReady || !state.helperBase) {
    toast("Helper 未连接，无法导出诊断。");
    return;
  }
  try {
    const result = await helperClient().diagnosticsExport();
    downloadText(`codex-dock-helper-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(result, null, 2));
    toast("已导出 Helper 诊断文件。");
  } catch (error) {
    toast(error.message || "导出 Helper 诊断失败。");
  }
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

function cleanupAccountIssue(account) {
  const block = codexBlockReason(account);
  const tokenFilter = tokenFilterValue(account);
  const issue = usageIssue(account);
  const usage = normalizeUsage(account?.usage, accountPlan(account));
  if (isCurrentAccount(account)) {
    return { reason: "当前使用", className: "warn", recoverable: false };
  }
  if (block === "at_unsupported" || (hasAccountSecret(account) && !hasUsableRefreshToken(account) && tokenFilter !== "expired")) {
    return { reason: "缺 RT，需重新登录导入", className: "warn", recoverable: true };
  }
  if (block === "rt_invalid" || tokenFilter === "expired" || refreshTokenInvalidText(usage.error)) {
    return { reason: "RT/Token 失效", className: "bad", recoverable: true };
  }
  if (issue) {
    return { reason: issue.label, className: issue.className || "warn", recoverable: false };
  }
  if (accountLowQuota(account)) {
    return { reason: "额度低，建议暂不优先使用", className: "warn", recoverable: false };
  }
  if (accountCooldownActive(account)) {
    return { reason: "冷却中，等待后可恢复", className: "neutral", recoverable: false };
  }
  if (codexUsable(account) && !state.helperReady) {
    return { reason: "Helper 不可操作", className: "warn", recoverable: false };
  }
  return { reason: "看似可用", className: "neutral", recoverable: false };
}

function cleanupReview(accounts) {
  const rows = accounts.map((account) => {
    const issue = cleanupAccountIssue(account);
    return {
      id: account.id,
      title: account.name || account.email || account.accountId || "未命名账号",
      subtitle: account.email || shortId(account.accountId || account.id),
      reason: issue.reason,
      className: issue.className,
      recoverable: issue.recoverable,
      invalid: isInvalidAccount(account),
    };
  });
  return {
    total: rows.length,
    invalid: rows.filter((row) => row.invalid).length,
    normal: rows.filter((row) => !row.invalid).length,
    recoverable: rows.filter((row) => row.recoverable).length,
    rows,
  };
}

function renderCleanupModal(accounts) {
  const review = cleanupReview(accounts);
  const view = dialogUi.renderCleanupReview(review);
  $("cleanupSummary").textContent = view.summaryText;
  $("cleanupStats").innerHTML = view.statsHtml;
  $("cleanupRisk").innerHTML = view.riskHtml;
  $("cleanupList").innerHTML = view.listHtml;
  $("cleanupConfirmBtn").textContent = view.confirmText;
}

function openBulkCleanupModal() {
  const accounts = selectedBulkAccounts();
  if (!accounts.length) return;
  state.cleanupPendingIds = accounts.map((account) => account.id);
  renderCleanupModal(accounts);
  openModal("cleanupModal");
}

function cleanupPendingAccounts() {
  const ids = new Set(state.cleanupPendingIds || []);
  return state.accounts.filter((account) => ids.has(account.id));
}

async function confirmBulkDeleteAccounts() {
  const accounts = cleanupPendingAccounts();
  if (!accounts.length) {
    closeModal("cleanupModal");
    return;
  }
  const button = $("cleanupConfirmBtn");
  button.disabled = true;
  button.textContent = "正在清理...";
  for (const account of accounts) {
    state.localAccounts = state.localAccounts.filter((item) => item.id !== account.localId && item.id !== account.id && accountDedupeKey(item) !== accountDedupeKey(account));
    if (state.user && account.cloudId) {
      await api(`/api/accounts/${encodeURIComponent(account.cloudId)}`, { method: "DELETE" }).catch(() => {});
    }
  }
  state.selectedBulkIds.clear();
  state.cleanupPendingIds = [];
  if (state.user) await loadCloudData().catch(() => {});
  saveLocalStore();
  closeModal("cleanupModal");
  render();
  toast(`已删除 ${accounts.length} 个账号。`);
  button.disabled = false;
}

async function bulkRefreshAccounts() {
  const accounts = selectedBulkAccounts().filter((account) => canUseAccount(account) && canRefreshAccountUsage(account));
  if (!accounts.length) {
    toast("所选账号没有可用的额度刷新通道。");
    return;
  }
  await refreshAccountsInBatches(accounts, "批量刷新额度");
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
  document.querySelectorAll("[data-settings-tab]").forEach((el) => el.classList.toggle("active", dialogUi.isActive(tab, el.dataset.settingsTab)));
  document.querySelectorAll(".settings-panel").forEach((panel) => panel.classList.toggle("active", dialogUi.isActive(tab, panel.dataset.panel)));
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
    $("adminMessage").innerHTML = dialogUi.renderAdminUserSummary(detail, accounts.accounts || []);
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
  $("parseOauthCallbackBtn").addEventListener("click", () => parseOauthCallbackToPreview());
  $("oauthFlowCancelBtn").addEventListener("click", () => cancelOauthFlow());
  $("oauthFlowRetryBtn").addEventListener("click", () => beginOauthAuthorization());
  $("oauthFlowDoneBtn").addEventListener("click", () => {
    cancelOauthFlow({ silent: true });
    setDrawer(false);
  });
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
      state.accountHealthFilter = "all";
      state.selectedBulkIds.clear();
      saveLocalStore();
      renderMetrics();
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
  $("bulkDeleteBtn").addEventListener("click", openBulkCleanupModal);
  $("cleanupConfirmBtn").addEventListener("click", confirmBulkDeleteAccounts);
  $("bulkPrioritySelect").addEventListener("change", async (event) => {
    await bulkSetPriority(event.target.value);
    event.target.value = "";
  });
  $("metricsGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-health-filter]");
    if (!button) return;
    state.accountHealthFilter = button.dataset.healthFilter || "all";
    state.accountFilter = "all";
    state.accountFilters = { ...defaultAccountFilters };
    state.accountSearch = "";
    $("accountSearchInput").value = "";
    state.selectedBulkIds.clear();
    saveLocalStore();
    renderMetrics();
    renderAccounts();
  });
  $("smartSettingsState").addEventListener("change", (event) => {
    const autoInput = event.target.closest("[data-auto-switch-setting]");
    if (autoInput) {
      const key = autoInput.dataset.autoSwitchSetting;
      const value = autoInput.type === "checkbox" ? autoInput.checked : Number(autoInput.value);
      state.autoSwitchSettings[key] = value;
      const patch = { [key]: value };
      if (key === "showExperimentalAt" && !value) {
        state.autoSwitchSettings.allowAt = false;
        patch.allowAt = false;
      }
      saveLocalStore();
      saveAutoSwitchSettings(patch);
      render();
      return;
    }
    const input = event.target.closest("[data-smart-setting]");
    if (!input) return;
    const key = input.dataset.smartSetting;
    state.smartSwitchSettings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    if (key === "showExperimentalAt" && !state.smartSwitchSettings[key]) {
      state.smartSwitchSettings.allowAt = false;
    }
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
    const helperButton = event.target.closest("[data-helper-action]");
    if (helperButton) {
      const action = helperButton.dataset.helperAction;
      if (action === "refresh") checkHelper();
      if (action === "authorize") authorizeAutoSwitchHelper();
      if (action === "repair-tray") repairHelperTray();
      if (action === "open-status") openLocalStatus();
      if (action === "export-diagnostics") exportHelperDiagnostics();
      return;
    }
    const button = event.target.closest("[data-codex-proxy-action]");
    if (!button) return;
    configureCodexProxy(button.dataset.codexProxyAction);
  });
  $("rotateDeviceKeyBtn").addEventListener("click", rotateDeviceKey);
  $("openLocalStatusBtn").addEventListener("click", openLocalStatus);
  $("settingsOpenLocalStatusBtn").addEventListener("click", openLocalStatus);
  $("repairTrayBtn").addEventListener("click", repairHelperTray);
  $("settingsRepairTrayBtn").addEventListener("click", repairHelperTray);
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
  $("usageRefreshState").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-usage-refresh-setting]");
    if (!input) return;
    const key = input.dataset.usageRefreshSetting;
    const value = input.type === "checkbox"
      ? input.checked
      : (["usageRefreshConcurrency", "usageRefreshIntervalMs"].includes(key) ? Number(input.value) : input.value);
    const patch = { [key]: value };
    if (key === "cloudUsageRefreshEnabled" && !value) {
      patch.helperFallbackToCloud = false;
      if (["cloud", "auto"].includes(state.usageRefreshSettings.usageRefreshMode)) patch.usageRefreshMode = "helper";
    }
    await saveUsageRefreshSettings(patch);
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
    state.accountHealthFilter = "all";
    state.selectedBulkIds.clear();
    saveLocalStore();
    renderMetrics();
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
      if (button.dataset.accountAction === "recover-auth") {
        state.selectedId = id;
        saveLocalStore();
        render();
        openModal("accountDetailModal");
        toast("请通过 OAuth 网页登录补充这个账号自己的 RT。");
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
  window.addEventListener("message", handleOauthCallbackMessage);
  bindEvents();
  setAuthMode("login");
    $("authEmail").value = readMigratedLocalStorage(cachedEmailStorage, previousCachedEmailStorage);
  render();
  checkHelper();
  window.setInterval(refreshHelperRuntimeStatus, 3000);
  loadMe();
}

init();

