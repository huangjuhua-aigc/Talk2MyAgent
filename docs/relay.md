# 公网中继

[简体中文](relay.md) · [English](relay.en.md)

用户不需要安装 Tailscale，也不用填写本地端口或配对码。在 Portal 选择“公网中继”，可以先注册固定地址、准备邀请，再启动 Agent。后台 Connector 会在 Agent 就绪后自动连接同一个地址。

Relay 的独立开源仓库：[a2a-relay-server](https://github.com/huangjuhua-aigc/a2a-relay-server)。Portal 与调用技能使用 0.2.0；本分支的 Microsandbox 和安全停止功能需要配套的 DSH 协议插件 0.4.0。

## 用户操作

1. 配置模型和允许读取的工作目录，保存后点“进入控制台”，无需先启动 Agent。
2. 在管理页“公网中继”选择默认或自定义 Relay，填写自己的手机号作为公开编号，点“获取中继地址”。Relay 在线即可注册，Agent 离线时显示“地址已分配 · 待 Agent 启动”。
3. 在独立的“邀请访客聊天”区域选择访客，复制邀请。下方“＋ 添加访客”可填写姓名和 Token；默认生成随机 Token，也可填写自己的 Token。邀请包含固定 A2A 地址、完整名片地址、该访客的令牌及调用技能命令。离线邀请明确提示等待 Agent 启动。
4. 启动 Agent，后台会自动连接已注册地址，状态变为“公网已上线”后即可聊天。运行中添加访客不会断开现有访客；新访客显示“待重启生效”，可点“重启并应用”。重启会结束正在执行的对话任务。
5. 需要停用时关闭公网发布。这样会断开中继，不会停止本地 agent，也不会取消已经接受的任务；固定地址保留。

推荐顺序是：**保存配置 → 获取固定中继地址 → 添加访客并准备邀请 → 启动 Agent → 自动连接同一地址**。也支持先启动再发布。注册只分配路径、保存设备身份，不启动模型或访客沙箱；真正转发必须等本地 A2A 服务就绪。离线链接不接待请求，Relay 返回 503。地址不是设备凭据，Connector 使用私下保存的设备凭据认证，访客使用各自的 Token。

选择公网中继时填写自己的 **11 位手机号，作为公开 Agent 编号**。注册成功后的地址为 `https://relay.example.com/r/手机号/a2a`，邀请使用该编号，Agent 名字作为备注。暂不验证手机号归属；号码会公开显示在地址和邀请中，不能代替访客 Token。Relay 使用数据库事务和唯一索引保证同一服务上的号码不重复，重号时拒绝注册。注册后号码固定，重连、换访客和关闭发布都不换号；撤销或重置身份不会释放旧号码。

已有 Agent 的编号和 UUID 地址继续保留。旧客户端未提供号码时，Relay 仍自动分配 138/139 系统编号。升级 Relay（含 PostgreSQL schema 2）后，再更新 Portal/Connector；已运行的 Connector daemon 需要重启才能加载新代码。独立 CLI 可通过 `--contact-id 13812345678` 指定号码。

Portal 不再本地生成号码，只使用当前 Relay 返回并由 Connector 按 host 缓存的编号。升级 Relay 时会为已有注册补号，保留原 URL、设备凭据与发布状态；旧版本本地生成的号码不再用于新邀请。同步升级并重启 Connector，或在新版 Connector 上点击“同步中继编号”，然后重新复制邀请。中继未分配有效编号时不允许复制带旧号码的邀请。纯局域网 Agent 未注册 Relay 时使用 `local-名称` 作为本地别名，不伪造 11 位编号。

唯一性范围是同一个 Relay 的号码数据库。多个独立自建 Relay 若要共享全球唯一的号码，需要共同的号码注册中心或互不重叠的号段；当前尚未实现。跨 Relay 的身份仍须结合完整服务地址判断，技能会拒绝同 ID 对应不同 URL 的覆盖。保留完整 Relay 数据库和编号序列，不要通过删除数据库重置号码。

通过 Portal/CLI 停止 Agent 时，会先经本机管理接口取消未完成任务、停止访客沙箱并保留其磁盘，收到确认后再结束后端进程。若无法确认，保留进程并报错，避免强制结束导致近期生成的文件丢失。关闭公网发布只断开中继，不执行这个停止流程。

Portal 内置默认入口 **https://relay.creez.cn**，直接选择“默认 Relay”即可使用。维护者可通过环境变量 `A2A_RELAY_DEFAULT_HOST=https://实际域名` 覆盖默认入口；显式设置为空字符串会禁用默认入口。用户仍可选择“自定义 Relay host”连接自建中继。切换 host 前关闭当前发布，每个 host 独立保存设备身份和地址，已有自定义 host 不会被改写。

Relay 的端口写在服务地址中，例如本地联调的 `http://127.0.0.1:8787`，或使用自定义 HTTPS 端口的 `https://relay.example.com:8443`。向导只提供“公网中继”和“局域网”，不再提供独立的高级端口或自定义直连地址表单。局域网地址直接写成 `192.168.1.10:3080`；中继模式沿用本地监听配置，默认端口 `3080`。Portal 启动前会检查端口冲突。Relay `/health` 正常只代表中继服务运行，需本地 Agent 与 Connector 上线后才能接待访客。`127.0.0.1` 仅用于本机联调，不能供另一台设备访问。

Relay 在 SQLite 或 PostgreSQL 的 `agents` 表中保存 `displayName`、`registrationId`、`publicationId`、`contactId`、设备凭据哈希和发布状态。数字路径 `/r/<contactId>/a2a` 通过唯一索引找到内部 `publicationId`；原 UUID 路径也继续可用。名称不是路径的唯一键，同名 Agent 不冲突。Connector 在 `~/.a2a/relay/<本地 Agent ID>/state.json` 中按 Relay 地址保存注册身份与返回的访问地址。保留服务器数据库及本地注册状态，重启和重连会复用原地址；当前不提供自定义名称路径，Relay 内的显示名称也没有独立的更新接口。

主页的 Agent 概览、公网中继、邀请访客聊天、公开简报、来访记录均可折叠。浏览器按 Agent 记忆展开状态，折叠不会丢失当前页面未保存的表单；刷新页面前仍需保存编辑。

旧版本已经运行的 agent 需要在新 Portal 中停止并重新启动一次，以记录实际监听地址和已应用的访客权限。访客令牌或工作目录变更后也需要重启；可以提前生成邀请，但会注明尚未生效。新增访客使用独立内部标识关联私有工作区，姓名支持中文；Token 默认隐藏，重复姓名或重复 Token 会被拒绝。公开简报和指定工作目录读取保持原有功能，其他工具没有因中继而开放。

## 后台行为

关闭 Portal 页面或退出 Portal 进程后，已启动 Connector 继续运行。接待访客时电脑和本地 agent 必须在线。普通断网自动重连并保留原地址；请求不会自动重发。已知任务 ID 时可以继续查询。尚未注册当前 Relay 地址时禁用复制邀请；已注册但离线时可复制带离线提示的邀请，不会拿本机 Agent 的 localhost 地址代替。

关闭发布先切断本地转发；Relay 不可达时显示“云端状态待同步”，没有在线连接可接受新的请求。停止状态会保留一个轻量的本机控制进程，便于 Portal 再次开启；独立 Connector CLI 的 `shutdown` 可退出它。暂未安装系统开机启动服务，电脑重启后重新启动 Portal/CLI 与 agent 即可恢复。

设备凭据存放在 `~/.a2a/relay/<agentId>/`（或 `A2A_HOST_HOME` 对应目录），不会进入邀请。所有访客工作目录都必须与此私有目录分开。Portal 的 `17890` 仍仅供本机管理，不应转发到公网。Relay 运营者能够看到转发的内容和访客 Bearer 令牌，请选择你信任或自行部署的 Relay。

## 自动恢复与重置 Relay 身份

- Relay 返回 401（服务端数据丢失、不认识设备凭据）：Connector 自动重新注册一次，公网地址会变化，需要重新复制邀请。
- 本地发布版本落后（409，例如恢复了旧的 `state.json`）：自动采用 Relay 的版本号并重发一次本地意图。
- 被撤销或过期（403）：仍显示“发布被拒绝”，不会自动恢复。
- 手动重置：先关闭公网发布，再点“重置 Relay 身份”，或运行 `a2a-connector reset --state <目录>`。重置保留 Relay 与本地地址配置，下次开启发布会生成新地址，旧地址与旧邀请失效。

## CLI

```sh
pnpm --filter @talk2myagent/a2a-host start start AGENT_ID
pnpm --filter @talk2myagent/a2a-host start publish AGENT_ID
pnpm --filter @talk2myagent/a2a-host start publication AGENT_ID
pnpm --filter @talk2myagent/a2a-host start unpublish AGENT_ID
```

前一个 `start` 是 pnpm 脚本名，后一个是 host CLI 子命令。`publish AGENT_ID` 可在 Agent 启动前调用：先注册地址并保存自动发布设置；之后 `start AGENT_ID` 自动上线。默认 Relay host 为 `https://relay.creez.cn`，可通过 `A2A_RELAY_DEFAULT_HOST` 覆盖；自定义 host 在 Portal 保存。独立 Connector 可显式指定本地 RPC/Card URL，参见 [Connector CLI](../packages/a2a-connector/README.md)。

## 本地开发版安装

插件 `0.4.0` 已发布到 npm，正常启动无需设置开发变量。DSH `0.2.1-rc.2` 已满足兼容要求。以下步骤仅用于测试本地尚未发布的修改。

先在 dsh-a2a 插件仓库构建并打包，再为 Portal 指定安装包（PowerShell 示例）：

```powershell
cd D:\code\dsh-a2a
pnpm build
New-Item -ItemType Directory -Force "$env:USERPROFILE\.a2a\packages" | Out-Null
npm pack --pack-destination "$env:USERPROFILE\.a2a\packages"
$env:A2A_PLUGIN_SOURCE = "$env:USERPROFILE\.a2a\packages\dsh-a2a-server-0.4.0.tgz"
pnpm --dir D:\code\Talk2MyAgent\packages\a2a-host start
```

环境变量必须在启动 Portal 的终端设置；已经运行的 Portal 需要重新启动才能读取。点击 Agent 的“启动”后会更新原有 profile 并自动准备沙箱。保留安装包路径以便后续安装；正式发布到 npm 后可移除开发覆盖。这里的环境变量只决定本地插件安装来源，不改变 Relay 地址。

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
