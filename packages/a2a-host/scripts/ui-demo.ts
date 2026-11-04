/** Isolated UI recording environment. Real Portal/Relay; deterministic agent replies. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startPortal } from '../tests/support/portal.ts'
import { command } from '@talk2myagent/a2a-connector'

const portal = await startPortal(1, { port: Number(process.env['A2A_DEMO_PORT'] ?? 17890),
  relayOrigin: process.env['A2A_DEMO_RELAY'] ?? 'http://127.0.0.1:8787', publicA2A: true })
// This process owns the deterministic public agent's real HTTP listener.
await writeFile(join(portal.host, 'agents', `${portal.agents[0]!.record.id}.pid`), String(process.pid))
const info = { baseURL: portal.baseURL, root: portal.root, host: portal.host, agentId: portal.agents[0]!.record.id,
  publicRoot: portal.agents[0]!.record.config.isolation.workspaceRoot, pid: process.pid, model: 'deterministic test fixture' }
if (process.env['A2A_DEMO_INFO']) await writeFile(process.env['A2A_DEMO_INFO'], JSON.stringify(info, null, 2))
console.log(JSON.stringify(info))
let closing = false
async function close() {
  if (closing) return; closing = true
  for (const agent of portal.agents) await command(join(portal.host, 'relay', agent.record.id), 'shutdown').catch(() => {})
  await portal.close(); process.exit(0)
}
process.on('SIGINT', () => { void close() }); process.on('SIGTERM', () => { void close() })
