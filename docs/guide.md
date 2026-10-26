# 把你的 Agent 开放给访客 —— 配置与启动指南

本指南带你从零开始：装好运行时、配置名片与访客、暴露到网络、验证、监控。
全程约 15 分钟（不含 Docker 可选项）。

> 前置知识：会用终端、知道什么是环境变量。不需要懂 A2A 协议本身。

---

## 1. 它是什么，访客能做什么、不能做什么

运行起来的东西是一个**在线 dsh agent**（下称"在线 agent"）：

- 访客通过 **A2A 协议**（agent 间互操作的开放标准）发现它、与它对话、给它派任务；
- 它通过受控 `read_file` 读取你的**指定工作目录**中的文本和目录；暂不开放写文件、执行命令等工具；
- 每个**访客的对话与任务互相隔离**；默认共享同一个授权资料目录，也可配置专属读取目录；
- **审批类操作自动拒绝**：没人值守时，凡是需要人点"确认"的动作直接拒，
  不会卡住、也不会放行；
- 限流默认 60 次/分钟/访客，可配置。

四层防御一览：

| 层 | 手段 | 谁负责 |
| --- | --- | --- |
| 网络层 | tailscale / 反向代理 + TLS | 你的部署（第 4 步） |
| 身份层 | 每访客独立 Bearer token | 插件 + 你发 token（第 3 步） |
| 应用层 | 白名单、限流、审批拒绝、专用只读工具校验读取范围 | 插件内置 |
| 系统层 | 操作系统或容器隔离 | 部署时自行提供（第 6.1 节） |

## 2. 前置条件

- **Node 22+**（`node -v` 检查）
- **dsh**：`npm i -g @deepseek-ai/dsh`（安装方式以
  [官方 README](https://github.com/deepseek-ai/deepseek-harness) 为准）
- **DeepSeek API key**：`DEEPSEEK_API_KEY`，存进 `~/.dsh/.credentials.yaml`
  （没有就先跑 `dsh` 一次按引导配置）
- 可选：**Docker**（推荐，第 6.1 节的隔离部署用）
- 可选：**tailscale**（最省心的跨网络安全 exposing，第 4 步推荐档）

## 3. 五步上手

### 第 ① 步：建常驻 profile，装插件

```sh
dsh --profile a2a --from-default-profile web   # web 模板自带 HTTP 服务（默认 127.0.0.1:3080）
dsh plugin --profile a2a add dsh-a2a-server    # 注意 --profile 必须放在最前
```

> 用 web 模板的原因：插件需要 HTTP 服务能力；headless profile 是一次性的、
> 不开端口，不能常驻。
> 当前如需从未发布的源码安装：`dsh plugin --profile a2a add ./path/to/dsh-a2a`
> （本地 checkout），git 源安装需要允许其构建脚本。

### 第 ② 步：配置名片、访客、工作区

编辑该 profile 的 `cordis.patch.yml`（路径以 `dsh --profile a2a --dump-config`
的输出为准），确认有这一行并填好 config：

```yaml
- id: a2a-server
  name: dsh-a2a-server
  config:
    basePath: /a2a
    publicUrl: https://a2a.example.com/a2a   # 第 ④ 步定了对外地址后回填；内网阶段可省略
    provider: deepseek-official               # 模型
    model: deepseek-v4-flash
    card:                                     # 对外名片：访客看到的就是这些
      name: my-agent
      description: 能读代码、查资料、跑任务的在线 agent。
      public: true
      skills: []
    peers:                                    # 每个访客一个身份
      zhangsan: { tokenEnv: A2A_PEER_ZHANGSAN }
    trustedPeers: [zhangsan]                  # 只许白名单里的访客跑任务
    isolation:
      workspaceMode: per-peer                 # 每访客独立工作目录（默认隔离）
      workspaceRoot: /srv/dsh/a2a
      peerWorkspaces:
        zhangsan: /home/you/code/myrepo       # 可选：这位访客的专属只读资料目录
    preamble:                                 # 开场背景注入（可选但推荐）
      files: ['.hop/handoff.md']              # 相对 workspaceRoot；文件不存在则跳过
    admin:                                    # 本地监控面（可选但推荐）
      tokenEnv: A2A_ADMIN_TOKEN
    # sandbox-policy 仅作额外防御，不会为访客启用命令或写入工具
- insert:
    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: read-only
        workspaceRoot: /srv/dsh/a2a
```

**发 token**（每个访客独立、可随时轮换）：

```sh
openssl rand -hex 32                          # 生成一个
```

写进 `~/.dsh/.credentials.yaml`：

```yaml
A2A_PEER_ZHANGSAN: <上面生成的值>
A2A_ADMIN_TOKEN: <再生成一个，给监控台用>
```

**背景简报**（可选）：在工作目录下放一份 `.hop/handoff.md`——在线 agent
接待每位访客时会把它作为开场背景（"主人最近在做什么、关键决定、待办"）。
这份文件可以手动维护。Portal 创建的 agent 默认开启每小时自动更新：首次启动时整理一次，任务完成后直接写入正式简报，无需确认。Portal 只有「自动更新简报」开关，没有任务列表；关闭会停止后续更新并保留现有简报，正在执行的一次允许完成。开关设置在重启后保留；关闭 Portal 不会停止在线 agent 的定时更新。Portal 每 5 秒刷新展示内容；新访客会话自动加载最新版。

### 第 ③ 步：启动

```sh
dsh --profile a2a
```

看到监听信息即成功（默认 `127.0.0.1:3080`；A2A 端点是 `<host>:<port>/a2a`，
名片在 `<host>:<port>/.well-known/agent-card.json`）。

### 第 ④ 步：网络可达（三选一）

| 档 | 做法 | 适合 | 注意 |
| --- | --- | --- | --- |
| 局域网 | 启动加 `--host 192.168.x.x`；访客访问 `http://192.168.x.x:3080/a2a` | 同网段信任环境 | 裸 HTTP，内容不加密 |
| **tailscale（推荐）** | 双方装 [tailscale](https://tailscale.com)；访客访问 `http://100.x.y.z:3080/a2a` | 个人最省心 | 免公网、链路加密、免域名 |
| cloudflared | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 把 3080 映射到 `https://a2a.example.com` | 要公网可达 | TLS 自动搞定；必须有 Bearer；回填 `publicUrl` |

> 插件自身不提供 TLS。任何非本机回环的暴露都应走加密隧道或反代。

### 第 ⑤ 步：验证 + 交给访客

先自己验一发：

```sh
curl -s http://127.0.0.1:3080/.well-known/agent-card.json    # 名片出来了

curl -s http://127.0.0.1:3080/a2a \
  -H "authorization: Bearer <访客token>" \
  -H 'content-type: application/json' -H 'a2a-version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{
        "message":{"messageId":"m1","role":"ROLE_USER",
                   "parts":[{"text":"你好，报上你能干什么"}]}}}'
```

然后把两样东西发给访客：**URL**（如 `http://100.x.y.z:3080/a2a`）和 **token**。
访客侧形态任选：

- 访客是**人**：用 curl / 任意 A2A 客户端；
- 访客侧可以使用本仓库 `packages/a2a-skill` 的基础 CLI 或其他 A2A 客户端；仅安装入站插件不会自动获得出站能力。

## 4. 监控：谁来访过、都聊了什么

**方式一（推荐）：可视化控制台**——见仓库 README 的"运行控制台"，打开即是监控台
（按访客分组的会话时间线，含每条任务的访客原话与 agent 回答，自动刷新），并可启停服务、
看日志、重跑配置向导。

**方式二：命令行**（控制台已保存并配置管理凭据的 agent）：

```sh
pnpm --filter @talk2myagent/a2a-host start monitor <agentId>
```

返回每个在线 context 的：访客身份、工作目录、任务列表（**每条含访客原话
`input` 与 agent 回答 `output`**）、时间戳。支持
`/a2a/admin/contexts/<contextId>` 看单个会话。

管理请求使用 Windows 命名管道或 Unix socket，并要求独立 admin token；公网 HTTP 不挂载管理路由，也不接受主人凭据。Portal 本身只绑定本机回环地址，它管理凭据和访客记录，不应转发到公网。

## 5. 运维

- **关控制台 ≠ 停服务**：在线 agent 常驻是预期行为，关掉控制台页面/进程它继续跑；
  停止请用控制台的「停止」按钮或 `a2a-host stop`（重启过的控制台也能停——启动时
  会记住 agent 的 PID）。
- **轮换 token**：改 `~/.dsh/.credentials.yaml` 里对应键即生效（下一个请求起，
  无需重启）。泄露某一个访客的 token 只影响那一个身份。
- **停机**：Ctrl-C；后台跑建议 `dsh --profile a2a` 放进 tmux/systemd/容器。
- **故障排查**：
  - 控制台端口被占 → 按提示 `netstat -ano | findstr :17890` 找到残留进程
    `taskkill /T /PID <PID>`，或换端口 `A2A_HOST_PORT=17891`；
  - 端口被占 → 换端口或杀掉旧进程（Windows 上注意旧进程可能仍占端口）；
  - 装插件被拒（版本不兼容）→ 确认 dsh 版本在插件 `engines.dsh` 声明的范围内
    （0.3.0 要求 `>=0.2.1-rc.2 <0.3.0`）；
  - 一直 401 → 检查 credentials 里是否真的有对应 `A2A_PEER_*` 键；
  - 启动报无模型凭据 → `DEEPSEEK_API_KEY` 未按第 2 节配置。

## 6. 进阶

### 6.1 读取范围与系统隔离

当前访客只能使用专用 `read_file`，由代码校验真实路径、拒绝越界和链接，并排除会话存储目录。支持 UTF-8 文本与目录列表，单文件上限 2 MiB；PDF/Office 内容提取尚未实现。

默认读取范围是 `isolation.workspaceRoot`。配置 `isolation.peerWorkspaces.<访客名>` 时，该访客只读取其专属目录，其他访客仍使用默认资料目录。专属目录配置目前需要手动编辑，向导未提供逐访客目录选择器。

`read-only` 沙箱仅限制写入，不能代替上述读取边界；改成 `workspace-write` 也不会为访客增加工具。需要容器或操作系统级隔离时由部署方单独配置；当前 Portal 没有一键 Docker 部署和开放写入的选项。

### 6.2 接待 prompt

访客使用独立的公共系统提示词，避免继承主人的个性化提示与记忆；动态项目背景由公开简报提供。主人维护简报的会话则保留可信本机管理能力。

### 6.3 让访客在你的 repo 里干活

`isolation.peerWorkspaces` 可以把某位获准访客的读取范围指定为你的 repo（见第 ② 步配置示例）。该目录中的文本会提供给此访客；当前仍仅允许读取，不开放写文件和命令执行。

---

*本指南随 Talk2MyAgent 仓库维护；协议插件本身的行为细节见
[dsh-a2a-server 文档](https://github.com/huangjuhua-aigc/dsh-a2a)。*
