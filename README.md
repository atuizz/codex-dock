# Codex Dock

账号池管理、额度查看、智能切换和 Dock Helper 一键执行。

商业化打磨路线图见 `docs/commercial-hardening-roadmap.md`，发布与验收清单见 `docs/release-and-verification.md`。

已部署地址：

```text
https://codex.woai.pro
```

## 当前架构

- 控制台：`index.html`、`account-core.js`、`platform-clients.js`、`format-core.js`、`progress-ui.js`、`shell-ui.js`、`dialog-ui.js`、`settings-ui.js`、`account-list-ui.js`、`account-detail-ui.js`、`audit-core.js`、`admin-ui.js`、`panels-ui.js`、`import-core.js`、`import-ui.js`、`app.js`、`styles.css`，部署到 Cloudflare Worker Static Assets；未登录默认使用浏览器本地账号池。
- 云端 API：`cloud-worker/worker.js` 聚合 `worker-auth.js`、`worker-accounts.js`、`worker-usage.js`、`worker-settings.js`、`worker-helper.js`、`worker-audit.js`、`worker-admin.js` 和 `worker-user.js`，处理注册、登录、账号导入、额度快照、刷新通道、切换 payload、设备、审计记录和管理员接口。
- 云端数据库：Cloudflare D1，数据库名 `codex-cloud-console`。
- token 存储：`account_secrets.encrypted_auth_json`，使用 Worker secret `TOKEN_ENCRYPTION_KEY` 加密落库。
- Dock Helper：`dist/CodexDockHelper/CodexDockHelper.exe`，当前版本 `0.4.2`，只监听 `127.0.0.1`，负责写入 `%USERPROFILE%\.codex\auth.json`、重启 Codex、上报安全切换边界，并提供持久诊断日志。

## 使用模型

- 默认免登录：打开 `https://codex.woai.pro` 后即可导入本地账号、检查本机 auth、刷新额度和切换。
- 登录只用于云同步：登录后会弹出同步确认，可选择合并并同步、只使用本地，或拉取云端覆盖本地。
- 第一个注册用户自动成为管理员；管理员只能管理云控制台用户和统计，不能查看其他用户 token 明文。

## Dock Helper

构建：

```powershell
.\native-helper\build-helper.ps1
```

启动：

```powershell
.\dist\CodexDockHelper\CodexDockHelper.exe
```

状态页：

```text
http://127.0.0.1:18766/
```

Dock Helper 不托管账号管理页，`/console/` 会返回 404。关闭窗口不会退出，只会驻留系统托盘；托盘菜单可以显示窗口、打开 Codex Dock、重启服务或退出。

Helper 主窗口日志先写入 `%APPDATA%\CodexDock\helper.log` 和内存缓冲，再渲染到窗口；窗口关闭、恢复和 RichTextBox 渲染异常不会丢失日志。Helper 0.4.2 起会无论窗口是否可见都低频重新注册托盘图标，并提供本地托盘修复接口，防止 Windows 静默丢失 NotifyIcon 后出现“进程仍在但托盘不见”的状态。控制台会显示 Helper 版本并提示低于最低支持版本的设备升级，Helper 页会展示最新版、构建日期、下载入口和 SHA-256 校验值。

## 额度刷新与智能切换

- 额度刷新通道支持本机 Helper、云端 Worker、自动选择和仅手动刷新，默认推荐本机网络通道。
- 云端 Worker 刷新受 `CLOUD_USAGE_REFRESH_DAILY_LIMIT` 限速，批量刷新会聚合审计，避免把每个账号刷新写成噪音。
- 自动切换必须满足 Helper 上报的 `safe_to_switch` 和 `boundaryConfirmed`，不会在当前 Codex 任务仍可继续执行时抢切账号。
- 账号详情、设备诊断和审计会解释“能否使用、为何不能、下一步做什么”，技术 payload 不在列表或审计里暴露。

## 旧本地缓存迁移

旧版账号池如果存过浏览器 `localStorage`，云端页面不能直接读取，因为 `https://codex.woai.pro` 和 `http://127.0.0.1:18766` 是不同 Origin。

在设置里的“数据”页点击 `从旧本地缓存迁移`。页面会打开 Dock Helper 的 `/migrate-cache` 迁移页，由它读取旧 Origin 下的 `codex-account-switcher-store-v3`，再通过 `postMessage` 导入当前浏览器本地账号池；若用户已选择“合并并同步”，会继续上传云端。

## 云端部署

GitHub Actions 已提供：

- `.github/workflows/ci.yml`：运行 `npm run preflight`，验证 Worker/UI/Helper 逻辑、构建 Cloudflare 静态资源、构建 Windows Helper 并上传产物。
- `.github/workflows/cloudflare-deploy.yml`：手动触发，先在 Windows runner 跑完整 `preflight`，再由 `preview` 做 dry-run，或由 `production` 应用远端 D1 迁移、部署 Worker，并执行线上 smoke。

本地发布前验证：

```powershell
npm --prefix cloud-worker ci
npm run preflight
```

`preflight` 会把 Helper 验证构建输出到 `artifacts/build/CodexDockHelper`，避免本机正在运行的 `dist\CodexDockHelper\CodexDockHelper.exe` 锁住发布包时导致验证失败。正式更新发布包仍使用 `npm run helper:build` 或 `.\native-helper\build-helper.ps1`。静态资源构建会把发布包复制到 `downloads/CodexDockHelper.exe`，并在 `asset-manifest.json` 写入 Helper 版本、构建日期、大小和 SHA-256。

只跑 Worker/UI/静态资源验证时：

```powershell
npm test
```

本地部署命令：

```powershell
cd cloud-worker
npm install
npm run build
npx wrangler d1 execute codex-cloud-console --remote --file ./schema.sql
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

发布后 smoke：

```powershell
cd cloud-worker
npm run smoke:production
```

`smoke:production` 会注册一次临时云账号，验证登录/退出、额度刷新设置、设备登记、普通用户管理员拦截、账号列表不泄露 token，以及线上 Helper 下载包和本地 `dist` hash 一致。可用 `CODEX_DOCK_SMOKE_BASE_URL` 指向预览域名。

已有线上库升级时，改用 `npx wrangler d1 migrations apply codex-cloud-console --remote` 应用增量迁移，避免重复执行完整 schema。

线上 D1 以实际 schema 和 `d1_migrations` 账本共同作为运维依据。若 `npx wrangler d1 migrations list codex-cloud-console --remote` 显示待迁移，但远端列/表已经存在，先核对 `sqlite_master`、`PRAGMA table_info(...)` 和 `d1_migrations`，不要直接重复执行会撞列的历史迁移。

## 切换链路

1. 控制台优先从 `codex-local-store-v5` 读取本地账号池。
2. 若账号有本地 token，浏览器先确认是否带可用 RT；AT-only 默认不可用于 Codex。
3. 若账号只有云端密文，登录后由云端裁判账号状态，默认只为 `rt_ready` 返回项目二格式 payload。
4. 浏览器把 payload 发给 `127.0.0.1:18766/api/apply-auth`。
5. Dock Helper 关闭 Codex、写入 auth、通过 Windows Shell AppID 启动 Codex。
6. 已登录时云端记录审计；离线本地切换不强制写云审计。

## API 摘要

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/accounts`
- `POST /api/accounts/import`
- `PATCH /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/:id/usage`
- `POST /api/accounts/usage/refresh-all`
- `GET /api/settings/usage-refresh`
- `PATCH /api/settings/usage-refresh`
- `POST /api/settings/usage-refresh/recent`
- `POST /api/accounts/:id/usage/refresh-cloud`
- `POST /api/accounts/:id/switch-payload`
- `GET /api/devices`
- `POST /api/devices/register`
- `POST /api/devices/auto-switch-token`
- `DELETE /api/devices/auto-switch-token`
- `GET /api/audit`
- `GET /api/settings/auto-switch`
- `PATCH /api/settings/auto-switch`
- `GET /api/helper/auto-switch/config`
- `POST /api/helper/auto-switch/heartbeat`
- `POST /api/helper/auto-switch/current-usage`
- `POST /api/helper/auto-switch/next`
- `POST /api/helper/auto-switch/audit`
- `GET /api/admin/summary`
- `GET /api/admin/users`
- `GET /api/admin/devices`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `DELETE /api/admin/users/:id/sessions`
- `GET /api/admin/audit`

## 合规边界

这个工具不绕过手机号验证、不抓取账号密码、不代替真人完成登录验证。它只管理你已经合法取得的 session/auth 信息。

