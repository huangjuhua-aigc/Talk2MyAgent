# Talk2MyAgent

[简体中文](README.md) · [English](README.en.md)

Portal and the calling skill are now **0.2.0**. [Public relay](docs/relay.en.md) is available: Portal registers and connects automatically, then generates visitor chat invitations. It supports an operator-provided default Relay and custom hosts. Deploy [A2A Relay Server](https://github.com/huangjuhua-aigc/a2a-relay-server) separately; no real official endpoint is bundled yet.

This version adds collapsible dashboard cards with per-agent preferences, wider Relay address inputs and a port-availability check before startup. The calling skill supports complete Relay Card URLs and fixes `GetTask` response parsing; see its [changelog](packages/a2a-skill/CHANGELOG.md).

Let authorized A2A visitors talk to your local agent and read text in a directory you choose. The agent also summarizes relevant local project memories into a public briefing. Use the local Portal to configure models, visitor tokens and data directories, and to view the briefing and visitor activity.

Devices can communicate across home, office and mobile networks using Tailscale. Both the agent host and the device sending A2A requests must be online and connected to Tailscale; the host must keep the agent running.

## Install and start

### 1. Prepare the runtime

Install Git, Node.js 22.13+, pnpm and DeepSeek Harness. You also need an API key for a model provider supported by the wizard; enter it on the model page.

```sh
node --version
npm install -g pnpm @deepseek-ai/dsh@0.2.1-rc.2
pnpm --version
dsh --version
```

This guide uses `dsh-a2a-server@0.3.0`, compatible with DSH `>=0.2.1-rc.2 <0.3.0`. Treat version compatibility errors as installation failures. Plugin documentation: [English](https://github.com/huangjuhua-aigc/dsh-a2a), [简体中文](https://github.com/huangjuhua-aigc/dsh-a2a/blob/main/README.zh-CN.md), [release notes](https://github.com/huangjuhua-aigc/dsh-a2a/blob/main/CHANGELOG.md).

### 2. Build and launch Portal

```sh
git clone https://github.com/huangjuhua-aigc/Talk2MyAgent.git
cd Talk2MyAgent
pnpm install
pnpm --filter @talk2myagent/a2a-host run build:web
pnpm --filter @talk2myagent/a2a-host start
```

The browser opens [http://127.0.0.1:17890](http://127.0.0.1:17890). This is the owner's local management UI. Keep it local and share the A2A endpoint with visitors.

### 3. Save the wizard configuration

The current UI uses Chinese labels:

| Page | What to configure |
| --- | --- |
| 环境检测 — Environment | Check that Node and dsh are available |
| 名片 — Agent Card | Use `my-agent` for this example; describe the data visitors may request |
| 模型 — Model | Select a provider and model, then enter or reuse its API key |
| 网络 — Network | Initially choose 自定义地址 (Custom address), enter `127.0.0.1`, and use port `3080` |
| 访客 — Visitors | Give each visitor a separate token and allow conversation and workspace reading |
| 工作区 — Workspace | Select the local directory whose contents may be shared with these visitors |
| 保存启动 — Save and start | Save first, install the plugin below, then start the agent |

Visitors can chat and use the bounded `read_file` tool. Writes, commands, network tools and cross-session tools are disabled. Give each visitor only their visitor token, never the model API key or owner token.

### 4. Install the plugin in the saved profile

For a new agent named `my-agent` without a naming conflict, the profile is `a2a-my-agent`. Otherwise use the actual `profile` field in `~/.a2a/agents/<agentId>.json`. On Windows, `~` refers to your user directory.

Open another terminal. Run the first command **only if the profile does not exist yet**; `--from-default-profile` recreates a profile and must not be used to upgrade an existing one.

```sh
dsh --profile a2a-my-agent --from-default-profile web --dump-config
dsh plugin --profile a2a-my-agent add dsh-a2a-server@0.3.0
```

`--dump-config` initializes the Web profile without starting a listener. Resolve any installation error before continuing. In Portal, click 启动 (Start), then 进入控制台 (Open console).

Check the local Agent Card. Use `curl.exe` in Windows PowerShell, or `curl` on macOS/Linux:

```sh
curl http://127.0.0.1:3080/.well-known/agent-card.json
```

A readable card confirms the discovery route. The visitor check below also verifies authentication and the model.

## Access from another network with Tailscale

Use **Tailscale Serve + HTTPS** to expose only the two A2A paths. It does not require a public IP, purchased domain or router port forwarding. Access is limited to authorized Tailscale devices. Funnel is a separate public publishing feature and is not enabled by these instructions. [Official Serve documentation](https://tailscale.com/docs/features/tailscale-serve)

### 1. Connect both devices

Install Tailscale on the host and the machine that sends A2A requests using the [official downloads](https://tailscale.com/download) and [quickstart](https://tailscale.com/docs/how-to/quickstart). On Linux, finish installation with `sudo tailscale up`; on Windows/macOS, sign in through the client. If the visitor agent runs in the cloud, connect that cloud machine too.

Your own devices can join the same tailnet. To share with someone else, open [Tailscale Machines](https://login.tailscale.com/admin/machines), select the host's Share action, and give the invitation to the intended visitor. They accept with their own account. Sharing remains subject to access policies; use the host's full `.ts.net` DNS name. [Device sharing](https://tailscale.com/docs/features/sharing)

On both devices, run `tailscale status`. On the host, `tailscale ip -4` shows its address; from the visitor device, run `tailscale ping HOST_TAILSCALE_IP`, replacing the placeholder. A successful ping confirms network reachability, not application access.

### 2. Forward only A2A and the Agent Card

Keep the agent listening on `127.0.0.1:3080`. On the host, inspect existing rules, then add:

```sh
tailscale serve status
tailscale serve --bg --https=443 --set-path=/a2a http://127.0.0.1:3080/a2a
tailscale serve --bg --https=443 --set-path=/.well-known/agent-card.json http://127.0.0.1:3080/.well-known/agent-card.json
tailscale serve status
```

If 443 is already used by another Serve/Funnel configuration, select an unused port such as 8443 and replace every `--https=443` with `--https=8443`; include `:8443` in the external URL. Do not reset or overwrite existing services. Follow the first-use HTTPS setup prompt, and use an administrator terminal or `sudo` if required.

Preserve the `/a2a` and `/.well-known/agent-card.json` suffixes on the backend URLs: Serve removes the mounted prefix and the target path restores it. Do not forward the entire DSH Web listener or the Portal's port 17890. [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve)

Copy the actual HTTPS hostname from `status`, for example `https://my-pc.example-tailnet.ts.net`. In Portal → 编辑配置 (Edit configuration) → 网络 (Network), choose 自定义地址 (Custom address) and enter that full URL. Keep the local port at 3080. Save, stop and start the agent. The Portal appends `/a2a` and keeps a full HTTPS hostname's backend on loopback; if you previously set `network.bindHost` manually, check it is also loopback.

The tailnet policy must allow the visitor to reach the host's TCP 443, or the HTTPS port you chose. Amend the intended destination and port in the existing policy rather than replacing the policy with unrestricted access.

### 3. Verify from the visitor device

Switch the visitor device to another network, such as a phone hotspot, while keeping both devices connected to Tailscale. Fetch the card with PowerShell:

```powershell
Invoke-RestMethod 'https://my-pc.example-tailnet.ts.net/.well-known/agent-card.json' | ConvertTo-Json -Depth 10
```

On macOS/Linux:

```sh
curl --fail --show-error https://my-pc.example-tailnet.ts.net/.well-known/agent-card.json
```

Replace the sample hostname with the real one. Its `supportedInterfaces` should advertise the external HTTPS `/a2a` endpoint. Check that `/` does not show a DSH or Portal management page; with only the two rules above it should return 404.

For a real conversation, use an A2A client or this repository's dependency-free CLI. The visitor only needs Node.js and this checkout; they do not need dsh or a running Portal. In the visitor's `Talk2MyAgent` directory, set their token:

```powershell
# Windows PowerShell
$env:A2A_PEER_HOME_AGENT = 'YOUR_VISITOR_TOKEN'
```

```sh
# macOS/Linux: use the command for your operating system
export A2A_PEER_HOME_AGENT='YOUR_VISITOR_TOKEN'
```

Then run these commands on either operating system:

```sh
node packages/a2a-skill/bin/a2a.mjs add home-agent https://my-pc.example-tailnet.ts.net/a2a A2A_PEER_HOME_AGENT
node packages/a2a-skill/bin/a2a.mjs card home-agent
node packages/a2a-skill/bin/a2a.mjs send home-agent "Introduce your capabilities and summarize the current public briefing."
```

Sending invokes the host's configured model. Also request a known file inside the authorized directory to verify file access. If the task is not finished, query its actual returned ID with `node packages/a2a-skill/bin/a2a.mjs task home-agent ACTUAL_TASK_ID`.

The address book stores the environment variable's name, not its token value. Set the variable again in a new terminal. Portal should show the visitor's question and response. Opening `/a2a` in a browser does not show a chat page; it accepts A2A JSON-RPC POST requests.

### 4. Troubleshoot or revoke access

| Symptom | Check |
| --- | --- |
| Host absent from `tailscale status` | Both devices connected, correct tailnet or accepted share, host awake |
| Ping works but HTTPS times out | Tailnet policy for the HTTPS port and Serve configuration |
| DNS resolution fails | Tailscale DNS/MagicDNS and the complete hostname, especially for shared hosts |
| HTTPS 502 | Local agent running on the expected loopback port |
| Card 404 or RPC reaches a home page | Both Serve paths and both backend URL suffixes |
| Card advertises an old IP | Save the network configuration and restart the agent |
| A2A 401 / 403 | Correct visitor token and the visitor's permission in Portal |
| Card works but a message fails | Model key, model name, task status and dsh logs |

To remove only these forwards:

```sh
tailscale serve --https=443 --set-path=/a2a off
tailscale serve --https=443 --set-path=/.well-known/agent-card.json off
tailscale serve status
```

Use your chosen HTTPS port consistently. To revoke one visitor, revoke their device share and remove or disable them in Portal, then save and restart the agent. Other Serve rules remain separate. Full direct-IP guidance and troubleshooting are available in the [Chinese Tailscale guide](docs/tailscale.md).

## Briefings and everyday use

Automatic briefing is enabled by default. The online agent summarizes relevant local project memories on first activation and hourly, writing the finished result directly to `<workspace>/.hop/handoff.md`. There is no draft approval step or task list. Portal shows the content, modification time and one persistent switch, and refreshes every five seconds. Manual edits are supported; refresh does not overwrite unsaved editor text.

Turning the switch off stops future updates, preserves the current file and allows active work to finish. Closing Portal does not stop an online agent. After downtime, the agent performs one overdue update. New visitor contexts receive the current briefing; existing conversations do not automatically reload it. The maintenance instruction asks the model to preserve the old briefing when no new information is available or generation fails; content quality depends on the model.

Use 启动 (Start), 停止 (Stop), 看日志 (Logs), 编辑配置 (Edit configuration) and 删除 (Delete) to manage the saved agent. Visitor activity contains visitor questions, replies and task states; owner briefing jobs are excluded. After changing the network, visitors or workspace, save and restart. Closing the page does not stop the agent; after a computer restart you need to start it again.

Local configuration is saved in `~/.a2a/agents/`, briefing settings in `~/.a2a/briefings/`, model/visitor credential references in `~/.dsh/.credentials.yaml`, and plugin state in `~/.dsh-a2a/`. These include credentials or private conversation data and belong outside shared repositories. Full dsh logs are under `~/.dsh/logs/`.

## Upgrade

Stop the agent in Portal, then close the old Portal process. From the `Talk2MyAgent` checkout, with any local edits handled first:

```sh
git pull --ff-only
pnpm install
pnpm --filter @talk2myagent/a2a-host run build:web
dsh plugin --profile a2a-my-agent add dsh-a2a-server@0.3.0
pnpm --filter @talk2myagent/a2a-host start
```

Replace the profile with the actual saved value. Do not use `--from-default-profile` on an existing profile. Start the agent from the updated Portal to refresh its generated configuration. Old HTTP owner/monitoring integrations must migrate to private IPC. See the [English plugin migration guide](https://github.com/huangjuhua-aigc/dsh-a2a/blob/main/docs/public-access-hardening.en.md).

For local plugin development, clone the adjacent `dsh-a2a` repository, run `pnpm install` and `pnpm build` there, then install from the Portal directory with `dsh plugin --profile a2a-my-agent add ../dsh-a2a`. Rebuild, reinstall and restart after plugin changes.

## Scope and validation

This version provides scoped text-file reads, public briefings and an owner Portal. It does not add a visitor web chat UI, tunnel/domain management, PDF/Word/OCR/full-text search, a briefing task list, or complete outbound multi-turn collaboration and context migration.

Automated coverage includes plugin behavior, Portal API/CLI and browser UI workflows. See the [test documentation (Chinese)](packages/a2a-host/tests/README.md). The documented network setup has not been verified between two physical devices; perform the visitor checks above in your environment. Tests use deterministic models and do not validate paid-model output quality.
