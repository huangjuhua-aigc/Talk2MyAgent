# Talk2MyAgent

**把你的 AI 开放成一个在线 agent：任何访客（人或别的 agent）都能通过 A2A 协议找到它、跟它聊、派任务。**

你平时用 Claude Code、ZCode 这些 agent 干活；Talk2MyAgent 让其中一位（跑在
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上的 dsh agent）
常驻在线、对外可达——访客拿着你发的地址和令牌就能来聊，你本地有一个可视化控制台
看谁来过、都聊了什么。

## 组成

| 组件 | 仓库 | 状态 |
| --- | --- | --- |
| [dsh](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek 官方 | 前置运行时 |
| [dsh-a2a-server](https://github.com/huangjuhua-aigc/dsh-a2a) | 本组织 | A2A 协议插件（入站服务、开场背景注入、本地监控接口） |
| 配置与启动指南 | 本仓库 | **[docs/guide.md](docs/guide.md)** ← 从这里开始 |
| `a2a-host` 配置控制台（向导 + 监控台） | 本仓库 `packages/a2a-host` | **可用**（见下） |
| `a2a-skill`（出站：你的 agent 去找别人的 agent） | 本仓库 `packages/a2a-skill` | 基础 CLI 已实现并测试；完整协作流程待补 |
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

### 公开简报

Portal 的「公开简报」展示工作目录下 `.hop/handoff.md` 的内容与最近更新时间，每 5 秒自动刷新，也可手动编辑保存。自动刷新不会覆盖编辑框中尚未保存的内容。

「自动更新简报」默认开启：在线 agent 首次启动时整理一次，之后每小时从本地各 agent 的项目相关历史会话中汇总，完成后直接更新 `.hop/handoff.md`，无需草稿审核或采纳。没有新资料或生成失败时，维护指令要求保留原有简报。正式简报会在新访客会话开启时注入；进行中的会话不会自动更新。

Portal 只提供一个开启/关闭开关，不提供简报任务列表。开关状态持久保存，在线 agent 最迟在下一次 5 秒检查时读取；关闭后停止后续更新，正在执行的一次允许完成，现有简报和手动编辑保留。重新开启后会安排更新，反复刷新页面不会重复创建任务。调度运行于 agent 中，关闭 Portal 页面或控制台进程后仍可继续；agent 离线时暂停，重新启动只补一次到期更新，不补跑每个错过的小时。

升级时需同时更新本插件和控制台并重启 agent；控制台启动 agent 时会刷新生成的配置。旧版 Portal 创建的、与当前工作目录和既有提示词精确匹配的「简报维护」任务，会在提供调度服务的 DSH 中自动移除，由新的开关接管。已有 `handoff.draft.md` 不会自动发布。

## 自动化测试

```sh
pnpm --filter @talk2myagent/a2a-host test:all
pnpm --filter @talk2myagent/a2a-skill test
```

控制台测试包括真实本机 HTTP/IPC 与独立临时文件，以及 Playwright 浏览器用例。Windows 默认使用已安装的 Edge；其他系统先运行 `pnpm --filter @talk2myagent/a2a-host exec playwright install chromium`。浏览器选择、用例清单和报告位置见 [测试说明](packages/a2a-host/tests/README.md)。

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
- **M4（部分完成）**：出站 skill 已有通讯录、名片读取、发送和任务查询；多轮续聊、流式出站、跨 agent 上下文迁移待实现。

## 安全模型（一句话版）

访客的每条消息都要过四道闸：网络层（隧道/反代 + TLS）→ 身份层（独立 token）→
应用层（白名单、限流、受控 `read_file` 目录边界）→ 可选的系统隔离。访客只能读取
授权目录中的文本，写入和命令工具未开放；主人管理走独立本机 IPC。内置只读沙箱本身不限制读范围，未来开放其他工具时仍需单独设计隔离。详见指南第 1、6.1 节。

## License

MIT
