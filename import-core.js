(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexImportCore = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function defaultCreateId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function hasUsageSnapshot(usage) {
    return Boolean(usage && (usage.refreshed_at || usage.fetched_at || usage.five_hour || usage.one_week));
  }

  function importStatusClass(status) {
    if (status === "新增") return "ok";
    if (status === "更新") return "ok";
    return "bad";
  }

  function createImportCore(deps = {}) {
    const accountCore = deps.accountCore || root.CodexAccountCore || {};
    const formatCore = deps.formatCore || root.CodexFormatCore || {};
    const createId = deps.createId || defaultCreateId;
    const accountDedupeKey = deps.accountDedupeKey || accountCore.accountDedupeKey;
    const authFingerprint = deps.authFingerprint || accountCore.authFingerprint;
    const normalizeLocalAccount = deps.normalizeLocalAccount || accountCore.normalizeLocalAccount;
    const normalizeUsage = deps.normalizeUsage || accountCore.normalizeUsage;
    const accountPlan = deps.accountPlan || accountCore.accountPlan;
    const hasUsableRefreshToken = deps.hasUsableRefreshToken || accountCore.hasUsableRefreshToken;
    const shortId = deps.shortId || formatCore.shortId || ((value) => String(value || "").slice(0, 8) || "未识别");
    const planLabel = deps.planLabel || formatCore.planLabel || ((value) => value || "未知");
    const tokenState = deps.tokenState || (() => ({ label: "未知" }));

    function importIdentityKeys(account) {
      const keys = new Set();
      const dedupe = typeof accountDedupeKey === "function" ? accountDedupeKey(account) : "";
      if (dedupe && !dedupe.startsWith("id:")) keys.add(dedupe);
      const accountId = String(account?.accountId || account?.account_id || account?.session?.tokens?.account_id || "").trim().toLowerCase();
      if (accountId) keys.add(`account:${accountId}`);
      const email = String(account?.email || account?.session?.email || "").trim().toLowerCase();
      if (email) keys.add(`email:${email}`);
      const fingerprint = typeof authFingerprint === "function" ? authFingerprint(account?.session) : "";
      if (fingerprint && fingerprint.replace(/\|/g, "")) keys.add(`token:${fingerprint}`);
      return [...keys];
    }

    function buildExistingImportKeys(accounts = []) {
      const keys = new Set();
      for (const account of accounts || []) {
        for (const key of importIdentityKeys(account)) keys.add(key);
      }
      return keys;
    }

    function accountExistsInImportKeys(account, existing) {
      return importIdentityKeys(account).some((key) => existing.has(key));
    }

    function failureImportItem(sourceName, accountName, error) {
      return {
        id: createId(),
        ok: false,
        status: "无法解析",
        sourceName,
        error: error || "解析失败",
        accountName: accountName || "未知账号",
      };
    }

    function buildPendingImportItems(entries, sourceName, options = {}) {
      const existing = options.existingKeys || buildExistingImportKeys(options.existingAccounts || []);
      return (entries || []).map((entry) => {
        if (!entry.ok || !entry.session) {
          return failureImportItem(sourceName, entry.accountName || entry.sourceName, entry.error || "解析失败");
        }
        const session = entry.session;
        const account = normalizeLocalAccount({
          id: createId(),
          name: entry.accountName || session.email || shortId(session.tokens?.account_id) || "未命名账号",
          email: session.email || "",
          group: "默认",
          priority: "normal",
          usageNote: sourceName,
          expiryNote: session.expires || "",
          accountId: session.tokens?.account_id || "",
          expiresAt: session.expires || "",
          planType: session.profile?.plan || "",
          usage: hasUsageSnapshot(session.usage) ? normalizeUsage(session.usage, session.profile?.plan) : null,
          session,
        });
        const existsInPool = accountExistsInImportKeys(account, existing);
        const token = tokenState(account);
        const hasRt = hasUsableRefreshToken(account);
        return {
          id: createId(),
          ok: true,
          status: existsInPool ? "更新" : "新增",
          sourceName,
          account,
          accountName: account.name,
          email: account.email,
          accountId: account.accountId,
          plan: planLabel(accountPlan(account)),
          tokenLabel: token.label,
          hasRt,
          warning: hasRt ? "" : "仅 AT：当前不能用于 Codex，请重新登录 Codex 获取 RT。",
        };
      });
    }

    function normalizePendingImportStatuses(items, options = {}) {
      const existing = options.existingKeys || buildExistingImportKeys(options.existingAccounts || []);
      const seen = new Set();
      const normalized = [];
      for (const item of items || []) {
        if (!item.ok || !item.account) {
          normalized.push(item);
          continue;
        }
        const keys = importIdentityKeys(item.account);
        if (keys.some((key) => seen.has(key))) continue;
        const existsInPool = accountExistsInImportKeys(item.account, existing);
        keys.forEach((key) => seen.add(key));
        normalized.push({ ...item, status: existsInPool ? "更新" : "新增" });
      }
      return normalized;
    }

    function summarizeImportPreview(items = []) {
      const importable = items.filter((item) => item.ok);
      const added = items.filter((item) => item.status === "新增").length;
      const updated = items.filter((item) => item.status === "更新").length;
      const failed = items.filter((item) => item.status === "无法解析").length;
      const atOnly = importable.filter((item) => item.hasRt === false).length;
      return {
        total: items.length,
        importable: importable.length,
        added,
        updated,
        failed,
        atOnly,
        text: items.length
          ? `解析到 ${items.length} 个，新增 ${added} 个，更新 ${updated} 个，失败 ${failed} 个${atOnly ? `，仅 AT ${atOnly} 个` : ""}`
          : "还没有待导入账号",
      };
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

    function findImportedAccounts(accounts, importedAccounts) {
      const wantedKeys = new Set();
      for (const account of importedAccounts || []) {
        for (const key of importIdentityKeys(account)) wantedKeys.add(key);
      }
      const found = [];
      const seen = new Set();
      for (const account of accounts || []) {
        const matched = importIdentityKeys(account).some((key) => wantedKeys.has(key));
        if (!matched || seen.has(account.id)) continue;
        seen.add(account.id);
        found.push(account);
      }
      return found;
    }

    function previewImportEntries(entries = []) {
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

    return Object.freeze({
      importStatusClass,
      importIdentityKeys,
      buildExistingImportKeys,
      accountExistsInImportKeys,
      buildPendingImportItems,
      normalizePendingImportStatuses,
      summarizeImportPreview,
      accountToImportPayload,
      findImportedAccounts,
      previewImportEntries,
      hasUsageSnapshot,
    });
  }

  return {
    createImportCore,
    importStatusClass,
    hasUsageSnapshot,
  };
});
