# 额度刷新通道策略

## 背景

云控制台需要刷新账号池中多个账号的额度状态。当前实现以本机 Helper 为主要执行通道：云端下发账号 auth payload，浏览器转交本机 Helper，由 Helper 使用本机网络请求 ChatGPT 用量接口，再把结果写回云端。

这个方向对账号安全更友好，因为额度请求的出口网络更接近用户真实使用 Codex 的环境。但它不应成为唯一选择：部分用户未安装 Helper，或者本机网络质量不佳，云端刷新也有实际价值。因此额度刷新能力需要产品化为可配置策略，而不是隐含在代码路径里。

## 目标

- 让用户明确选择额度刷新通道。
- 默认保护账号安全，优先使用本机 Helper。
- 在用户授权的情况下支持云端 Worker 刷新。
- 批量刷新必须限速、可观测、可审计。
- 高频检查不污染账号详情，只保留聚合摘要和必要异常。

## 刷新通道

### 本机 Helper 刷新

默认推荐模式。

流程：

1. 前端向云端请求账号 `auth payload`。
2. 前端把 `authJson` 发送给本机 Helper。
3. Helper 使用本机网络请求 ChatGPT 用量接口。
4. 前端把结果写回云端 `usage_snapshots`。

优点：

- 出口网络接近用户真实使用环境。
- 避免 Cloudflare 机房网络直接访问 ChatGPT。
- 云端不直接拿 auth 去请求第三方接口。

限制：

- 用户必须安装并运行 Helper。
- 本机网络差时刷新可能失败。

### 云端 Worker 刷新

可选模式，需用户明确开启。

流程：

1. Worker 从 D1 解密账号 auth。
2. Worker 请求 ChatGPT 用量接口。
3. Worker 写入 `usage_snapshots`。
4. 前端展示刷新结果。

优点：

- 不依赖用户安装 Helper。
- 对纯网页用户更方便。

风险：

- 请求出口为 Cloudflare 网络，可能与用户真实登录网络不同。
- 边缘节点和出口 IP 不一定固定。
- 批量请求可能更容易触发异常或风控。

## 设置项

建议在用户设置中增加：

- `usageRefreshMode`: `helper` | `cloud` | `auto` | `manual`
- `cloudUsageRefreshEnabled`: 是否允许云端刷新
- `helperFallbackToCloud`: Helper 失败后是否回退云端
- `usageRefreshConcurrency`: 批量刷新并发数
- `usageRefreshIntervalMs`: 批量刷新间隔
- `lastUsageRefreshSource`: 最近实际使用通道
- `lastUsageRefreshAt`: 最近刷新时间

默认值：

- `usageRefreshMode = helper`
- `cloudUsageRefreshEnabled = false`
- `helperFallbackToCloud = false`
- `usageRefreshConcurrency = 1`
- `usageRefreshIntervalMs = 1500`

## UI 要求

设置页增加「额度刷新方式」：

- 推荐：本机 Helper 刷新
- 云端 Worker 刷新
- 自动选择
- 仅手动刷新

每个选项必须有简短说明：

- Helper：使用本机网络，更接近真实 Codex 使用环境，需要安装 exe。
- 云端：无需 Helper，但使用 Cloudflare 网络访问 ChatGPT，用前需理解风险。
- 自动：优先 Helper，按设置决定是否回退云端。
- 手动：不自动刷新，只在用户点击时刷新。

刷新结果需要显示实际通道：

- `helper`
- `cloud-worker`
- `auto-helper`
- `auto-cloud-fallback`

## 审计与展示

账号详情不展示周期性额度检查流水。

账号详情展示聚合摘要：

- 今日刷新成功次数
- 今日刷新异常次数
- 最近刷新时间
- 最近刷新通道
- 最近异常原因

运行记录可以展示必要异常，但标题必须准确：

- Helper 额度刷新异常
- 云端额度刷新异常
- ChatGPT 用量接口异常
- auth 失效
- 账号不支持 Codex

不能把额度检查异常写成自动切换失败。

## Worker 限制与防护

云端刷新必须遵守 Cloudflare Worker 运行限制：

- 设置请求超时。
- 限制批量并发。
- 单用户每日云端刷新次数上限。
- 不在日志输出 token、auth、密文。
- 失败时只保存必要错误摘要。
- 管理员可全局关闭云端刷新。

建议管理后台增加：

- 是否允许用户启用云端刷新。
- 云端刷新单用户每日上限。
- 云端刷新并发上限。
- 异常账号是否自动暂停刷新。

## 验收标准

- 默认情况下，额度刷新使用本机 Helper。
- 未安装 Helper 时，用户可选择启用云端刷新。
- 自动模式能明确显示本次实际使用通道。
- 批量刷新限速，不能无间隔扫全量账号。
- 账号详情不出现高频 `auto-switch-check` 流水。
- 运行记录文案准确，不误导为切换失败。
- 云端刷新不泄露 auth/token。
- 相关设置持久化到云端并能跨设备生效。
