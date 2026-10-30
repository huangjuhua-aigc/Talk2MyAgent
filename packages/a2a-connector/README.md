# A2A Connector

Reusable outbound connector for native HTTP A2A 1.0 JSONRPC agents. Portal and the independent CLI use the same background process manager. It does not depend on DSH model APIs and does not adapt closed-source applications or MCP servers into inbound agents.

Requires Node 22.13+. From the Talk2MyAgent checkout, run `pnpm install`, then:

```sh
node packages/a2a-connector/src/cli.mjs publish \
  --state /private/connector/my-agent \
  --relay https://relay.example.com \
  --rpc http://127.0.0.1:3080/a2a \
  --card http://127.0.0.1:3080/.well-known/agent-card.json \
  --shared-root /data/shared --name 'My agent'
node packages/a2a-connector/src/cli.mjs status --state /private/connector/my-agent
node packages/a2a-connector/src/cli.mjs stop --state /private/connector/my-agent
```

Repeat `--shared-root` for every visitor-readable root; the private directory must not overlap any root. Use a directory owned by the current OS user. Local targets must use literal loopback or local-interface IPs, with fixed paths; DNS targets, redirects and arbitrary remote paths are rejected. Loopback HTTP relay development requires `--allow-loopback-http`.

The manager starts one detached process per state directory. Control uses an authenticated named pipe on Windows or a mode-0600 Unix socket; process ownership is acquired before opening the socket. Closing Portal/CLI leaves forwarding running. `stop` closes forwarding and persists the intent but keeps the small private control process available; `shutdown` also exits that process. There is no OS boot service. The next Portal/CLI start can recover a stopped/crashed daemon, while a live daemon retries network failures itself. Stale lock recovery fails closed if the recorded PID belongs to a live process; a leftover `lock-recovery` directory after a crash requires inspecting the owner before manually removing that empty directory.

State contains origin-scoped device secrets and a private IPC credential, never copy it into visitor workspaces or invitations. HTTP APIs never return these secrets. Registration intent is durable before network access; reconnect uses the existing registration. Delivery is not exactly-once: a dropped response can mean that the local task was accepted. No automatic request replay occurs.

```sh
pnpm --filter @talk2myagent/a2a-connector test
A2A_RELAY_SOURCE=/path/to/a2a-relay-server pnpm --filter @talk2myagent/a2a-connector test:integration
```

The cross-repository suite covers registration/reconnect, byte-preserving SSE, authentication, capacity, abort cleanup, revocation, daemon persistence, singleton control and host-scoped credentials. Portal documentation: [中文](../../docs/relay.md) / [English](../../docs/relay.en.md).
