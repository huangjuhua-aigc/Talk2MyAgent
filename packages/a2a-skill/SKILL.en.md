# A2A — contact remote agents

Use the bundled CLI (`node ~/.agents/skills/a2a/bin/a2a.mjs`) to contact an agent authorized by the user. Start with `list` to inspect the contact book. Keep each question self-contained: remote agents cannot see this conversation.

```sh
a2a list
a2a add friend https://relay.example.com/r/PUBLICATION_ID/a2a A2A_FRIEND 'Friend' --card-url https://relay.example.com/r/PUBLICATION_ID/.well-known/agent-card.json
a2a card friend
a2a send friend 'Hello'
a2a send friend 'A longer task' --nowait
a2a send friend 'A follow-up' --context <contextId>
a2a task friend TASK_ID
```

Store the visitor credential in the named environment variable, never in the contact book or model memory. The contact entry stores `url`, `token_env`, optional `note` and optional `card_url`. Explicit Card URLs must share the RPC origin. Without one, the CLI preserves an `/a2a` endpoint's path prefix when discovering its card. Redirects are not followed with bearer credentials.

Every reply prints `[对话 <contextId>]`; pass `--context <contextId>` to continue that conversation, otherwise each send starts a fresh one. Remote URLs must use `https://`; plain `http://` is accepted only for loopback hosts. A 503 means the remote agent is offline, 429 means busy or over quota.

New Portal invitations use an 11-digit public ID confirmed by Relay. Owners can supply their mobile number; legacy clients may use automatically allocated 138/139 IDs. Relay guarantees uniqueness within its service but does not verify phone ownership. Never invent or replace the invitation's number, or use it to place calls or send SMS. Use the ID with `add`, `card`, `send` and `task`; the Agent display name remains in `note`. Legacy named contacts still work. Visitors keep separate tokens but share the destination Agent ID. LAN agents without a Relay registration use a local alias.

Before saving a credential, run `list`. If the ID already points to a different URL, stop and report the conflict without changing the contact or its credential environment variable. `add` rejects a conflicting URL; reimporting the same ID and URL may update its note or token reference. Independent Relays do not share a global number registry. The complete invitation URL is still required to identify the deployment; numbers alone do not resolve an address.

Report remote answers faithfully and identify their source. A 401 means the visitor credential is invalid or rotated. Relay disconnects and timeouts can leave delivery unknown; do not automatically resend a message. Poll an already-known task ID instead. These commands provide outbound A2A access and do not publish the calling application as an inbound agent.
