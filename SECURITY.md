# 安全政策

Codex Dock 会管理本地 Codex App auth 状态，并可选地进行加密云同步。安全问题请优先私下报告，避免在公开 issue 中泄露可利用细节。

## 支持版本

当前维护线是 `main`/`master` 分支，以及通过仓库或部署域名发布的最新 Dock Agent。

旧版 Agent 二进制可能仍能运行，但安全修复会优先落在当前发布线。

## 报告漏洞

请不要在公开 issue 中发布漏洞利用细节、token、auth payload 或私有日志。

推荐路径：

1. 如果仓库启用了 GitHub Security Advisories，请优先使用它。
2. 如果未启用 advisories，请通过维护者的私有渠道联系，并在第一条消息中只提供脱敏证据。
3. 说明复现步骤、受影响版本、部署模式和影响范围。

有帮助的信息：

- 托管版还是自部署。
- 浏览器和操作系统。
- Dock Agent 版本。
- 是否开启登录/云同步。
- 不包含真实凭据的最小复现。
- API 响应中的 request id。

## 敏感数据

请不要发送：

- Access token 或 refresh token。
- `%USERPROFILE%\.codex\auth.json`。
- Device bearer token。
- Cloudflare API token。
- `TOKEN_ENCRYPTION_KEY`。
- 包含真实邮箱的完整账号列表。

## 预期安全边界

安全相关改动应保持这些边界：

- 未登录意味着账号数据保存在浏览器本地，不上传云端。
- Dock Agent 只监听 `127.0.0.1`，并校验允许的 Origin。
- 管理员 API 不返回 token 明文或加密 payload 原文。
- 云端账号 payload 写入 D1 前必须加密。
- 自动切换必须等待本地安全边界，再写入 auth。
- 自助注销会删除用户拥有的账号、设备、session 和个人审计。
