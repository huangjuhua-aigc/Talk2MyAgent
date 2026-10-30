# A2A Relay wire protocol v1

Shared transport validation and constants; no DSH or model dependency. Relay vendors this source so its repository can install independently. Sync snapshots with the Relay's `scripts/sync-protocol.mjs` and rerun interoperability tests when changing this file. Version 1 intentionally uses a fixed negotiated response window rather than accepting arbitrary remote flow-control settings.

Every JSON frame carries `v: 1`, `connectionId`, `generation` and `type`. Except for `hello`, `ready`, `ready_ack`, it also carries `requestId`. IDs are unique within their scope; a new connection replaces the previous generation. Unknown, oversized, out-of-sequence or invalid credit frames close the tunnel. Frames for completed/aborted request IDs are ignored.

| Direction | Frames | Fields |
| --- | --- | --- |
| Relay → Connector | `hello` | session identity and generation |
| Connector → Relay → Connector | `ready`, `ready_ack` | handshake |
| Relay → Connector | `request_begin`, `request_data`, `request_end` | fixed `route` (`card`/`rpc`), allowlisted `headers`, total `length`; base64 `data` and `seq`; final next `seq` |
| Connector → Relay | `response_begin`, `response_data`, `response_end` | HTTP `status` and allowlisted `headers`; base64 `data` and `seq`; final next `seq` |
| Relay → Connector | `credit` | cumulative consumed response bytes, never greater than bytes sent |
| Either | `abort` | terminate the HTTP exchange, **not** the local model task |

Request bodies are fully assembled and bounded before invoking the fixed local route. Response chunks remain bytes, including SSE. `credit` advances only when the Relay HTTP write callback completes; duplicate totals add no credit. WebSocket callbacks and the bounded native queue limit buffered sends. No gzip or WebSocket compression, arbitrary target path, retry/replay or exactly-once promise is supported.
