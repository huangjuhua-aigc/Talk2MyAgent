# 本机日历方案测试报告

日期：2026-11-17。代码涉及 `Talk2MyAgent` 与 `dsh-a2a`；Relay 代码和线上部署未修改。测试前两个仓库均已 fetch，并确认本地 main 与 origin/main 一致（0 ahead / 0 behind）；在保留原有未提交改动的基础上完成本地方案替换。

## 0.5.0 发布回归（2026-11-17）

- 插件：256 项 Vitest 和 16 项日历核心测试通过；已显式开启本地 Relay 集成。
- 原生 Microsandbox：10 项通过，包含公共硬链接独立副本、Python 写入边界、访客隔离和磁盘持久化；10 分钟真实时钟长测未重跑，生命周期测试使用可控时钟。Docker 专用测试未运行。
- Portal：36 项后端测试（包括用发布包全新安装沙箱）、57 项 Playwright UI 测试通过（其中 8 项公网发布 UI 用本地 Relay 单独执行）；两仓库类型检查和生产构建通过。
- 真实 DeepSeek 模型经过本地 Portal、Relay、Connector 调用 Google/飞书适配器，两条链路均通过；外部日历 API 使用夹具，每渠道只创建一条夹具事件，没有改动真实日历。
- 独立真实 Google、飞书账号测试已完成，见插件仓库的 [Google 报告](https://github.com/huangjuhua-aigc/dsh-a2a/blob/main/docs/test-report-google-calendar-live.md)和 [飞书报告](https://github.com/huangjuhua-aigc/dsh-a2a/blob/main/docs/test-report-calendar-live.md)。
- 全新安装回归发现并修复 Windows 短 TEMP 路径与规范路径比较不一致造成的清理报错；修复后发布包全新安装、自动准备沙箱和缓存复用均通过。
- npm 包校验：包含本地日历模块和预约技能；发布包未包含本机数据库、OAuth 配置或运行记录。

## 实现结果

移除独立日历授权服务和企微。Google 使用本机 loopback + PKCE；飞书使用官方 SDK 创建专属应用，再进行设备授权。token 和专属应用凭据加密保存在本机；Agent 直接调用平台并刷新 token。Portal 仅负责授权和状态界面，不是日历调用代理。

飞书界面明确分两步：创建应用后，返回 Portal 点击「继续授权飞书日历」。这样不会依赖浏览器允许跨域修改已打开弹窗。Google 连接按钮不再要求预置 Client ID：首次点击展开指引、导入用户自己的 Desktop 客户端 JSON，再进入授权；以后复用加密保存的本机配置。

## 本次 Google 配置导入回归

以下结果是在加入用户自行导入客户端配置后重新执行的：

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 本机日历核心 | 12 通过 | Desktop JSON 校验、拒绝 Web/服务账号和非法配置、忽略自定义 API 地址、加密落盘、跨进程读取、Agent 配置隔离、断开保留/删除配置及原有预约边界 |
| Portal 后端全量 | 34 通过，1 跳过 | 无环境变量导入、CSRF、授权中/连接中拒绝替换、重启进程后复用、配置不回显及原有后端回归；首次安装真实运行时用例按原开关跳过 |
| Playwright 日历 UI | 3 通过 | Google 按钮可用、首次配置说明、错误 JSON、Web 客户端拒绝、成功导入/授权、刷新及重新授权、取消、390px 布局；飞书原流程 |
| 两仓库 TypeScript 检查 | 通过 | 前后端类型 |
| 插件构建及发布包导入 | 通过 | 打包后的 calendar 代码可加载 |
| 本地中继端到端 | Google、飞书均通过 | 真实 Portal、Agent runtime、Relay/Connector；Google 经新 JSON 导入接口授权；关闭 Portal 后刷新 token 并完成预约。此次模型和平台响应使用夹具，每渠道仅创建一个测试事件 |
| Git diff 空白检查 | 通过 | 两仓库 |

另在实际本机 Portal 上检查 Google 未配置时按钮可点击、可展开导入指引，未向用户目录导入测试凭据。真实 Google 账号授权仍需用户下载自己的 Desktop 客户端 JSON 后验收。

## 前一版本地日历方案基线

以下为本次导入界面调整前已完成的测试记录；本次没有再次跑完整 Vitest、完整 UI 或真实模型套件。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 插件 Vitest 全量 | 252 通过，12 跳过 | A2A、真实运行时、访客隔离、Relay 集成、日历工具边界；跳过的是需要显式启用的 2 个 Docker 和 10 个 Microsandbox 真机集成用例 |
| 本机日历核心测试 | 10 通过 | 加密落盘、两渠道预约、跨访客拒绝、跨进程并发、刷新旋转、防重复、取消和断开竞态 |
| Portal 后端全量 | 34 通过，1 跳过 | 授权、CSRF、保存启动配置、访客管理、停止/启动边界等；跳过首次安装真实运行时用例 |
| Playwright UI 全量 | 57 通过，0 跳过 | 两渠道授权、刷新页面持久化、断开、未配置 Google、其他现有界面回归 |
| 两仓库 TypeScript 检查 | 通过 | 后端与前端类型 |
| 插件构建及发布包导入 | 通过 | 仅声明的依赖、calendar 库、meeting-booking 技能随包提供 |
| 技能格式校验 | 通过 | meeting-booking |
| Git diff 空白检查 | 通过 | 两仓库 |

最后补充的取消写入与凭据保存竞态变更，已重新跑过 10 个核心用例与 3 个 Portal 日历后端用例。测试未重新执行 Docker/Microsandbox 真机生命周期测试；本次不改变沙箱实现。

## 真实模型端到端

执行 `node --import tsx scripts/test-calendar-e2e.mjs --real-model`，两渠道均通过：

1. 真实 Portal 完成本机授权流程并保存加密凭据。
2. 启动真实 DSH Agent、真实本地 Relay 与 Connector。
3. **关闭 Portal 进程**，让已保存 token 过期，验证 Agent 自行刷新。
4. 真实 DeepSeek 模型经 A2A 完成找时段 → 预约提案 → 明确确认 → 创建 → 查询。
5. 每个渠道恰好创建 1 个事件，确认/查询不重复创建。
6. 解除本机授权并检查凭据文件已移除。

早期一次真实模型运行在回复生成过程中达到测试的 120 秒任务上限，返回 `task_timeout`，不是日历授权或中继断线。测试没有重发同一写入；后续使用新的隔离测试目录，限制测试回复长度、将真实模型测试任务上限调至 300 秒，两渠道完整通过。生产默认任务时限未更改。

**外部平台的同意页与日历 HTTP API 为测试夹具。** 实际 Portal、官方飞书 SDK、本机回调/加密/锁、Agent、模型、Relay/Connector 都真实运行，但没有修改真实 Google/飞书日历。真实 OAuth 应用审核、企业管理员策略及真实事件写入尚未验收。

## 可复现命令

```powershell
$env:A2A_PLUGIN_SOURCE = 'D:\code\dsh-a2a'
$env:A2A_HOST_SOURCE = 'D:\code\Talk2MyAgent'
$env:A2A_RELAY_SOURCE = 'D:\code\a2a-relay-server'
$env:A2A_CONNECTOR_SOURCE = 'D:\code\Talk2MyAgent\packages\a2a-connector'

cd D:\code\dsh-a2a
pnpm typecheck
pnpm test
pnpm test:package
node --import tsx scripts/test-calendar-e2e.mjs --real-model

cd D:\code\Talk2MyAgent\packages\a2a-host
pnpm typecheck
pnpm test
pnpm test:ui
```

UI 截图在本机 `packages/a2a-host/test-results/calendar-local-calendar-authorization-UI-google/calendar-google.png` 和对应 `feishu` 目录。Playwright 报告在 `packages/a2a-host/playwright-report/`。它们是测试产物，不包含真实授权凭据。

## 当前本机与发布状态

Portal 已用新代码启动：`http://127.0.0.1:17890/`。已在浏览器核实 Google 按钮可点击、首次配置指引可展开。尚未 Git 提交/推送、npm 发布或修改线上 Relay。Google 客户端由开源框架用户在页面导入，不再依赖维护者预置产品 ID。
