# Codex Cloud Console 云端管理 + 本地执行架构

当前实现已经从“本地托管控制台 + 手动同步 Worker”切换为“本地优先控制台 + 可选云同步 + 本地执行器”。

## 部署形态

- 线上控制台：`https://codex.woai.pro`
- Cloudflare Worker：`cloud-worker/worker.js`
- 静态资源：Worker Static Assets，从根目录 `index.html`、`app.js`、`styles.css` 构建到 `cloud-worker/public`
- 数据库：Cloudflare D1 `codex-cloud-console`
- 本地执行器：`dist/CodexPlusLocalHelper/CodexPlusLocalHelper.exe`

## 数据边界

云端：

- 用户注册登录，首个注册用户自动成为管理员
- 账号池元数据
- 加密后的 auth/session payload
- 额度快照
- 设备状态
- 审计记录
- 管理员用户管理接口

浏览器本地：

- 默认账号池主视角 `codex-local-store-v4`
- UI 偏好、同步策略、设备 Key
- 从旧 `codex-account-switcher-store-v3` 自动迁移同源缓存

本地助手：

- 监听 `127.0.0.1`
- 校验请求 Origin
- 写入 `%USERPROFILE%\.codex\auth.json`
- 备份旧 auth
- 关闭旧 Codex 实例
- 通过 Windows Shell AppID 启动 Codex
- 提供极简状态页

本地助手不再托管账号管理页，也不再复制 `index.html/app.js/styles.css` 到 exe 目录。

## 切换链路

1. 用户打开云控制台，未登录也能读取本地账号池。
2. 用户点击切换。
3. 若账号有本地 token，浏览器直接生成 normalized `auth.json` payload。
4. 若账号只有云端密文，Worker 校验登录态，解密对应账号 secret。
5. 两种路径都使用项目二验证过的 payload：
   - `id_token = access_token`
   - 空 RT 或异常 RT 写成 `rt_mock_token`
   - 不写 `session_token`
6. 浏览器转发 payload 到本地助手 `/api/apply-auth`。
7. 本地助手执行项目二验证过的切换策略：关闭 Codex，再写 auth，再启动 Codex。
8. 已登录的云端切换写入审计记录；纯本地离线切换不强制写云审计。

## 安全取舍

为了“登录即用”，第一版采用服务端加密落库：Worker 可以在用户授权请求时解密 token。这不是零知识端到端加密，但 D1 中不保存 token 明文。

关键保护：

- `GET /api/accounts` 不返回 token。
- 管理员接口不返回其他用户 token，也不能导出密文原文。
- token 只存在于 `account_secrets.encrypted_auth_json` 密文字段。
- `TOKEN_ENCRYPTION_KEY` 通过 Cloudflare secret 注入，不写入源码。
- 本地助手只接受本机或配置的云控制台来源。

## 已验证项

- `https://codex.woai.pro/api/health` 正常。
- 注册、登录、账号导入、账号列表、switch payload、审计写入线上冒烟通过。
- 账号列表响应不包含测试 access token。
- D1 密文字段不包含测试 token 明文。
- 本地助手 `/console/` 返回 404。
- 云端页面可以从浏览器探测本机助手 `/api/health`。
