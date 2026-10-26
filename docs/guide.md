# Talk2MyAgent 使用指南

本指南说明首次配置之后怎样使用和维护在线 agent。首次下载、构建与安装源码插件从 [README](../README.md#首次安装与启动)开始；不同网络的设备接入见 [Tailscale 教程](tailscale.md)。

## 1. 先分清三个入口

| 入口 | 示例 | 使用者 |
| --- | --- | --- |
| 本机 Portal | `http://127.0.0.1:17890` | 主人配置、启停、查看简报和来访记录 |
| A2A RPC | `https://my-pc.example-tailnet.ts.net/a2a` | 获准访客的 A2A 客户端，携带访客令牌 |
| Agent Card | `https://my-pc.example-tailnet.ts.net/.well-known/agent-card.json` | 客户端发现 agent 的能力和 RPC 地址 |

Portal 和 A2A 使用不同端口。A2A 接口不是网页聊天页面；浏览器打开 RPC URL 不会出现对话框。本机管理请求使用独立的命名管道或 Unix socket，不走访客 HTTP 入口。

## 2. 创建一个在线 agent

在 `Talk2MyAgent` 根目录启动 Portal：

```sh
pnpm --filter @talk2myagent/a2a-host start
```

首次出现配置向导；已有 agent 时点击「+ 新建 Agent」。向导顺序如下：

1. **环境检测**：确认 Node.js 22+、dsh 和模型凭据。界面可以检测插件，但当前主分支仍需按 README 安装配套源码插件。
2. **名片**：填写名字和描述。只描述实际开放的能力，例如“读取这个项目的代码和公开简报”。
3. **模型**：选择服务商、模型，填写 API Key，或沿用检测到的凭据。可配置备用模型，但当前选中的模型决定执行请求所用的配置。
4. **网络**：首次本机验证选「自定义地址」填 `127.0.0.1`、端口 `3080`；跨网络按 [Tailscale 教程](tailscale.md)建立路径转发后改填完整 HTTPS 地址。
5. **访客**：为每位访客设置不同的名字和令牌，勾选允许对话和读取指定工作目录。未勾选的访客不能调用 agent；全部取消表示无人获准。
6. **工作区**：选择本地的绝对目录。这是获准访客可读取的资料范围。
7. **保存启动**：点击「保存」，为对应 profile 安装已构建的本地插件，再点「启动」和「进入控制台」。源码安装命令见 [README](../README.md#4-安装源码插件并启动-agent)。

模型 Key、主人管理令牌只留在主机。分享给访客的是其专属访客令牌与 A2A 地址，以及 Tailscale 的网络访问授权。

## 3. 配置网络与发送邀请

### 只在本机测试

自定义地址填 `127.0.0.1`，端口填 `3080`。本机客户端使用 `http://127.0.0.1:3080/a2a`。另一台电脑的 `127.0.0.1` 指向它自己，不能用来访问你的 agent。

### 跨网络访问

按照 [Tailscale 教程](tailscale.md)完成两端安装、设备授权、路径转发和 HTTPS 地址回填。采用该教程时，agent 的本地监听保持 `127.0.0.1:3080`，外部地址形如 `https://my-pc.example-tailnet.ts.net/a2a`。

换网络不会把 `192.168.x.x` 自动变成公网地址。Tailscale 的 `100.x` 直连与 HTTPS Serve 是两种配置，不要混填；对应的监听规则和故障排查见教程。

### 已有局域网或公网部署

局域网模式会绑定你选择的本机网卡 IP。它适用于同网段的受信任设备，会暴露这个 DSH Web 监听器；跨网络接待指定访客优先用路径受限的 Tailscale Serve。

已有 HTTPS 域名和反向代理时，自定义地址填完整 HTTPS URL，代理只允许 A2A RPC 与名片路径。当前产品不自动安装隧道、不管理域名，也不转发 Portal。

网络配置更改后，保存并重启 agent。随后从真正的访客设备读取 Agent Card，确认其中 `supportedInterfaces` 的地址已经变成外部可用 URL，再发起带令牌对话。

### 把接入信息交给访客

向导的「访客」和「保存启动」页面提供可复制的接入指令。只把某位访客自己的那份交给本人。若通过 Tailscale 接入，先让对方接受设备共享或加入相应 tailnet。

访客可以使用自己的 A2A 客户端，或者本仓库的零依赖 CLI；完整的 Windows PowerShell、macOS/Linux 环境变量设置和 `add`、`card`、`send`、`task` 命令见 [Tailscale 教程第 4 节](tailscale.md#4-在另一网络验证并开始对话)。

## 4. 公开简报

自动更新默认开启，首次启动整理一次，之后每小时执行。内容从本地各 agent 与这个项目相关的历史会话中总结而来，完成后直接写入 `<工作区>/.hop/handoff.md`；无需草稿审核或采纳。

Portal 显示最新内容、更新时间和一个「自动更新简报」开关，没有简报任务列表。页面每 5 秒刷新，也允许手动编辑保存；刷新不会覆盖编辑框里尚未保存的文字。

- 关闭开关：停止后续更新，现有简报保留，已经开始的一次允许完成。
- 重新开启：在线 agent 在下次检查设置时安排更新；重复刷新页面不会重复创建任务。
- 关闭 Portal：在线 agent 继续更新。agent 离线时暂停，重新上线只补一次到期更新。
- 没有新资料或生成失败：维护指令要求保留旧简报；实际内容质量取决于所配置的模型。
- 新访客会话：加载最新正式简报。已经进行的会话不会重新注入。

主人维护简报使用可信本机管理能力；访客仅获得受控的读取工具。模型根据项目记忆生成的内容会直接对访客可见，应选择准备分享的项目资料。

## 5. 启停与查看来访记录

Portal 提供「启动」「停止」「看日志」「编辑配置」「删除」。控制台的来访记录显示访客身份、原始问题、答复和任务状态，每 5 秒刷新；自动简报的主人任务不混入来访记录。

关闭 Portal 页面或进程不停止 agent。停止在线 agent 用「停止」按钮；改网络、访客或工作区配置后保存，再停止并启动，让运行实例使用新的配置。

也可在仓库根目录管理已保存的 agent：

```sh
pnpm --filter @talk2myagent/a2a-host start start my-agent
pnpm --filter @talk2myagent/a2a-host start stop my-agent
pnpm --filter @talk2myagent/a2a-host start status my-agent
pnpm --filter @talk2myagent/a2a-host start monitor my-agent
```

这里第一个 `start` 是 pnpm 包脚本，第二个 `start`/`stop` 等才是 CLI 子命令；`my-agent` 是 agent ID，替换成实际值。省略 ID 会选最近更新的已保存 agent。`status`/`monitor` 通过管理 IPC 获取快照；离线时返回原因。

完整的 dsh 日志在 `~/.dsh/logs/`。Portal 的日志摘要不包含所有模型和工具事件。电脑重启后需重新启动 agent；当前没有内置开机自启管理。

## 6. 文件与读取权限

默认位置如下；`~` 是当前用户目录，Windows 一般为 `C:\Users\你的用户名`。

| 文件或目录 | 用途 |
| --- | --- |
| `~/.a2a/agents/<id>.json` | 保存的 agent 配置，包含 profile、访客和管理凭据；作为私有文件保存 |
| `~/.a2a/agents/<id>.patch.yml` | 自动生成的运行配置，模型与访客凭据使用引用 |
| `~/.a2a/briefings/<id>.json` | 自动简报开关，文件不存在时默认开启 |
| `~/.dsh/.credentials.yaml` | dsh 凭据；Portal 写入 `refs`，修改前备份 |
| `<工作区>/.hop/handoff.md` | 向访客提供的正式简报 |
| `~/.dsh-a2a/` | 插件默认的私有状态、会话和执行时间等 |

`A2A_HOST_HOME`、`DSH_HOME` 可覆盖前两个应用的主目录。不要把这些配置、凭据或会话状态复制进公开仓库。

获准访客默认可以通过 `read_file` 读取指定 `workspaceRoot` 中的 UTF-8 文本和目录列表；单文件上限 2 MiB。路径经过真实路径校验，拒绝越界、符号链接/junction、硬链接和 Windows ADS，并排除插件自身状态目录。写入、命令、联网和跨会话工具不向访客开放。

确需给不同访客指定不同目录时，核心支持 `config.isolation.peerWorkspaces`；目前在保存的 agent JSON 中设置后从 Portal 重启生效，向导没有逐访客目录选择器。未覆盖的访客继续使用默认资料目录。单纯改变 cwd 或 `read-only` 沙箱不等于操作系统级读取隔离。

## 升级

两个仓库需要配套更新。先在 Portal 停止要升级的 agent，然后关闭旧 Portal 进程。在两个仓库中分别拉取并构建；若有自己未提交的代码，先处理本地改动再更新。

```sh
# 在 dsh-a2a 仓库根目录
git pull --ff-only
pnpm install
pnpm build

# 之后在 Talk2MyAgent 仓库根目录
git pull --ff-only
pnpm install
pnpm --filter @talk2myagent/a2a-host run build:web
dsh plugin --profile a2a-my-agent add ../dsh-a2a
pnpm --filter @talk2myagent/a2a-host start
```

每组命令在注释指定的仓库执行；profile 与本地插件路径换成实际值。**升级时不要再次使用 `--from-default-profile`**，避免重建已有 profile。再从新 Portal 启动 agent，它会刷新生成的配置。

旧 Portal 创建的、与当前工作目录及已知提示词匹配的「简报维护」任务，在提供调度服务的 DSH 中会被清理，由新开关接管。已有 `handoff.draft.md` 不会自动发布。升级后检查正式简报、开关状态和访客访问即可。

## 7. 常见问题

| 问题 | 处理方式 |
| --- | --- |
| Portal 打不开 | 确认先执行了 `build:web`；查看启动终端是否报告 `17890` 被占用 |
| 需要换 Portal 端口 | PowerShell：`$env:A2A_HOST_PORT='17891'`；macOS/Linux：`export A2A_HOST_PORT=17891`，再启动 Portal |
| 点启动后没有在线 | 看 dsh 日志；确认对应 profile 已安装主分支源码插件、使用 Web 模板、版本兼容、端口空闲 |
| 插件提示 `nothing was installed` | 本次安装没有成功；检查 dsh 与插件 `engines.dsh` 的版本范围，不继续按成功处理 |
| 找不到模型凭据 | 回「模型」页确认 Key，或检查私有凭据文档的 `refs` 对应项 |
| 401 / 403 | 检查访客令牌和允许勾选；不要使用主人令牌作为访客令牌 |
| 修改了网络仍是旧地址 | 保存后停止并重新启动 agent，再读名片核对外部 URL |
| 关闭 Portal 后还在运行 | 这是预期行为；使用「停止」或 CLI `stop` 停止 agent |
| 简报没有更新 | 检查开关、agent 在线状态、模型日志；自动更新依赖可用的模型与相关项目记忆 |
| 跨网络访问失败 | 按 [Tailscale 排错表](tailscale.md#6-常见问题)分别检查网络、端口、名片与令牌 |

自动化用例和本机测试范围见[测试说明](../packages/a2a-host/tests/README.md)；真实模型生成与两端跨网络连接仍需在你的部署环境验收。
