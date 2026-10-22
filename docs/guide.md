# 把你的 Agent 开放给访客 —— 配置与启动指南

本指南带你从零开始：装好运行时、配置名片与访客、暴露到网络、验证、监控。
全程约 15 分钟（不含 Docker 可选项）。

> 前置知识：会用终端、知道什么是环境变量。不需要懂 A2A 协议本身。

---

## 1. 它是什么，访客能做什么、不能做什么

运行起来的东西是一个**在线 dsh agent**（下称"在线 agent"）：

- 访客通过 **A2A 协议**（agent 间互操作的开放标准）发现它、与它对话、给它派任务；
- 它在你的**指定工作目录**里干活（读代码、查资料、跑命令），像一个远程同事；
- 每个**访客身份互相隔离**：各自的对话、各自的工作目录，彼此不可见；
- **审批类操作自动拒绝**：没人值守时，凡是需要人点"确认"的动作直接拒，
  不会卡住、也不会放行；
- 限流默认 60 次/分钟/访客，可配置。

四层防御一览：

| 层 | 手段 | 谁负责 |
| --- | --- | --- |
| 网络层 | tailscale / 反向代理 + TLS | 你的部署（第 4 步） |
| 身份层 | 每访客独立 Bearer token | 插件 + 你发 token（第 3 步） |
| 应用层 | 白名单、限流、审批拒绝、per-peer 隔离 | 插件内置 |
| 系统层 | Docker 容器（推荐默认） | 可选项（第 6.1 节） |

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
        zhangsan: /home/you/code/myrepo       # 可选：让这位访客直接在你的 repo 里干活
    preamble:                                 # 开场背景注入（可选但推荐）
      files: ['.hop/handoff.md']              # 相对每个访客的工作目录；文件不存在则跳过
    admin:                                    # 本地监控面（可选但推荐）
      tokenEnv: A2A_ADMIN_TOKEN
    # 隔离档：dsh 内置沙箱（推荐默认）——bash/文件/终端调用全部受限
- insert:
    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: read-only                       # 或 workspace-write（允许写工作区内）
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
这份文件由你日常的 agent 或你手写维护，在线 agent 每次开场自动读最新版。

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
- 访客**也跑 dsh**：对称装一遍 dsh-a2a-server，即可互访；
- 访客是 **claude code / zcode 等**：装 `a2a-skill`（M4 交付）后在通讯录里加一条即可。

## 4. 监控：谁来访过、都聊了什么

**方式一（推荐）：可视化控制台**——见仓库 README 的"运行控制台"，打开即是监控台
（按访客分组的会话时间线，含每条任务的访客原话与 agent 回答，自动刷新），并可启停服务、
看日志、重跑配置向导。

**方式二：命令行**（配置了 `admin.tokenEnv` 即可用）：

```sh
curl -s http://127.0.0.1:3080/a2a/admin/contexts \
  -H "authorization: Bearer <A2A_ADMIN_TOKEN 的值>"
```

返回每个在线 context 的：访客身份、工作目录、任务列表（**每条含访客原话
`input` 与 agent 回答 `output`**）、时间戳。支持
`/a2a/admin/contexts/<contextId>` 看单个会话。

**两道硬边界**：只接受本机回环连接（127.0.0.1）+ 独立 admin token。绝不要把
这个端口转发到网络——它能看到所有访客的对话内容。M3 的可视化监控台
（`a2a-host`）就是在本地调这个接口渲染的。

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

### 6.1 环境隔离：三档

| 档 | 手段 | 读写边界 | 何时用 |
| --- | --- | --- | --- |
| **dsh 内置沙箱（推荐默认）** | dsh 自带进程沙箱（`sandbox-policy`）+ fs/bash/终端沙箱执行器，跨平台（Windows 用 ACL），零额外依赖 | **写**：默认 `read-only` 全盘禁写，可选 `workspace-write` 只许写工作区内，越权直接拒绝。**读**：**不受限**（dsh 官方设计如此，"read-only" 指禁写而非只读工作区） | 访客可信度中等、机器上无敏感文件 |
| Docker 容器（可选强隔离） | 整套环境进容器 | **读写都圈住**：只有挂载进容器的目录可见可操作（repo 默认 `:ro`），机器其余文件不存在 | 完全不受信的开放场景；**也是唯一能限制读的档** |
| 不隔离 | 仅 per-peer 工作目录隔离 | 无 | 不推荐 |

**给某位访客单独指定目录**：`isolation.peerWorkspaces` 把该访客的 cwd 指到任意路径
（如一个 repo），其余访客仍用 `workspaceRoot` 下的独立子目录（向导暂未暴露此项，
手工配置见第②步示例）。

控制台（向导第 5 屏）默认选内置沙箱，勾"允许写入工作区"即切到 `workspace-write`。
Docker 档的挂载示例：

```sh
docker run -p 3080:3080 \
  -e DEEPSEEK_API_KEY -e A2A_PEER_ZHANGSAN -e A2A_ADMIN_TOKEN \
  -v /home/you/code/myrepo:/workspace/repo:ro \   # repo 只读挂进去；确需它写再去掉 :ro
  -v /home/you/.agents/skills:/skills:ro \        # skill 目录共享（只读）
  <镜像>
```

控制台的 Docker 档会自动生成 Dockerfile + compose 到 `~/.a2a/`。

### 6.2 接待 prompt

在线 agent 的身份与规矩（"你是主人的对外代理，不许做 X"）通过 dsh 的
system prompt 配置注入（`personaPrefix`），与背景简报（走开场消息）分工：
规矩稳定走 prompt，状态频繁走简报。

### 6.3 让访客在你的 repo 里干活

`isolation.peerWorkspaces` 把某位受信任访客的工作目录指到你的 repo（见第 ② 步
配置示例）。注意这是**信任决策**：该访客的 agent 能读写那个目录（Docker 档
默认 `:ro` 只读）。

---

*本指南随 Talk2MyAgent 仓库维护；协议插件本身的行为细节见
[dsh-a2a-server 文档](https://github.com/huangjuhua-aigc/dsh-a2a)。*
