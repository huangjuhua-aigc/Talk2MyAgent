# Public relay

The independent open-source service is [a2a-relay-server](https://github.com/huangjuhua-aigc/a2a-relay-server). Portal and the calling skill use version 0.2.0; the DSH protocol plugin remains at 0.3.0.

Put a Relay port in its service URL, for example `http://127.0.0.1:8787` for local testing or `https://relay.example.com:8443` for a custom HTTPS listener. The advanced network port belongs to the local Agent and defaults to `3080`; do not reuse the Relay's port on the same machine. Portal checks for occupied ports before launch. A healthy Relay is not proof that an Agent is online, and loopback URLs cannot be used from another device.

All four dashboard cards can collapse, with browser preferences remembered per Agent. Folding preserves edits in the current page; save edits before reloading the page.

[English](relay.en.md) · [简体中文](relay.md)

Select public relay in Portal to automatically launch a background Connector, register the agent and receive a stable URL. There is no pairing code or local endpoint form. Portal derives the actual listener and A2A paths; the standalone Connector CLI accepts explicit URLs.

Start the local agent, then enable publication in the **公网中继** panel. Once online, choose a visitor and copy the complete chat invitation. The invitation contains the public RPC URL, full Agent Card URL, that visitor's bearer token and skill commands. New-agent setup can select relay mode and publish automatically when the agent starts.

Operators set `A2A_RELAY_DEFAULT_HOST` to the deployed HTTPS origin. No real official host is bundled yet. Users can select a custom Relay host; close publication before changing hosts. Each host gets a separate device identity. Older running agents must be stopped and started once through the updated Portal to record their applied configuration. Changed visitor credentials/workspaces also require a restart before invitations become available.

Closing Portal leaves the Connector running. Closing publication stops forwarding without stopping the local agent or canceling accepted tasks. Network failures reconnect to the same identity, but in-flight requests are never replayed. Offline invitations are disabled rather than substituting localhost. A small private control process remains after stopping publication; the standalone CLI's `shutdown` exits it. There is no OS boot service; relaunch Portal/CLI and the local agent after reboot.

Private credentials live under `~/.a2a/relay/<agentId>` and cannot overlap any visitor workspace. Portal's management port is never forwarded. TLS terminates at the Relay/proxy, whose operator can see content and visitor credentials; choose a trusted or self-hosted service. The existing scoped file-reading and public briefing features are unchanged.

For headless use, run `pnpm --filter @talk2myagent/a2a-host start publish AGENT_ID`, `publication AGENT_ID` or `unpublish AGENT_ID`. Configure a default host through the environment or save a custom host in Portal. See [Connector CLI](../packages/a2a-connector/README.md) for publishing another compatible native HTTP A2A agent.

Set `A2A_RELAY_SOURCE` to an installed independent Relay checkout, then run Connector's `test:integration` and host's `test:all`. Tests use temporary homes, real HTTP/WS, the background process and headless browser automation. Deterministic replies avoid paid-model calls. A separate dsh-a2a integration test exercises the real harness and A2A protocol through the Relay. Production DNS, TLS proxy and cross-network reachability require deployment acceptance testing.
