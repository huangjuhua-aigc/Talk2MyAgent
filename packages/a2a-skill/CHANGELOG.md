# A2A calling skill

## File delivery — 2026-11-24

- Display delivered file IDs and add `download <contact> <fileId> <destination>`. Reuse the contact's authenticated identity and configured endpoint; reject redirects, verify size and SHA-256 through bounded Range requests, and never overwrite local files. Requires plugin 0.6.0 and the file-capable Relay/Connector.
- 新增文件下载命令，按原访客身份下载，校验完整性并保护本地已有文件；不向模型给出的任意 URL 发送凭据，不为下载自动创建新访客身份。

## 0.3.0 — 2026-11-05

- Unify invited and anonymous access through `add`/`send`; tokenEnv is optional. Only a correlated pre-execution challenge permits registration and one continuation with the original messageId. Persist credentials before continuation, reuse identities across processes/aliases, and never register a replacement after invalid credentials, network failures or quota exhaustion. `join` remains available manually and `quota` checks the allowance. Requires server 0.4.1.
- 公开邀请直接使用 add/send；CLI 按服务端明确指引自动匿名登录，不是重定向。身份由服务端签发，凭据独立保存在本机。额度耗尽明确提示联系 Agent 主人开通权限，不换身份绕过限额。

- `send --context <id>` continues an earlier conversation; every task or message reply prints its contextId.
- Accept a direct `message` result from `SendMessage` instead of crashing.
- Refuse plain `http://` for non-loopback hosts so Bearer tokens never travel in cleartext.
- HTTP failures quote the server's short reason and add a hint (e.g. 503 = agent offline).

本版支持多轮对话（`--context`），兼容直接返回消息的服务端，远程地址强制 HTTPS，并让 503 等错误更易读。

- Portal invitations use stable 11-digit IDs confirmed by Relay: owner-entered mobile numbers or legacy automatic 138/139 numbers. Relay rejects duplicate IDs but does not verify phone ownership. Agent names remain readable notes; existing named contacts continue working.
- Reject importing an existing contact ID with a different URL, preserving the existing entry. Invitation instructions check for collisions before storing credentials.

## 0.2.0 — 2026-10-30

- Preserve Relay path prefixes when discovering an Agent Card; support explicit, same-origin `--card-url` values.
- Parse the direct Task returned by A2A 1.0 `GetTask`, while accepting older wrapped responses.
- Reject credential-bearing URLs, cross-origin Card URLs and authenticated redirects. Do not replay requests after disconnection.
- Include English instructions. Contact books continue storing environment-variable references only.

本版支持中继地址和完整名片路径，修复任务查询响应解析，补充英文说明；更新技能无需重建通讯录或更换访客令牌。
