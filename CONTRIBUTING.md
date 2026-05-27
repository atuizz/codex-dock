# 参与贡献

感谢你愿意改进 Codex Dock。这个项目会接触本地凭据、浏览器存储、Cloudflare 基础设施和 Windows 本地进程，因此任何改动都应该清晰、可验证，并明确数据边界。

## 适合贡献的方向

- 改进 README、文档、截图和上手路径。
- 为 `scripts/verify-*.cjs` 或 `scripts/verify-*.mjs` 补充聚焦的回归验证。
- 修复 UI 溢出、空状态、可访问性标签或诊断文案。
- 改进自部署配置和发布验证。
- 收紧隐私、脱敏和管理员边界。

## 开发环境

安装 Worker 依赖：

```powershell
npm --prefix cloud-worker ci
```

运行 Worker/UI 验证：

```powershell
npm test
```

运行完整预检，包括 Windows Dock Agent 构建：

```powershell
npm run preflight
```

只构建 Dock Agent：

```powershell
.\native-helper\build-helper.ps1
```

## Pull Request 检查清单

- 改动范围保持聚焦，围绕一个行为或一个文档目标。
- 不提交真实 token、auth payload、cookie、device bearer token 或 `%USERPROFILE%\.codex\auth.json`。
- 行为变更需要增加或更新验证脚本。
- 用户可见流程变化需要更新 README 或 `docs/`。
- Cloudflare schema 变化需要在 `cloud-worker/migrations` 增加增量迁移。
- Dock Agent 变更默认保留 `127.0.0.1` 本地 API 边界，除非改动本身就是经过评审的配对模型。
- 切换逻辑变更需要证明不会在未确认安全边界时打断活动中的 Codex 任务。

## 文档风格

- 先解释用户问题，再解释实现方式。
- 统一项目术语：Codex Dock、Web Console、Cloud Worker、D1、Dock Agent、账号池、额度刷新、智能切换。
- 讨论隐私时，要明确说明数据保存在哪里、什么时候上传。
- 发布流水线和证据链放在 `docs/release-and-verification.md`；README 保持上手导向。

## 报告问题

提交 issue 时尽量包含：

- 托管版还是自部署。
- 浏览器和操作系统。
- 相关的 Dock Agent 版本。
- 问题发生在本地模式还是登录同步模式。
- 已脱敏日志或截图。请移除邮箱、账号 ID、token 和请求 payload。

不要在公开 issue 中发布凭据或原始 auth JSON。
