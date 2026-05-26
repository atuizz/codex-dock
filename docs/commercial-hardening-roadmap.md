# Codex Dock 商业化打磨路线图

本文档记录当前 Cloudflare 生态版本进入商业运营水准前的重构顺序。当前目标不是另起架构，而是在现有 Workers Static Assets + Worker API + D1 + 本地 Dock Helper 的形态上，分批清理、规范、加固和验证。

商业化 UI、账号健康中心、Helper 诊断、运营后台和 E2E 验收的后续问题已归纳到 [commercial-productization-backlog.md](commercial-productization-backlog.md)。当前发布与验收步骤以 [release-and-verification.md](release-and-verification.md) 为准。

## 当前基线

- 线上控制台通过 Cloudflare Worker Static Assets 提供 `index.html`、`account-core.js`、`platform-clients.js`、`format-core.js`、`progress-ui.js`、`shell-ui.js`、`dialog-ui.js`、`settings-ui.js`、`account-list-ui.js`、`account-detail-ui.js`、`audit-core.js`、`admin-ui.js`、`panels-ui.js`、`import-core.js`、`import-ui.js`、`app.js`、`styles.css`。
- 云端 API 在 `cloud-worker/worker.js`，数据真相源为 Cloudflare D1 `codex-cloud-console`。
- 本地执行器为 `dist/CodexDockHelper/CodexDockHelper.exe`，源码位于 `native-helper/*.cs`，主窗口和 HTTP/API 编排仍在 `CodexPlusLocalHelper.cs`，托盘菜单、软按钮、日志框和任务进度弹窗等桌面控件已拆到 `HelperDesktopUi.cs`，自动切换配置模型已拆到 `AutoSwitchConfig.cs`，通用数据模型已拆到 `HelperModels.cs`，Codex 运行态与安全切换状态模型已拆到 `CodexRuntimeStatus.cs`；运行时只监听 `127.0.0.1`。
- token 明文不返回给账号列表；云端密文在 `account_secrets.encrypted_auth_json`，由 Worker secret `TOKEN_ENCRYPTION_KEY` 解密。

## 第一阶段：包袱清理与 UI 规范

- 统一产品命名为 Codex Dock / Dock Helper；历史 `CodexPlusLocalHelper` 仅作为源码命名保留，发布路径统一使用 `dist/CodexDockHelper`。
- 修正文档中的旧缓存键、旧 EXE 路径和旧本地托管表述。
- 建立控制台设计令牌：颜色、边框、半径、阴影、焦点态、内容最大宽度和移动端安全高度。
- 修复 PC / Pad / Mobile 基础布局：侧栏、顶栏、筛选区、账号列表、设置弹窗、导入弹窗、进度弹窗不能横向溢出。
- Helper 窗口后续统一图标、标题、按钮层级、托盘文案和长任务状态展示。

## 第二阶段：代码提纯与 Cloudflare 适配

- 将 `app.js` 中账号规范化、usage 规范化、渲染、API、导入、管理台逻辑按模块边界拆分；账号/JWT/usage 纯函数已先落到 `account-core.js`，云端 API 与 Helper 通信已先落到 `platform-clients.js`。
- 将 `cloud-worker/worker.js` 中认证、账号、设备、Helper 自动切换、管理员接口、审计和加密工具拆分。
- 保持 D1 作为强一致业务数据源；KV 仅用于读多写少的配置、版本元数据或公开下载信息，不承载 token 或切换真相。
- 审阅 D1 查询索引、批量导入写入路径、审计写入路径和高频 Helper 轮询路径，减少不必要串行写入。

## 第三阶段：账号与 Token 保活

- 明确定义四层状态：浏览器登录 session、Helper device token、账号 access token、账号 refresh token。
- 云端负责候选账号选择、过期拦截、审计和策略下发。
- Helper 负责本机 auth 探测、Codex 空闲判定、切换执行、失败原因回传和本地日志。
- Helper device token 使用 60 天滑动 TTL、30 天轮换窗口和 7 天旧 token 宽限；Helper 每轮从云端拉取自动切换配置，并在云端下发 replacement token 时本地保存。
- 账号凭证以 RT 可刷新为商业运营默认；AT 是隐藏实验兼容能力，不是商业默认能力。`allowAt=false` 与 `showExperimentalAt=false` 为默认，AT-only 账号必须标注“当前不支持 Codex 使用”，且不进入手动切换、智能切换和 Helper 自动候选。
- 账号状态统一收敛为 `rt_ready`、`rt_invalid`、`at_unsupported`：`secretUpdatedAt < lastSwitchAt` 不代表云端 RT 已过期，只作为审计线索；`refresh token was already used`、`access token could not be refreshed`、`invalid_grant` 才视为 `rt_invalid`。
- RT 回写主路径应自动完成：Helper 只要已获得云端授权 token，就在切入后和切出前各做一次本机 auth 与云端 RT 比对；重新登录 Codex 产生新 RT 后，Helper 通过 `/api/helper/auto-switch/current-auth` 回写云端密文。手动“检查本机 auth”只是兜底入口。
- 所有保活失败必须给出可操作原因：未登录、设备未授权、AT 过期、无 RT、401、429、Helper 离线、Codex 未稳定空闲。

## 第四阶段：日志、版本与外网连接探索

- Worker 输出结构化日志，关键链路携带 request id、user id、device key、action 和 result；D1 audit metadata 同步保存 `requestId`。
- Worker API 入口已统一生成 `X-Request-Id`，并按结构化 JSON 输出 `worker.request` / `worker.exception`，便于 Cloudflare Workers Logs 按请求追踪。
- `writeAudit` 已统一输出 `worker.audit`，用户操作、管理员操作和 Helper 自动动作都能从 Workers Logs 追到 D1 审计。
- D1 审计区分用户操作、管理员操作、Helper 自动动作和系统兜底。
- Helper 增加本地滚动日志、版本号、构建时间和最近一次切换状态。
- 外网连接默认不开放本机写 auth 接口；如评估 Cloudflare Tunnel 或设备轮询，只允许短期凭证、明确配对、来源校验和可撤销授权。

## 验证门槛

- `npm run build` 能重新生成 Worker 静态资源。
- 控制台需通过桌面、平板、手机三种视口的渲染检查。
- Helper 需能编译并保留仅本机监听边界。
- Worker 需通过本地 smoke test，核心 API 不泄露 token 明文。
- 每个阶段完成后记录剩余风险，而不是凭视觉或单一构建结果宣布完成。

## 当前进展

- 已完成商业化专项质量门槛：额度刷新通道支持本机 Helper / 云端 Worker / 自动选择 / 仅手动；自动切换必须等待 Helper 上报安全轮次边界；Helper 日志先持久化再渲染，窗口隐藏/恢复和 RichTextBox 异常不会丢日志。
- 已补 Cloudflare Worker `worker-usage.js`、D1 `0005_usage_refresh_channels.sql`、用户刷新设置、刷新来源快照、批量刷新聚合审计和管理员 Helper 版本视图。
- 已将 Helper 升级到 `0.4.8`，上报版本与构建日期，控制台可识别过旧或低于最新发布的 Helper；Helper 主窗口、本地状态页和控制台设备页都具备更新检查/安全下载入口；自动切换同类失败连续出现 3 次后会暂停本机自动切换 30 分钟并支持控制台恢复；本地生命周期自检可验证日志持久化、日志视图恢复调度、托盘修复链路，并主动模拟 RichTextBox 渲染故障后确认日志视图可恢复；待切计划会持久保存并在重启后进入重新核验阶段，核验前不会写入 auth；自动切换执行会拆分展示候选选择、payload 下发、写入 auth、重启 Codex 和恢复窗口阶段；发布流程见 `.github/workflows/ci.yml` 和 `.github/workflows/cloudflare-deploy.yml`。
- 已建立设计令牌和多端布局基线，修复手机侧栏、主操作区、导入抽屉和进度明细的溢出风险。
- 已将前端账号/JWT/usage/导入解析纯函数抽离到 `account-core.js`，云端 API / Helper 通信抽离到 `platform-clients.js`，通用格式化与状态文案抽离到 `format-core.js`，进度弹窗抽离到 `progress-ui.js`，Shell/指标/工具栏状态抽离到 `shell-ui.js`，弹窗/抽屉/同步提示抽离到 `dialog-ui.js`，设置页渲染抽离到 `settings-ui.js`，账号列表/卡片渲染抽离到 `account-list-ui.js`，账号详情面板渲染抽离到 `account-detail-ui.js`，审计标题与诊断描述抽离到 `audit-core.js`，管理台统计/用户表/审计列表渲染抽离到 `admin-ui.js`，运行记录/Helper 状态/Token 安全摘要抽离到 `panels-ui.js`，导入预览/去重/payload 组装抽离到 `import-core.js`，导入抽屉预览/结果/模式状态渲染抽离到 `import-ui.js`，并补 `scripts/verify-format-core.cjs` / `scripts/verify-progress-ui.cjs` / `scripts/verify-shell-ui.cjs` / `scripts/verify-dialog-ui.cjs` / `scripts/verify-settings-ui.cjs` / `scripts/verify-account-list-ui.cjs` / `scripts/verify-account-detail-ui.cjs` / `scripts/verify-admin-ui.cjs` / `scripts/verify-panels-ui.cjs` / `scripts/verify-audit-core.cjs` / `scripts/verify-import-core.cjs` / `scripts/verify-import-ui.cjs` 回归脚本。
- 已更新 Worker Static Assets 构建脚本，确保 `account-core.js`、`platform-clients.js`、`format-core.js`、`progress-ui.js`、`shell-ui.js`、`dialog-ui.js`、`settings-ui.js`、`account-list-ui.js`、`account-detail-ui.js`、`audit-core.js`、`admin-ui.js`、`panels-ui.js`、`import-core.js`、`import-ui.js` 与控制台页面一起发布。
- 已为 Helper device token 增加 D1 过期字段、滑动保活、云端轮换下发和 Helper 本地保存 replacement token；账号切换 payload 会拦截“AT 已过期且无 RT”的账号。
- 已为 Worker 最外层入口补 `X-Request-Id`、结构化请求日志、结构化异常日志和带状态码的业务错误，减少线上排障盲区。
- 已把业务审计写入与 request id 串起来，`worker.audit` 日志和 `audit_logs.metadata_json.requestId` 可互相定位。
- 已补用户数据删除闭环：设置页提供带邮箱/密码确认的账号注销，Worker 保护最后一个管理员并以 D1 事务级联清除用户数据；仅以 `account_deletion_events` 保存无身份信息的删除计数供管理员查看，生产 smoke 在验收后自动删除临时用户和设备。
- 已修正 Helper 自动切换的硬失败路径：认证失效、额度/限流、账号停用这类 runtime trigger 会先登记为待切换原因；当前任务仍在执行时不切，任务 completed/failed 后进入 cooling 即触发换号，避免既卡死又误切。
- 已统一自动切换空闲确认语义：云端、前端和 Helper 默认均为 10 秒，`idleSeconds` 会在 Helper 侧真实参与普通自动切换判断；硬失败触发仍在任务结束后的短 cooling 阶段优先处理。
- 已修复设置弹窗在智能切换内容较长时撑破容器的问题，桌面与移动端均改为头部固定、内容内部滚动，避免面板溢出视口。
- 已清理前端本地存储的旧产品命名：设备 Key 与登录邮箱改用 `codex-dock-*` 键，并自动迁移 `codex-plus-*` / `codex-cloud-console-*` 旧键，避免老用户丢失授权状态。
- 已将手动账号切换接入分阶段进度弹窗：获取 auth、定位目标窗口、交给 Helper、等待 Codex 重启恢复目标、同步云端记录均有状态展示，并在任务未结束时阻止重复切换；桌面与移动端完成静态渲染验证。
- 已把自动切换判断改成可审计闭环：当前账号触发只来自真实 usage/API 错误或未过期 runtime trigger；工具命令、工具输出、用户/助手文本不再参与触发判断；Helper 会把硬失败 runtime trigger 显式传给 Worker，避免云端只按 usage 复判后误报“未命中切换条件/无可用候选”；候选 payload 不再提前写 `last_switch_at`，只有 Helper 回报 `switched` 后才进入冷却；无候选会返回候选排除摘要并进入控制台审计描述。
- 已细化控制台审计语义：`payload-issued`、`switched`、`no-candidate`、`deferred-active-task`、`trigger:*` 不再统称为“账号已切换”，审计描述会显示触发原因、候选排除汇总和样例账号，便于判断是额度、冷却、当前账号过滤还是授权问题。
- 已将 Helper 升级到 `0.2.4`，自动切换触发分类会在进入 runtime trigger 前排除 `shell_command`、`apply_patch`、`update_plan`、自定义工具调用、工具结果回显以及 `session_task.turn` 历史回合汇总；`response.failed` 只接受 `codex_otel.*` 或带 `codex.sse_event`/结构化错误字段的真实事件，可见额度限制只接受 `codex_otel` 或 `Turn error` 形态，避免诊断文本中的账号停用、限流、错误状态码等敏感词诱导误切。
- 已修正 Helper 日志语义：Worker 返回 `未命中切换条件` 时记录为“云端未确认切换条件”，只有真正返回候选排除摘要时才记录“无可用候选账号”，避免把触发误判误写成账号池无号。
- 已将 Helper 升级到 `0.2.5` 并补强切换任务体验：自动/手动切换会显示分阶段进度弹窗，阶段与执行日志一一对应，覆盖目标窗口定位、关闭 Codex、写入 auth、启动 Codex、恢复窗口、恢复目标状态、完成和失败提示。
- 已将 Helper 升级到 `0.2.6` 并修正 Codex refresh token 轮换风险：AT-only 不再作为默认候选；`refresh token was already used` / `access token could not be refreshed` 被归类为真实 auth 硬失败；Worker 会阻止“上次切换后未重新同步”的 RT 账号再次下发；Helper 会在本机 auth 发生非 Helper 写入变化时通过 device token 回传云端，用于捕获 Codex 刷新后的新 RT。
- 已将 Helper 升级到 `0.2.7` 并落地 AT 退位与 RT-only 默认策略：`GET /api/accounts` 返回 `credentialKind`、`codexUsable`、`codexBlockReason`、`secretUpdatedAt`；`switch-payload` 默认拒绝 AT-only / stale RT / invalid RT；设置页默认隐藏“允许 AT”，只有显式打开 `showExperimentalAt` 后才显示实验入口；Helper 写 auth 前默认拒绝空 RT、`rt_mock_token` 和 RT=AT。
- 已将 Helper 升级到 `0.2.9`：current-auth 回写收敛为两次机会校验，切入账号后在使用过程中与云端比对一次，准备因额度/错误切换前再强制比对一次；同一 RT 回传视为无需同步，只有本机 RT 与云端不同才更新密文，避免把“切换后未回写”误判成 RT 失效。
- 已将 Helper 升级到 `0.3.0`：新增 `http://localhost:1455/auth/callback` OAuth 回调监听；OAuth 网页登录完成后由 Helper 接收 `code/state`，回调页通过 `postMessage` 主动通知控制台，同时控制台轮询 `/api/oauth/callback/latest` 兜底并兑换 token，手动粘贴回调链接只作为兜底。
- 已同步修复线上 D1 漂移：补齐 `device_tokens.expires_at` / `rotated_from` 与索引，确认 `users`、`user_settings`、`device_tokens` schema 已覆盖 `0002`-`0004` 迁移，并修复远端 `d1_migrations` 账本；`npx wrangler d1 migrations list codex-cloud-console --remote` 已返回无待应用迁移。
- 已启动 Worker 功能层拆分：HTTP JSON 响应、请求 ID、结构化日志、时间工具、Cookie、密码哈希、token 随机数、JWT 解码和 AES-GCM token 加解密已从 `cloud-worker/worker.js` 抽离到 `cloud-worker/worker-shared.js`，并补 `scripts/verify-worker-shared.mjs` 覆盖底层工具。
- 已将 Worker 认证/session/OAuth 换 token 入口从 `cloud-worker/worker.js` 抽离到 `cloud-worker/worker-auth.js`，并补 `scripts/verify-worker-auth.mjs` 使用模拟 D1 覆盖注册、重复注册、登录、session 识别、退出登录和请求体过大拦截。
- 已将 Worker 账号/session/usage/候选判断从 `cloud-worker/worker.js` 抽离到 `cloud-worker/worker-accounts.js`，账号 CRUD、switch payload 与 Helper 自动切换共用同一套候选诊断；新增 `scripts/verify-worker-accounts.mjs` 覆盖当前账号避让、低额度过滤、硬失败、AT 过期无 RT、冷却、候选摘要和 payload 保真。
- 已将 Worker 自动切换设置抽离到 `cloud-worker/worker-settings.js`，将设备注册、Helper device token 验证、滑动保活、轮换下发、heartbeat、usage 上报、next 选号和 Helper 审计回调抽离到 `cloud-worker/worker-helper.js`；新增 `scripts/verify-worker-helper.mjs` 覆盖发 token、滑动保活、过期下线、轮换下发、硬触发无候选审计等通信链路。
- 已将 Worker 审计读写抽离到 `cloud-worker/worker-audit.js`，将管理员统计、用户管理、设备/审计查询、密码重置和最后管理员保护抽离到 `cloud-worker/worker-admin.js`；新增 `scripts/verify-worker-admin-audit.mjs` 覆盖 requestId 审计串联、切换成功时间写回、非管理员拦截、最后管理员保护、禁用用户清 session 和重置密码审计。
- 已将当前用户设置与改密码路由抽离到 `cloud-worker/worker-user.js`，新增 `scripts/verify-worker-user.mjs` 覆盖自动切换设置钳制/保存审计、弱密码拦截、旧密码校验、密码哈希更新和改密审计。
- 已启动 Helper 源码模块化：`native-helper/build-helper.ps1` 不再只编译单个 `CodexPlusLocalHelper.cs`，而是收集 `native-helper/*.cs` 并排除代理源码；`AutoSwitchConfig` 已拆到 `native-helper/AutoSwitchConfig.cs`，`AuthWriteResult`、`ProcessRecord`、`CodexRestoreTarget` 和 `ProtocolProbeResult` 已拆到 `native-helper/HelperModels.cs`，`CodexRuntimeStatus` 已拆到 `native-helper/CodexRuntimeStatus.cs`，托盘菜单、软按钮、日志框和任务进度弹窗等桌面控件已拆到 `native-helper/HelperDesktopUi.cs`，为后续继续拆长任务状态机、更新通道和日志生命周期打下边界。

## 下一批重构入口

- `app.js`：继续收束剩余事件绑定和页面编排逻辑；进度弹窗、Shell/指标/工具栏、弹窗/抽屉、导入抽屉、设置页、账号列表/卡片、账号详情面板、管理台核心渲染、运行记录/Helper 状态/Token 安全摘要已分别落到独立 UI 模块。
- `cloud-worker/worker.js`：主入口已收束到 API 编排和 Cloudflare fetch 包装；通用 Worker shared、认证、账号、用户设置/改密、自动切换设置、Helper 通信、审计、管理员均已落到独立模块。
- `native-helper/*.cs`：继续从 `CodexPlusLocalHelper.cs` 拆出长任务状态机、版本号/更新通道和本地滚动日志；Helper 本体桌面控件、进度反馈和安全日志框已落到 `HelperDesktopUi.cs`。

