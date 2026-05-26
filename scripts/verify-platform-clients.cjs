const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "platform-clients.js"), "utf8");

async function main() {
  const calls = [];
  const context = {
    window: {},
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { ok: true, mode: "native-helper", tray: { visible: true } };
        },
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const api = context.window.CodexPlatformClients;
  assert.ok(api);
  const helper = api.createHelperClient("http://127.0.0.1:18766/");
  assert.equal(helper.base, "http://127.0.0.1:18766");

  const result = await helper.repairTray();
  assert.equal(result.ok, true);
  assert.equal(calls.at(-1).url, "http://127.0.0.1:18766/api/tray/repair");
  assert.equal(calls.at(-1).init.method, "POST");
  assert.equal(calls.at(-1).init.cache, undefined);
  assert.deepEqual(Object.fromEntries(Object.entries(calls.at(-1).init.headers)), {});

  await helper.health();
  assert.equal(calls.at(-1).url, "http://127.0.0.1:18766/api/health");
  assert.equal(calls.at(-1).init.cache, "no-store");

  await helper.diagnosticsExport();
  assert.equal(calls.at(-1).url, "http://127.0.0.1:18766/api/diagnostics/export");
  assert.equal(calls.at(-1).init.cache, "no-store");

  await helper.resumeAutoSwitch();
  assert.equal(calls.at(-1).url, "http://127.0.0.1:18766/api/auto-switch/resume");
  assert.equal(calls.at(-1).init.method, "POST");
  console.log("platform-clients verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
