# A2A calling skill

## 0.2.0 — 2026-10-30

- Preserve Relay path prefixes when discovering an Agent Card; support explicit, same-origin `--card-url` values.
- Parse the direct Task returned by A2A 1.0 `GetTask`, while accepting older wrapped responses.
- Reject credential-bearing URLs, cross-origin Card URLs and authenticated redirects. Do not replay requests after disconnection.
- Include English instructions. Contact books continue storing environment-variable references only.

本版支持中继地址和完整名片路径，修复任务查询响应解析，补充英文说明；更新技能无需重建通讯录或更换访客令牌。
