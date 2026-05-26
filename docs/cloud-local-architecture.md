# Codex Cloud Console 云端管理 + 本地执行架构

当前实现已经从“本地托管控制台 + 手动同步 Worker”切换为“本地优先控制台 + 可选云同步 + 本地执行器”。

## 部署形态

- 线上控制台：`https://codex.woai.pro`
- Cloudflare Worker：`cloud-worker/worker.js`
- 静态资源：Worker Static Assets，从根目录 `index.html`、`account-core.js`、`platform-clients.js`、`format-core.js`、`progress-ui.js`、`shell-ui.js`、`dialog-ui.js`、`settings-ui.js`、`account-list-ui.js`、`account-detail-ui.js`、`audit-core.js`、`admin-ui.js`、`panels-ui.js`、`import-core.js`、`import-ui.js`、`app.js`、`styles.css` 构建到 `cloud-worker/public`
- 数据库：Cloudflare D1 `codex-cloud-console`
- 本地执行器：`dist/CodexDockHelper/CodexDockHelper.exe`

## 数据边界

云端：

- 用户注册登录，首个注册用户自动成为管理员
- 账号池元数据
- 加密后的 auth/session payload
- 额度快照
- 设备状态
- 审计记录
- 匿名注销事件计数，不保留已注销用户邮箱、用户 id、设备 key 或 token
- 管理员用户管理接口

浏览器本地：

- 默认账号池主视角 `codex-local-store-v5`
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
3. 若账号有本地 token，浏览器先校验是否带可用 RT；AT-only 默认标注为“不支持 Codex”。
4. 若账号只有云端密文，Worker 校验登录态，解密前先按 RT-only 策略裁判账号状态。
5. 两种路径都使用项目二验证过的 payload：
   - `id_token = access_token`
   - 默认必须带有效 `refresh_token`
   - 只有 `showExperimentalAt=true` 且 `allowAt=true` 的隐藏实验路径才允许空 RT 写成 `rt_mock_token`
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
- Helper device token 只以哈希形式存入 D1，云端按滑动 TTL 保活，并通过 `/api/helper/auto-switch/config` 下发 replacement token；本地 Helper 保存新 token 后继续轮询。
- 云端在发放切换 payload 前会拦截 AT-only、RT 已失效和缺少密文的账号，默认只有有可用 RT 的账号可以下发。
- `secretUpdatedAt < lastSwitchAt` 只作为审计线索，不代表云端 RT 已过期，也不阻断切换。Helper 发现本机 auth 中出现不同 RT 时会自动回写；如果本机 RT 与云端相同，则记录为无需同步。
- Helper 自动切换仍默认等待 Codex 空闲；当本地日志识别到认证失效、额度/限流或账号停用等硬失败时，只先记录待切换原因，等当前任务真正 completed/failed 后进入 cooling 阶段再换号。
- Worker 所有响应带 `X-Request-Id`；运行日志用结构化 JSON 输出请求、异常、状态码和耗时，用于 Cloudflare Workers Logs 追踪。
- D1 `audit_logs.metadata_json` 会保存同一个 request id，`worker.audit` 日志也输出 user id、device key、action 和 result，用于从线上日志回查具体业务动作。
- 用户可在设置页输入登录邮箱和当前密码执行 `DELETE /api/me`；D1 级联删除其账号密文、额度、设备、session 与个人审计，仅在 `account_deletion_events` 留下无身份信息的删除计数，管理员摘要可查看 24 小时注销量。

## 已验证项

- `https://codex.woai.pro/api/health` 正常。
- 注册、登录、账号导入、账号列表、switch payload、审计写入线上冒烟通过。
- 账号列表响应不包含测试 access token。
- D1 密文字段不包含测试 token 明文。
- 本地助手 `/console/` 返回 404。
- 云端页面可以从浏览器探测本机助手 `/api/health`。
