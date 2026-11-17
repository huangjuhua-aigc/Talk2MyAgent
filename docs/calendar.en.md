# Local calendar authorization and automatic booking

The Portal supports Google Calendar and Feishu only. Authorization completes on the owner's computer; encrypted tokens stay there and the Agent calls provider APIs directly. No calendar authorization service or Relay change is required.

## Owner experience

Connect one provider on an existing Agent, even before it starts. On first Google connection, import your own Desktop OAuth client JSON using the setup guide in the Portal, then authorize in the browser through a temporary loopback callback. Later connections reuse the saved configuration. Feishu first creates a dedicated application through its official SDK; return to the Portal and click **Continue authorizing Feishu calendar** for user consent. Organization policy may require administrator approval.

Start the Agent after authorization. A running Agent needs one restart to load the meeting skill and tools. After connection, closing the Portal does not prevent the Agent from refreshing tokens or booking. Disconnect removes local credentials and rejects subsequent tool calls; an already started write may finish. Existing events remain. Revoke application access at the provider separately if desired. Old cloud capability files must be disconnected and reauthorized locally.

Visitors negotiate in chat, receive an expiring proposal, explicitly confirm its exact details, then get a booking result. The first version writes only to the owner's calendar: no email invitations, video meeting links, cancellation or rescheduling. Owner approval and IM notifications remain extension points.

Set `A2A_CALENDAR_INSTRUCTIONS` before starting the Portal for owner scheduling preferences. These are model instructions, not a hard scheduling policy engine. Date/time, visitor ownership, conflicts and duplicate writes are independently checked by the tools.

## Google first-time setup

Google OAuth needs a Client ID to identify the application. Open-source users create and own this configuration; the framework does not need an embedded shared ID. Like OpenClaw's gog setup, import a downloaded client JSON and then sign in. The Portal presents the setup steps without requiring manual field copying or environment variables.

1. Create or select a project in [Google Cloud](https://console.cloud.google.com/projectcreate) and enable the [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. Configure [Google Auth Platform](https://console.cloud.google.com/auth/branding). Personal accounts use External; add your email as a test user under Audience while in Testing.
3. Create a **Desktop app** OAuth client under [Clients](https://console.cloud.google.com/auth/clients) and download its JSON.
4. Select Google in the Portal, click the enabled **Connect calendar** button, choose the JSON, then **Save configuration and authorize**. Web clients and service accounts are rejected.

The configuration is encrypted per Agent in local `~/.a2a/calendar/calendar.sqlite`, never sent to the Relay, echoed to the browser, or committed to source. It survives Portal restart and calendar disconnect; use **Replace Google configuration** after disconnect to import another client. Deleting the Agent also removes its saved client configuration. Google's testing and verification requirements still apply; Calendar refresh tokens for External apps in Testing normally expire after seven days and require reauthorization. See [Google's token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

Existing `A2A_GOOGLE_CLIENT_ID` / `A2A_GOOGLE_CLIENT_SECRET` environment configuration remains supported as a fallback; imported configuration takes precedence. A desktop client is public and its client secret cannot be treated as confidential.

Google uses a random-port `127.0.0.1` callback, one-use state and S256 PKCE. Scopes are `calendar.events`, `calendar.freebusy`, and `calendar.calendarlist.readonly`, with the full Google scope prefix. Reads and writes target the consenting user's primary calendar.

Feishu uses official `registerApp` with `createOnly`, then device authorization as implemented by the official CLI. It requests `offline_access`, `calendar:calendar:readonly`, and `calendar:calendar.event:create`. Each local application has its own credentials; no shared confidential AppSecret is distributed. Tokens use the v3 endpoint, and rotating refresh tokens are saved before another API request. Busy times come from the consenting user, including external calendar availability provided by Feishu; events are created in the user's primary calendar. Only mainland Feishu is supported.

## Storage and reliability

`~/.a2a/calendar/<agent>.connection.json` holds AES-256-GCM encrypted credentials. Windows protects the master key using current-user DPAPI. macOS/Linux use a 0700 directory and 0600 key file. This does not defend against programs already running as the same OS user. Reauthorize after changing machines.

The encrypted SQLite booking ledger and key stay outside public data and all visitor workspaces. Tokens never enter model input. Four narrow tools capture the authenticated visitor identity on the server. Calendar calls do not grant shell or file-write permissions.

Local processes sharing the calendar directory serialize requests with a recoverable cross-process lock. This does not lock other computers or external calendar clients. Proposals expire after 15 minutes; confirmation rechecks availability. Durable write intent precedes external creation. Unknown results become `uncertain`, requiring lookup of the original booking ID, never automatic replay. Google uses stable event IDs and Feishu idempotency keys. Deleted events become `missing` and are not recreated.

## Development and validation

Calendar booking requires `dsh-a2a-server@0.5.0` or later and the matching Portal. Portal updates older plugins before startup; restart the Agent once after upgrading. Existing local authorization is preserved. For source development, build the matching dsh-a2a checkout and set the Portal's `A2A_PLUGIN_SOURCE` to its path. Tests need this variable for cross-repository calendar integration; set `A2A_RELAY_SOURCE` and `A2A_CONNECTOR_SOURCE` for Relay suites. See the [Chinese guide with commands](calendar.md) and [test report](calendar-test-report.md).

The end-to-end suite exercises the real Portal, SDK, Agent runtime, local Relay and Connector. External provider consent and API responses are simulated; no real calendar is modified. `--real-model` uses the configured DeepSeek model. Live OAuth approval, tenant policies and actual event creation still require an owner's provider authorization.

References: [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Feishu registration SDK](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs), [official device flow](https://github.com/larksuite/cli/blob/main/internal/auth/device_flow.go), [Feishu v3 token](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3).
