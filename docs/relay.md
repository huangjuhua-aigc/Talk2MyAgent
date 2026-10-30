# 公网中继

[简体中文](relay.md) · [English](relay.en.md)

用户不需要安装 Tailscale，也不用填写本地端口或配对码。在 Portal 选择“公网中继”，后台自动启动 Connector、注册 agent 并连接 Relay；上线后显示稳定地址和“复制聊天邀请”按钮。

Relay 的独立开源仓库：[a2a-relay-server](https://github.com/huangjuhua-aigc/a2a-relay-server)。Portal 与调用技能使用 0.2.0，DSH 协议插件继续使用 0.3.0。

## 用户操作

1. 按原流程配置模型、访客和允许读取的工作目录，保存并启动本地 agent。
2. 在管理页“公网中继”使用默认 Relay，点“开启公网发布”。新建向导也可直接选公网中继，保存启动后自动开启。
3. 状态变为“公网已上线”后，选择访客，复制聊天邀请，发送给对方。邀请包含公网 A2A 地址、完整名片地址、该访客的令牌及调用技能命令。
4. 需要停用时关闭公网发布。这样会断开中继，不会停止本地 agent，也不会取消已经接受的任务。

默认入口由维护者通过 Portal 环境变量 `A2A_RELAY_DEFAULT_HOST=https://实际域名` 提供。当前尚未内置一个真实的官方域名；未设置时，页面会显示“尚未配置”，可以选择“自定义 Relay host”。切换 host 前关闭当前发布，每个 host 独立保存设备身份和地址。

Relay 的端口写在服务地址中，例如本地联调的 `http://127.0.0.1:8787`，或使用自定义 HTTPS 端口的 `https://relay.example.com:8443`。高级网络设置中的端口属于本地 Agent，默认 `3080`；同机运行时不要改成 Relay 占用的 `8787`。Portal 启动前会检查端口冲突。Relay `/health` 正常只代表中继服务运行，需本地 Agent 与 Connector 上线后才能接待访客。`127.0.0.1` 仅用于本机联调，不能供另一台设备访问。

主页的 Agent 概览、公网中继、公开简报、来访记录均可折叠。浏览器按 Agent 记忆展开状态，折叠不会丢失当前页面未保存的简报或 Relay 输入；刷新页面前仍需保存编辑。

旧版本已经运行的 agent 需要在新 Portal 中停止并重新启动一次，以记录实际监听地址和已应用的访客权限。访客令牌或工作目录变更后也需要重启；未应用的凭据不会生成邀请。公开简报和指定工作目录读取保持原有功能，其他工具没有因中继而开放。

## 后台行为

关闭 Portal 页面或退出 Portal 进程后，已启动 Connector 继续运行。电脑和本地 agent 必须在线。普通断网自动重连并保留原地址；请求不会自动重发。已知任务 ID 时可以继续查询。公网地址不可用时，复制邀请按钮禁用，不会拿 localhost 代替。

关闭发布先切断本地转发；Relay 不可达时显示“云端状态待同步”，没有在线连接可接受新的请求。停止状态会保留一个轻量的本机控制进程，便于 Portal 再次开启；独立 Connector CLI 的 `shutdown` 可退出它。暂未安装系统开机启动服务，电脑重启后重新启动 Portal/CLI 与 agent 即可恢复。

设备凭据存放在 `~/.a2a/relay/<agentId>/`（或 `A2A_HOST_HOME` 对应目录），不会进入邀请。所有访客工作目录都必须与此私有目录分开。Portal 的 `17890` 仍仅供本机管理，不应转发到公网。Relay 运营者能够看到转发的内容和访客 Bearer 令牌，请选择你信任或自行部署的 Relay。

## CLI

```sh
pnpm --filter @talk2myagent/a2a-host start start AGENT_ID
pnpm --filter @talk2myagent/a2a-host start publish AGENT_ID
pnpm --filter @talk2myagent/a2a-host start publication AGENT_ID
pnpm --filter @talk2myagent/a2a-host start unpublish AGENT_ID
```

前一个 `start` 是 pnpm 脚本名，后一个是 host CLI 子命令。默认 Relay host 由环境变量提供；自定义 host 在 Portal 保存。独立 Connector 可显式指定本地 RPC/Card URL，参见 [Connector CLI](../packages/a2a-connector/README.md)。

## 联调测试

Node 22.13+，三个仓库分别安装依赖。以下以 PowerShell 为例：

```powershell
$env:A2A_RELAY_SOURCE='D:\code\a2a-relay-server'
pnpm --filter @talk2myagent/a2a-connector test
pnpm --filter @talk2myagent/a2a-connector test:integration
pnpm --filter @talk2myagent/a2a-host test:all
pnpm --filter @talk2myagent/a2a-skill test
```

UI 测试使用真实 Portal、Relay、后台 Connector 和调用技能，A2A 模型回复由测试服务提供。dsh-a2a 仓库另有实际 DSH 协议与 harness 的中继集成测试，模型使用确定性适配器。测试不读取用户工作资料，也不消耗付费模型额度。
