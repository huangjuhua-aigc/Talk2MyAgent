# 本机日历授权与自动预约（开发版）

Portal 仅提供 Google Calendar 和飞书。授权和凭据保管全部在本机完成，Agent 直接调用平台 API；无需额外的日历服务，Relay 无需修改或部署。

## 用户如何使用

1. 在已创建的 Agent 页面打开「日历授权」，选择一个渠道，点击「连接日历」。不需要先启动 Agent，也不会为授权启动沙箱。
2. Google 首次连接会展开配置指引：导入你自己的 Desktop OAuth 客户端 JSON，点击「保存配置并授权」，在浏览器登录、同意后回到本机临时回调页；之后复用已保存的配置。飞书先确认创建专属应用，再回到 Portal 点击「继续授权飞书日历」，登录并同意日历权限。企业策略可能需要管理员批准。
3. Portal 显示「已连接」后启动 Agent。已运行的 Agent 需要重启一次来加载预约技能与四个工具。授权成功后关闭 Portal 不影响 Agent 刷新 token 或预约。
4. 访客通过聊天查询时段、准备提案、确认后创建日程。每个 Agent 同时连接一种渠道。

解除连接会删除本机日历 token，并拒绝现有会话后续的工具调用；已开始的写入可能完成，已有日程保留。Google 客户端配置会保留，便于下次授权；解除后可通过「更换 Google 配置」重新导入，删除 Agent 时会一并删除该配置。解除连接不等同于平台撤销应用权限，如需要可去 Google/飞书账号设置撤销。旧云端授权格式不会自动继续使用，需先解除，再本机授权。

预约偏好在启动 Portal 前通过 `A2A_CALENDAR_INSTRUCTIONS` 设置，例如 `使用北京时间，仅工作日14:00–18:00，每场30分钟，至少提前一天`。这属于模型指令，不是硬性预约策略引擎。后端独立校验日期、时区、时长、访客归属、冲突和重复写入。

当前支持自动预约，只写主人日历；不发送邮件邀请、不创建视频会议、不取消或改期。主人审批与 IM 推送留作扩展，目前没有相应开关。

## Google 首次连接：使用自己的客户端配置

Google OAuth 需要 Client ID 来识别请求授权的应用。这由使用开源框架的人自行创建和持有，不要求维护者把共享 Client ID 写进框架。流程参考 OpenClaw 的 gog 技能：导入下载的客户端 JSON，再登录账号；Portal 将这些步骤放在页面里，无需手动复制字段或设置环境变量。

1. 在 [Google Cloud](https://console.cloud.google.com/projectcreate) 创建或选择自己的项目，启用 [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)。
2. 在 [Google Auth Platform](https://console.cloud.google.com/auth/branding) 配置应用信息。个人账号选择 External；测试模式下，在 Audience 中将自己的邮箱加入测试用户。
3. 在 [Clients](https://console.cloud.google.com/auth/clients) 创建 **Desktop app（桌面应用）** OAuth 客户端，下载 JSON。
4. Portal 选择 Google，点击可用的「连接日历」，选择 JSON 文件，点击「保存配置并授权」。只接受 Desktop 客户端，不接受 Web 客户端或服务账号。

配置按 Agent 加密保存在本机 `~/.a2a/calendar/calendar.sqlite`，不上传 Relay、不返回给页面、不写入源码。后续直接点「连接日历」即可复用；Portal 重启后也会保留。Google 平台要求的测试用户、应用审核仍然适用；External 应用处于 Testing 时，日历 refresh token 通常 7 天到期，届时需重新授权，见 [Google token 有效期说明](https://developers.google.com/identity/protocols/oauth2#expiration)。

兼容已有部署的 `A2A_GOOGLE_CLIENT_ID` / `A2A_GOOGLE_CLIENT_SECRET` 环境变量，但不再要求预置；页面导入的配置优先。Desktop 客户端属于公开客户端，不能依赖其中的 secret 作为应用的保密凭据。

授权采用随机端口 `http://127.0.0.1:<port>/oauth/callback`、一次性 state、S256 PKCE、离线访问。仅监听 loopback，不需要公网回调域名。权限为 `calendar.events`、`calendar.freebusy`、`calendar.calendarlist.readonly`，均带 `https://www.googleapis.com/auth/` 前缀。读取/写入授权用户的主日历。

## 飞书本地授权

使用官方 Node SDK 的 `registerApp` 一键创建专属应用，`createOnly: true`，不会改写已有应用；申请 `offline_access`、`calendar:calendar:readonly`、`calendar:calendar.event:create`。随后采用官方 CLI 同样的 device authorization 流程取得用户授权，无需填写回调地址或部署服务器。

专属应用的 App ID、App Secret、用户 access/refresh token 全部留在本机，不在产品中分发共享 App Secret。token 使用 `accounts.feishu.cn/oauth/v3/token`，刷新后的 refresh token 在后续 API 操作前落盘。用户主日历和主人身份由平台响应确定。忙闲查询使用该用户的 free/busy，包含平台提供的外部日历忙闲；创建日程写入该用户主日历。当前只支持飞书中国版。

## 本地数据与安全边界

- `~/.a2a/calendar/<agent>.connection.json` 是 AES-256-GCM 加密的本机连接文件，包含平台凭据。目录位于公共资料和所有访客工作区之外，不挂入沙箱、不进入模型输入。
- Windows 使用当前用户 DPAPI 保护主密钥；macOS/Linux 使用权限为 0700 的目录和 0600 的密钥文件。它防止凭据直接以明文落盘，不能防止已控制同一操作系统用户的程序。跨机器复制凭据不是本版本的迁移方案，应重新授权。
- 加密的预约账本存在同目录 `calendar.sqlite`。本机多个 Agent/Portal 进程通过数据库互斥记录串行处理同一存储目录下的预约；死进程锁可恢复。不同电脑和其他日历客户端不在该锁内，不能保证第三方日历的跨系统原子占位。
- 工具仅提供找时段、准备、确认、查询四种操作；不暴露任意 URL、日历操作或 token。已认证访客身份由后端捕获并派生，模型不能替换。
- 提案 15 分钟过期。确认时再查忙闲，并在外部写入前持久记录 `creating`。异常返回 `uncertain`，只能查询原预约 ID；不会自动重发创建。Google 使用固定事件 ID，飞书使用幂等键。外部事件被删除时返回 `missing`，不自动重建。
- 新增主人审批时应在确认与外部写入之间加入持久审批状态；IM 通知以独立适配器扩展。

## 开发与测试

日历功能需要 `dsh-a2a-server@0.5.0` 或更新版本及新版 Portal。Portal 会在启动前自动更新旧插件；更新后需重启 Agent 一次，本机已有授权会保留。仅源码开发时需要构建 `dsh-a2a` 并设置 `A2A_PLUGIN_SOURCE` 为仓库路径。

```powershell
$env:A2A_PLUGIN_SOURCE = 'D:\code\dsh-a2a'
cd D:\code\Talk2MyAgent\packages\a2a-host
pnpm typecheck
pnpm test
$env:A2A_RELAY_SOURCE = 'D:\code\a2a-relay-server'
pnpm test:ui

cd D:\code\dsh-a2a
$env:A2A_HOST_SOURCE = 'D:\code\Talk2MyAgent'
$env:A2A_CONNECTOR_SOURCE = 'D:\code\Talk2MyAgent\packages\a2a-connector'
pnpm test
pnpm test:package
node --import tsx scripts/test-calendar-e2e.mjs --real-model
```

测试覆盖真实 Portal、真实 SDK、本机回调/加密文件、Agent runtime、本地 Relay/Connector。平台同意页与外部日历 HTTP 使用测试夹具；不会修改真实日历。`--real-model` 使用真实 DeepSeek 模型，不回退固定回复。实际账号授权、组织策略、真实日程写入仍需用户完成平台授权后验收。结果见 [测试报告](calendar-test-report.md)。

官方参考：[Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[飞书一键创建应用 SDK](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs)、[飞书官方 CLI 设备授权实现](https://github.com/larksuite/cli/blob/main/internal/auth/device_flow.go)、[飞书 v3 token](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)。
