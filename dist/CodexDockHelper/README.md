# Codex Dock

账号池管理、额度查看、智能切换和 Dock Helper 一键执行。

已部署地址：

```text
https://codex.woai.pro
```

## 当前架构

- 控制台：`index.html`、`app.js`、`styles.css`，部署到 Cloudflare Worker Static Assets；未登录默认使用浏览器本地账号池。
- 云端 API：`cloud-worker/worker.js`，处理注册、登录、账号导入、额度快照、切换 payload、设备、审计记录和管理员接口。
- 云端数据库：Cloudflare D1，数据库名 `codex-cloud-console`。
- token 存储：`account_secrets.encrypted_auth_json`，使用 Worker secret `TOKEN_ENCRYPTION_KEY` 加密落库。
- Dock Helper：`dist/CodexDockHelper/CodexDockHelper.exe`，只监听 `127.0.0.1`，负责写入 `%USERPROFILE%\.codex\auth.json` 并重启 Codex。

## 使用模型

- 默认免登录：打开 `https://codex.woai.pro` 后即可导入本地账号、同步本机 auth、刷新额度和切换。
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

Dock Helper 不托管账号管理页，`/console/` 会返回 404。关闭窗口不会退出，只会驻留系统托盘；托盘菜单可以显示窗口、打开 Codex Dock、打开本地状态页、重启服务或退出。

## 旧本地缓存迁移

旧版账号池如果存过浏览器 `localStorage`，云端页面不能直接读取，因为 `https://codex.woai.pro` 和 `http://127.0.0.1:18766` 是不同 Origin。

在设置里的“数据”页点击 `从旧本地缓存迁移`。页面会打开 Dock Helper 的 `/migrate-cache` 迁移页，由它读取旧 Origin 下的 `codex-account-switcher-store-v3`，再通过 `postMessage` 导入当前浏览器本地账号池；若用户已选择“合并并同步”，会继续上传云端。

## 云端部署

```powershell
cd cloud-worker
npm install
npm run build
npx wrangler d1 execute codex-cloud-console --remote --file ./schema.sql
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

## 切换链路

1. 控制台优先从 `codex-local-store-v5` 读取本地账号池。
2. 若账号有本地 token，浏览器直接生成项目二格式 `auth.json` payload。
3. 若账号只有云端密文，登录后由云端解密并返回项目二格式 payload。
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
- `POST /api/accounts/:id/switch-payload`
- `GET /api/devices`
- `POST /api/devices/register`
- `GET /api/audit`
- `GET /api/admin/summary`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `DELETE /api/admin/users/:id/sessions`
- `GET /api/admin/audit`

## 合规边界

这个工具不绕过手机号验证、不抓取账号密码、不代替真人完成登录验证。它只管理你已经合法取得的 session/auth 信息。
