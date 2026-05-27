# 隐私与安全

Codex Dock 的设计原则是本地优先、云同步可选。本文说明哪些数据留在本机，哪些数据会在用户确认后上传，以及云端和管理员能看到什么。

## 数据模式

| 模式 | 行为 | 是否上传账号数据 |
| --- | --- | --- |
| 未登录 | Web 控制台把账号池保存在当前浏览器本地；Dock Agent 仍可在本机执行切换 | 否 |
| 已登录但选择本地使用 | 用户有登录态，但当前浏览器账号池仍保持本地 | 不上传账号数据，除非之后选择同步 |
| 已登录并选择合并/同步 | 本地账号池会合并到云端账号池 | 是，auth/session payload 会加密保存 |
| 自部署 | 行为与托管版一致，但 Worker、D1 和 secret 归你控制 | 由你的部署控制 |

浏览器本地数据按站点 Origin 隔离。保存在 `https://codex.woai.pro` 下的数据不会自动共享给自部署域名，也不会自动共享给另一个浏览器配置文件。

## 本地保存什么

- 未登录时的账号池状态。
- UI 偏好和同步选择。
- 设备 Key 与本地 Agent 授权状态。
- Codex App auth 文件：`%USERPROFILE%\.codex\auth.json`，只在授权切换时由本地 Dock Agent 写入。
- Dock Agent 日志：`%APPDATA%\CodexDock\helper.log`。

Dock Agent 只监听 `127.0.0.1`，并在接受浏览器请求前校验允许的 Origin。

## 云同步保存什么

当已登录用户明确选择云同步时，Worker 可以保存：

- 账号元数据与标签。
- 额度快照和刷新来源信息。
- 加密后的 auth/session payload：`account_secrets.encrypted_auth_json`。
- 设备注册和心跳状态。
- 用户设置。
- 用户、Agent 和管理员操作审计。

Token 材料会先使用 Worker secret `TOKEN_ENCRYPTION_KEY` 加密，再写入 D1。账号列表 API 只返回元数据和诊断信息，不返回原始 token payload。

## 管理员边界

管理员可以：

- 查看用户、设备、账号健康和审计摘要。
- 禁用用户、清理 session、重置密码。
- 查看运营失败趋势和 Agent 版本分布。

管理员不能：

- 查看其他用户的 access token、refresh token 或原始 auth JSON。
- 通过管理员 API 导出加密 auth payload 原文。
- 绕过本地 Dock Agent 的安全切换检查。

## 切换边界

Codex Dock 不直接执行 Codex 任务。账号切换由本地 Dock Agent 完成：

1. 浏览器从本地数据或云端 Worker 获取切换 payload。
2. Dock Agent 检查 Codex 是否处于安全边界。
3. Agent 写入 `%USERPROFILE%\.codex\auth.json`。
4. Agent 通过 Windows Shell AppID 重启 Codex。
5. 只有用户已登录时，云端才记录审计。

自动切换依赖 `safe_to_switch` 和 `boundaryConfirmed` 等本地信号。如果当前 Codex 轮次还能继续，Agent 应推迟切换。

## 账号注销

`DELETE /api/me` 要求输入当前登录邮箱和密码。注销会通过 D1 级联删除该用户的账号、加密密文、设备、session 和个人审计；只保留匿名删除计数供运营统计使用。

## 本项目不做什么

- 不绕过 OpenAI、ChatGPT 或 Codex App 的登录要求。
- 不解决手机号验证、CAPTCHA 或账号所有权检查。
- 不抓取账号密码。
- 不把 AT-only 账号作为默认 Codex 切换路径。
- 不暴露可远程写入本机 Codex auth 文件的公网 API。

## 安全建议

- 优先使用具备 RT 的账号，Codex 切换稳定性更高。
- 只有在需要多设备或团队协同时再开启云同步。
- 如果需要完全掌控数据库位置、加密密钥轮换和审计保留策略，请自部署。
- 不要把 `TOKEN_ENCRYPTION_KEY`、Cloudflare token 或 `%USERPROFILE%\.codex\auth.json` 放进 git。
- Dock Agent device token 也是凭据；设备丢失时应撤销或重新生成。
- 发布新版本前运行 `npm run preflight`。
