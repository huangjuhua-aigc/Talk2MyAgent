# Talk2MyAgent

把本地资料开放给获准的 A2A 访客。你的在线 agent 可以聊天、读取你指定工作目录中的文本，并根据本地项目记忆自动更新公开简报；你在本机 Portal 配置模型、访客和资料目录，查看来访记录。

设备不必在同一个局域网。按下面的 Tailscale 步骤配置后，访客可以从家里、公司或手机热点访问你的 agent。双方需要联网并连接 Tailscale，agent 所在电脑需要保持运行。

- [首次安装与启动](#首次安装与启动)
- [用 Tailscale 跨网络访问](#用-tailscale-跨网络访问)
- [完整使用指南](docs/guide.md)
- [Tailscale 详细教程与排错](docs/tailscale.md)

## 首次安装与启动

### 1. 准备运行环境

需要 Git、Node.js 22+、pnpm、DeepSeek Harness（dsh），以及向导中支持的一家模型服务的 API Key。Key 可以在向导里填写。

```sh
node --version
npm install -g pnpm @deepseek-ai/dsh@0.2.1-rc.2
pnpm --version
dsh --version
```

这里固定使用当前插件兼容的 dsh 版本；不要忽略插件安装时的版本不兼容提示。已有兼容环境可跳过安装。[DSH 官方说明](https://github.com/deepseek-ai/deepseek-harness)

### 2. 下载两个配套仓库并构建

在你保存项目的目录执行，两个仓库会成为相邻目录：

```sh
git clone https://github.com/huangjuhua-aigc/Talk2MyAgent.git
git clone https://github.com/huangjuhua-aigc/dsh-a2a.git
cd dsh-a2a
pnpm install
pnpm build
cd ../Talk2MyAgent
pnpm install
pnpm --filter @talk2myagent/a2a-host run build:web
pnpm --filter @talk2myagent/a2a-host start
```

浏览器会打开本机 Portal：[http://127.0.0.1:17890](http://127.0.0.1:17890)。这个地址只用于主人管理，不发给访客。

**当前主分支需配套源码插件。** 2026-10-26 核对时，npm 的 `dsh-a2a-server` 最新发布仍为 `0.2.0`，不包含主分支的权限修复与自动简报开关。请完成下一步的本地插件安装，不能仅依赖向导自动安装 npm 旧版。配套代码见 [dsh-a2a](https://github.com/huangjuhua-aigc/dsh-a2a)。

### 3. 在向导里保存配置

| 页面 | 填写内容 |
| --- | --- |
| 环境检测 | 确认 Node 和 dsh 可用 |
| 名片 | 首次示例取名 `my-agent`，描述你允许访客查询的内容 |
| 模型 | 选择服务商和模型，填写或沿用 API Key |
| 网络 | 先选「自定义地址」，填写 `127.0.0.1`，端口 `3080`；先完成本机验证，稍后切到 Tailscale HTTPS 地址 |
| 访客 | 每位访客使用独立令牌，勾选「允许对话和读取指定工作目录」 |
| 工作区 | 选择愿意向这些访客提供的本地资料目录 |
| 保存启动 | 先点「保存」，完成下面的源码插件安装，再点「启动」 |

当前访客只允许聊天和 `read_file`；写文件、执行命令等其他工具保持关闭。模型 API Key、主人管理令牌与访客令牌用途不同，发给访客的只有其自己的访客令牌。

### 4. 安装源码插件并启动 agent

首次创建且名字没有重名时，`my-agent` 对应 profile `a2a-my-agent`。如果改名、重名或已有配置，请以 `~/.a2a/agents/<agentId>.json` 中的 `profile` 字段为准；Windows 的 `~` 是用户目录。

另开一个终端，进入 `Talk2MyAgent` 仓库根目录。以下第一条**只用于尚未创建的 profile**；已有 profile 不要再次使用 `--from-default-profile`，它会重建该 profile。

```sh
dsh --profile a2a-my-agent --from-default-profile web --dump-config
dsh plugin --profile a2a-my-agent add ../dsh-a2a
```

`--dump-config` 在这里用于初始化 Web profile 并输出配置，不启动监听服务。安装失败时先按提示修复，不继续启动。然后回 Portal 点「启动」→「进入控制台」。已有部署升级时，先停止 agent，构建并重新安装源码插件，再从 Portal 启动；详见[升级步骤](docs/guide.md#升级)。

本机检查名片，Windows PowerShell 使用 `curl.exe`，macOS/Linux 使用 `curl`：

```sh
curl http://127.0.0.1:3080/.well-known/agent-card.json
```

返回 JSON 名片后，继续配置跨网络访问；名片可读不代表令牌和模型已经验证，带令牌对话见下面的教程。

## 用 Tailscale 跨网络访问

推荐使用 **Tailscale Serve + HTTPS**。它把获准设备的请求转发到本机 agent，双方不需要同一 Wi-Fi，也不需要公网 IP 或购买域名。Serve 的访问范围是获准的 Tailscale 设备；公网开放是另外的 Funnel 功能，本教程使用 Serve。[Tailscale Serve 官方说明](https://tailscale.com/docs/features/tailscale-serve)

1. **两端安装并登录 Tailscale。** 自己的两台设备加入同一 tailnet；给朋友使用时，在 Tailscale 管理后台共享 agent 所在设备，让朋友用自己的账号接受共享。双方客户端保持连接。安装和共享的逐步说明见[详细教程](docs/tailscale.md#1-两端安装并连接-tailscale)。
2. **主机配置转发。** 保持 agent 监听 `127.0.0.1:3080`，在运行 agent 的电脑执行：

   ```sh
   tailscale serve status
   tailscale serve --bg --https=443 --set-path=/a2a http://127.0.0.1:3080/a2a
   tailscale serve --bg --https=443 --set-path=/.well-known/agent-card.json http://127.0.0.1:3080/.well-known/agent-card.json
   tailscale serve status
   ```

   首次使用按命令提示启用 HTTPS。先检查 `status`；若 443 已被其他 Serve/Funnel 配置使用，先看[端口冲突说明](docs/tailscale.md#2-只转发-a2a-接口)。本例只转发 A2A 和名片，不转发整个 DSH Web 服务或 Portal 的 `17890` 端口。[命令参考](https://tailscale.com/docs/reference/tailscale-cli/serve)
3. **回填外部地址。** 从 `status` 复制实际 HTTPS 地址，例如 `https://my-pc.example-tailnet.ts.net`。Portal →「编辑配置」→「网络」→「自定义地址」填这个完整地址，保留 `https://`；本地端口仍是 `3080`。保存后停止并重新启动 agent。Portal 自动补齐 `/a2a`，HTTPS 域名模式默认保持本地回环监听。
4. **在另一网络验证。** 让另一台电脑切到手机热点，连接 Tailscale，按[访客验证步骤](docs/tailscale.md#4-在另一网络验证并开始对话)读取名片并携带访客令牌发送消息。

访客最终使用的 URL 形如 `https://my-pc.example-tailnet.ts.net/a2a`；请用自己的实际地址替换示例。浏览器直接打开 `/a2a` 不会显示聊天页面，它是 A2A RPC 接口。访客可使用自己的 A2A 客户端，或仓库内的 `packages/a2a-skill/bin/a2a.mjs`。

完整教程还包含：设备共享、访问策略、Windows/macOS/Linux 命令、`100.x` 地址直连的区别、401/403/502 排查和停止转发。见 **[docs/tailscale.md](docs/tailscale.md)**。

## 公开简报与日常使用

「自动更新简报」默认开启。在线 agent 首次启动整理一次，之后每小时从本地项目相关历史会话中汇总，完成后直接更新 `<工作区>/.hop/handoff.md`，无需确认。维护指令要求没有新资料或生成失败时保留原文件。

Portal 展示内容和更新时间，每 5 秒刷新，支持手动编辑。只有一个自动更新开关，没有简报任务列表。关闭后保留现有简报，已经开始的一次允许完成；设置重启后保留。新访客会话加载最新版，已经进行的会话不会重新注入。

关闭 Portal 页面或进程不会停止在线 agent；停止 agent 请用 Portal 的「停止」。电脑睡眠、关机或 agent 停止后无法接待访客。重启电脑后需要重新启动 agent；Tailscale 转发启动不等于 agent 已启动。

更多操作、文件位置与升级步骤见[完整使用指南](docs/guide.md)。

## 项目组成

| 组件 | 作用 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 模型与 agent 运行时 |
| [dsh-a2a-server](https://github.com/huangjuhua-aigc/dsh-a2a) | 入站 A2A、受限文件读取、独立管理 IPC、自动简报 |
| `packages/a2a-host` | 本机配置向导与监控 Portal |
| `packages/a2a-skill` | 基础出站 CLI：通讯录、名片、发送消息、任务查询 |

本版本不提供隧道管理、访客网页聊天、PDF/Word/OCR/全文检索或跨 agent 上下文迁移；Tailscale 由用户按教程配置。

## 自动化测试

```sh
pnpm --filter @talk2myagent/a2a-host test:all
pnpm --filter @talk2myagent/a2a-skill test
```

包含接口、CLI 和 Playwright UI 用例。Windows 默认使用已安装的 Edge；其他系统先执行 `pnpm --filter @talk2myagent/a2a-host exec playwright install chromium`。测试使用独立临时数据，不改动真实配置。详见[测试说明](packages/a2a-host/tests/README.md)。

## License

MIT
