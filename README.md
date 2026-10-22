# Talk2MyAgent

**把你的 AI 开放成一个在线 agent：任何访客（人或别的 agent）都能通过 A2A 协议找到它、跟它聊、派任务。**

你平时用 Claude Code、ZCode 这些 agent 干活；Talk2MyAgent 让其中一位（跑在
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上的 dsh agent）
常驻在线、对外可达——访客拿着你发的地址和令牌就能来聊，你本地有一个可视化控制台
（建设中）看谁来过、都聊了什么。

## 组成

| 组件 | 仓库 | 状态 |
| --- | --- | --- |
| [dsh](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek 官方 | 前置运行时 |
| [dsh-a2a-server](https://github.com/huangjuhua-aigc/dsh-a2a) | 本组织 | A2A 协议插件（入站服务、开场背景注入、本地监控接口） |
| 配置与启动指南 | 本仓库 | **[docs/guide.md](docs/guide.md)** ← 从这里开始 |
| `a2a-host` 配置控制台（向导 + 监控台） | 本仓库 `packages/a2a-host` | **可用**（见下） |
| `a2a-skill`（出站：你的 agent 去找别人的 agent） | 本仓库 | 规划中（M4） |
| `a2a-handoff`（跨 agent 上下文迁移） | 本仓库 | 规划中（M4） |

## 运行控制台（M3 已交付）

```sh
git clone https://github.com/huangjuhua-aigc/Talk2MyAgent
cd Talk2MyAgent
pnpm install
pnpm --filter @talk2myagent/a2a-host run build:web   # 构建界面（首次需要）
pnpm --filter @talk2myagent/a2a-host start           # 打开 http://127.0.0.1:17890
```

- 首次打开是**七屏向导**（检测 → 名片 → 模型 → 访客 → 工作区 → 网络 → 预览与启动），
  第 7 屏展示将写入的每个文件，确认后一键写入/装插件/启动；
- 配置过后打开就是**监控台**：谁来访过、说了什么、agent 答了什么（按访客分组的时间线，
  5 秒自动刷新），加启停和日志；
- 只绑 127.0.0.1：它管理令牌，绝不出本机。子命令：`a2a-host start|stop|status|monitor`
  可脱离界面使用。
- 命令行流（不打开界面）见指南第 4 节。

## 快速开始

一条命令先尝起来（需 Node 22+，已有 `DEEPSEEK_API_KEY`）：

```sh
dsh --profile a2a --from-default-profile web
dsh plugin --profile a2a add dsh-a2a-server
A2A_PEERS="alice:demo123" …  # 详见指南
```

完整五步（配置名片、发访客令牌、网络暴露、验证、监控）见
**《[配置与启动指南](docs/guide.md)》**。

## 路线图

- **M2（已完成）**：指南文档 + 插件开场注入与监控接口（dsh-a2a-server 0.3.0）
- **M3（已完成）**：`a2a-host` 本地控制台——七屏配置向导 + 监控台（谁来访过、聊了什么）
- **M4**：出站 skill（让任意支持 skills 的 agent 成为 A2A 客户端）与跨 agent 上下文迁移

## 安全模型（一句话版）

访客的每条消息都要过四道闸：网络层（隧道/反代 + TLS）→ 身份层（独立 token）→
应用层（白名单、限流、审批自动拒绝、per-peer 工作目录隔离）→ 系统层（**dsh 内置
沙箱锁写**；要把读写都圈在指定目录，用 Docker 档）。详见指南第 1、6.1 节。

## License

MIT
