# Public relay

The independent open-source service is [a2a-relay-server](https://github.com/huangjuhua-aigc/a2a-relay-server). Portal and the calling skill use version 0.3.0. This branch's Microsandbox and safe-stop features require the matching DSH protocol plugin 0.4.1.

Put a Relay port in its service URL, for example `http://127.0.0.1:8787` for local testing or `https://relay.example.com:8443` for a custom HTTPS listener. The wizard offers Public relay and LAN, with no separate advanced port or custom direct-address form. Enter a LAN address as `192.168.1.10:3080`. Relay mode retains the local listener configuration, whose default port is `3080`. Portal checks for occupied ports before launch. A healthy Relay is not proof that an Agent is online, and loopback URLs cannot be used from another device.

Relay persists `displayName`, `registrationId`, `publicationId`, `contactId`, the device credential hash and publication state in SQLite or PostgreSQL's `agents` table. Numeric URLs `/r/<contactId>/a2a` resolve through a unique index to the internal `publicationId`; legacy UUID URLs also work. Names are not unique routing keys, so duplicate names do not collide. Connector saves its registration identity and returned URLs per Relay origin in `~/.a2a/relay/<local Agent ID>/state.json`. Keeping both the server database and local registration state preserves URLs across restarts and reconnections. Custom name-based paths and a separate Relay display-name update API are not implemented.

All five dashboard cards, including the separate visitor invitation area, can collapse, with browser preferences remembered per Agent. Folding preserves edits in the current page; save edits before reloading the page.

[English](relay.en.md) · [简体中文](relay.md)

Select public relay in Portal to automatically launch a background Connector, register the agent and receive a stable URL. There is no pairing code or local endpoint form. Portal derives the actual listener and A2A paths; the standalone Connector CLI accepts explicit URLs.

Save the Agent and enter its console without starting it. In **公网中继** (Public relay), click **获取中继地址** to reserve a stable URL. Only Relay must be running for registration. In **邀请访客聊天** (Invite visitors), select a visitor and copy the complete invitation, including the RPC URL, Agent Card URL, visitor token and skill commands. Offline invitations explicitly tell visitors to wait until the owner starts the Agent.

The recommended sequence is **save → reserve a Relay URL → add visitors and prepare invitations → start Agent → automatically connect at the same URL**. Starting before publishing also works. Registration saves a device identity and route without starting a model or sandbox. Forwarding waits for the local A2A service to be ready. Offline routes return 503. The URL is not a credential: Connector authenticates using its private device credential, while visitors use their own tokens.

When selecting public Relay access, enter your **11-digit mobile number as the public Agent ID**. A successful registration produces `https://relay.example.com/r/<number>/a2a`; invitations use that ID with the Agent name as a note. Phone ownership is not verified. The number appears publicly in addresses and invitations and never replaces visitor credentials. Database transactions and a unique index reject duplicate numbers across all users and instances. Registered numbers are immutable; retries, reconnects, disabling publication and changing visitors retain them. Revoking or resetting a device does not release its old number.

Existing IDs and UUID URLs remain supported. Legacy clients that omit a number still receive an automatic 138/139 ID. Upgrade Relay and PostgreSQL schema 2 before updating Portal/Connector, then restart old Connector daemons. Standalone CLI users can pass `--contact-id 13812345678`.

Portal never generates these numbers locally. Connector caches the number per Relay origin. Relay upgrades backfill existing registrations while preserving their URLs, device credentials and publication state. Previous locally generated numbers are ignored in new Relay invitations. Upgrade/restart Connector, or use **同步中继编号** with an updated Connector, then recopy invitations. Missing or invalid server numbers block invitation copying. Unregistered LAN agents use a `local-name` alias rather than a fabricated numeric ID.

Uniqueness applies to one Relay database. Independent self-hosted Relays need a shared number registry or centrally assigned, non-overlapping ranges for global uniqueness; neither is implemented. Use the complete service address to distinguish deployments. The receiving CLI refuses to overwrite an existing ID pointing at another URL. Preserve the database and allocator sequence; deleting them resets the namespace.

The **＋ 添加访客** button below the invitation controls adds a named visitor. Chinese names are supported. A masked random token is generated automatically; you can supply your own, reveal it or regenerate it. Duplicate names/tokens are rejected. Each visitor gets a stable internal identity and separate private workspace. Adding a visitor while running keeps existing visitors connected; the new credential requires a restart. **重启并应用** restarts and applies it, ending any active conversation tasks.

Portal/CLI stop first uses authenticated local IPC to drain tasks and stop guest sandboxes while retaining their disks, then terminates the backend only after acknowledgement. A missing acknowledgement leaves the process intact and reports an error. Closing publication only disconnects the Relay and does not stop the Agent.

Portal includes **https://relay.creez.cn** as its default Relay. Operators can override it with `A2A_RELAY_DEFAULT_HOST`; explicitly setting an empty string disables the default. Users can still select a custom Relay host, and existing custom hosts are preserved. Close publication before changing hosts. Each host gets a separate device identity. Older running agents must be stopped and started once through the updated Portal to record their applied configuration. Changed visitor credentials/workspaces require a restart to take effect; invitations can be prepared beforehand with an explicit pending-activation notice.

Closing Portal leaves the Connector running. Closing publication stops forwarding without stopping the local agent or canceling accepted tasks, and preserves its URL. Network failures reconnect to the same identity, but in-flight requests are never replayed. Invitations need a registered URL for the selected Relay; offline invitations carry an explicit notice. A small private control process remains after stopping publication; the standalone CLI's `shutdown` exits it. There is no OS boot service; relaunch Portal/CLI and the local agent after reboot.

Private credentials live under `~/.a2a/relay/<agentId>` and cannot overlap any visitor workspace. Portal's management port is never forwarded. TLS terminates at the Relay/proxy, whose operator can see content and visitor credentials; choose a trusted or self-hosted service. The existing scoped file-reading and public briefing features are unchanged.

For headless use, run `pnpm --filter @talk2myagent/a2a-host start publish AGENT_ID`, `publication AGENT_ID` or `unpublish AGENT_ID`. `publish` can reserve a URL before startup and save the auto-publication setting; a later `start AGENT_ID` connects automatically. The default host is `https://relay.creez.cn`; override it with `A2A_RELAY_DEFAULT_HOST` or save a custom host in Portal. See [Connector CLI](../packages/a2a-connector/README.md) for publishing another compatible native HTTP A2A agent.

Set `A2A_RELAY_SOURCE` to an installed independent Relay checkout, then run Connector's `test:integration` and host's `test:all`. Tests use temporary homes, real HTTP/WS, the background process and headless browser automation. Deterministic replies avoid paid-model calls. A separate dsh-a2a integration test exercises the real harness and A2A protocol through the Relay. Production DNS, TLS proxy and cross-network reachability require deployment acceptance testing.

## Local development installation

Plugin `0.4.1` is available on npm; normal startup does not need a development override. DSH `0.2.1-rc.2` meets the compatibility requirement. Use the following steps only to test local unpublished changes.

Build and pack in the dsh-a2a checkout, then set the package source before starting Portal (POSIX shell example):

```sh
cd /path/to/dsh-a2a
pnpm build
mkdir -p "$HOME/.a2a/packages"
npm pack --pack-destination "$HOME/.a2a/packages"
export A2A_PLUGIN_SOURCE="$HOME/.a2a/packages/dsh-a2a-server-0.4.1.tgz"
pnpm --dir /path/to/Talk2MyAgent/packages/a2a-host start
```

Restart an already running Portal to load the environment variable. Clicking the Agent's Start button upgrades its existing profile and prepares the sandbox automatically. Keep the tarball available for subsequent installs; remove the development override to return to npm releases. This variable selects the local plugin source and does not change the Relay host.

## Self-heal and resetting the relay identity

A relay 401 (unknown device credential, e.g. relay data loss) triggers one registration recovery attempt. A 409 caused by a stale local revision is re-synced once; a duplicate-number 409 is reported without choosing another number. A 403 (revoked/expired) still blocks. To reset by hand, turn publishing off and click “重置 Relay 身份”, or run `a2a-connector reset --state <dir>`; old addresses stop working and the chosen-number setting is cleared. The old number stays reserved, so a new identity must use a different available number.
