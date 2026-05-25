const assert = require("node:assert/strict");
const { createImportCore } = require("../import-core.js");

let id = 0;
const core = createImportCore({
  createId: () => `id-${++id}`,
  accountDedupeKey(account) {
    if (account?.accountId || account?.session?.tokens?.account_id) return `account:${String(account.accountId || account.session.tokens.account_id).toLowerCase()}`;
    if (account?.email || account?.session?.email) return `email:${String(account.email || account.session.email).toLowerCase()}`;
    return `id:${account?.id || "unknown"}`;
  },
  authFingerprint(session) {
    const tokens = session?.tokens || {};
    return [tokens.account_id || "", tokens.access_token || "", tokens.refresh_token || ""].join("|");
  },
  normalizeLocalAccount(account) {
    return {
      ...account,
      id: account.id || `normalized-${++id}`,
      name: account.name || account.email || "Unnamed",
      accountId: account.accountId || account.session?.tokens?.account_id || "",
      email: account.email || account.session?.email || "",
      planType: account.planType || account.session?.profile?.plan || "",
    };
  },
  normalizeUsage(usage) {
    return usage || null;
  },
  accountPlan(account) {
    return account?.planType || "free";
  },
  hasUsableRefreshToken(account) {
    return Boolean(account?.session?.tokens?.refresh_token);
  },
  shortId(value) {
    return value ? String(value).slice(0, 4) : "未识别";
  },
  planLabel(value) {
    return value === "plus" ? "Plus" : value || "未知";
  },
  tokenState(account) {
    return { label: account.session?.tokens?.refresh_token ? "RT" : "AT" };
  },
});

const existingAccounts = [{ id: "existing", accountId: "acct-existing", email: "old@example.com" }];
const entries = [
  {
    ok: true,
    accountName: "Existing",
    session: {
      email: "old@example.com",
      profile: { plan: "plus" },
      tokens: { account_id: "acct-existing", access_token: "at-existing", refresh_token: "rt-existing" },
    },
  },
  {
    ok: true,
    accountName: "Fresh",
    session: {
      email: "fresh@example.com",
      profile: { plan: "free" },
      tokens: { account_id: "acct-fresh", access_token: "at-fresh", refresh_token: "" },
    },
  },
  { ok: false, sourceName: "broken.json", error: "bad json" },
];

const pending = core.buildPendingImportItems(entries, "fixture.json", { existingAccounts });
assert.equal(pending.length, 3);
assert.equal(pending[0].status, "更新");
assert.equal(pending[0].plan, "Plus");
assert.equal(pending[0].hasRt, true);
assert.equal(pending[1].status, "新增");
assert.equal(pending[1].tokenLabel, "AT");
assert.match(pending[1].warning, /当前不能用于 Codex/);
assert.equal(pending[2].status, "无法解析");
assert.equal(pending[2].accountName, "broken.json");

const deduped = core.normalizePendingImportStatuses([...pending, { ...pending[1], id: "duplicate" }], { existingAccounts });
assert.equal(deduped.length, 3);

const summary = core.summarizeImportPreview(deduped);
assert.deepEqual(
  { total: summary.total, importable: summary.importable, added: summary.added, updated: summary.updated, failed: summary.failed },
  { total: 3, importable: 2, added: 1, updated: 1, failed: 1 },
);
assert.equal(summary.atOnly, 1);
assert.equal(summary.text, "解析到 3 个，新增 1 个，更新 1 个，失败 1 个，仅 AT 1 个");

const payload = core.accountToImportPayload(pending[1].account);
assert.equal(payload.email, "fresh@example.com");
assert.equal(payload.priority, "normal");
assert.ok(!("accountId" in payload));

const visible = core.findImportedAccounts(
  [{ id: "cloud-1", accountId: "acct-fresh" }, { id: "cloud-2", email: "other@example.com" }],
  [pending[1].account],
);
assert.deepEqual(visible.map((account) => account.id), ["cloud-1"]);

const preview = core.previewImportEntries(entries);
assert.equal(preview.preview, true);
assert.equal(preview.total, 3);
assert.equal(preview.failed, 1);
assert.match(preview.message, /识别到 2 个账号/);

console.log("import-core verification passed");
