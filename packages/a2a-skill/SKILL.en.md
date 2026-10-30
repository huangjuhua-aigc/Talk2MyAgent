# A2A — contact remote agents

Use the bundled CLI (`node ~/.agents/skills/a2a/bin/a2a.mjs`) to contact an agent authorized by the user. Start with `list` to inspect the contact book. Keep each question self-contained: remote agents cannot see this conversation.

```sh
a2a list
a2a add friend https://relay.example.com/r/PUBLICATION_ID/a2a A2A_FRIEND 'Friend' --card-url https://relay.example.com/r/PUBLICATION_ID/.well-known/agent-card.json
a2a card friend
a2a send friend 'Hello'
a2a send friend 'A longer task' --nowait
a2a task friend TASK_ID
```

Store the visitor credential in the named environment variable, never in the contact book or model memory. The contact entry stores `url`, `token_env`, optional `note` and optional `card_url`. Explicit Card URLs must share the RPC origin. Without one, the CLI preserves an `/a2a` endpoint's path prefix when discovering its card. Redirects are not followed with bearer credentials.

Report remote answers faithfully and identify their source. A 401 means the visitor credential is invalid or rotated. Relay disconnects and timeouts can leave delivery unknown; do not automatically resend a message. Poll an already-known task ID instead. These commands provide outbound A2A access and do not publish the calling application as an inbound agent.
