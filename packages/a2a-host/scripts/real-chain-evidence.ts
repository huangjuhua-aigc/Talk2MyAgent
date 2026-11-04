import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const out = process.env['A2A_REAL_REPORT'] ?? 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain'
const info = JSON.parse(await readFile(join(out, 'info.json'), 'utf8'))
const key = createHash('sha256').update(`${info.publicRoot}\n/a2a\nA2A_ADMIN_TOKEN_REAL_MICROSANDBOX_AGENT`).digest('hex').slice(0,24)
const store = join(homedir(), '.dsh-a2a', key)
const contexts = []
for (const file of await readdir(store)) {
  if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue
  const c = JSON.parse(await readFile(join(store,file), 'utf8'))
  contexts.push({ peer: c.peer, contextId: c.id, tasks: c.tasks.map((t: any) => ({ id:t.id, status:t.status })),
    events: c.events.filter((e: any) => /tool/.test(JSON.stringify(e.type ?? e.kind ?? ''))),
    eventTypes: [...new Set(c.events.map((e: any) => e.type ?? e.kind ?? Object.keys(e)))] })
}
process.env['MSB_HOME'] = join(info.sandboxHome, 'state')
process.env['MSB_BACKEND'] = 'local'
const sdk = await import(pathToFileURL(join(info.sandboxHome, 'sdk-0.7.11-win32-x64/node_modules/microsandbox/dist/index.js')).href)
const sandboxes = []
for (const peer of ['alice','bob']) {
  const record = JSON.parse(await readFile(join(info.host,'workspaces',info.agentId,'.microsandbox',peer,'record.json'),'utf8'))
  const h = await sdk.Sandbox.get(record.name)
  sandboxes.push({ peer, name: record.name, status: h.status, config: h.config() })
}
const result = { at: new Date().toISOString(), model: info.model, store, contexts, sandboxes }
const label = process.argv[2] || 'evidence'
await writeFile(join(out, `${label}.json`), JSON.stringify(result,null,2))
console.log(JSON.stringify({at:result.at, contexts: contexts.map(c => ({ peer:c.peer, tasks:c.tasks, calls:c.events.filter((e:any)=>e.type==='tool/call').map((e:any)=>({time:e.time,name:e.data.name,args:e.data.arguments})) })), sandboxes:sandboxes.map(s=>({peer:s.peer,name:s.name,status:s.status,mounts:s.config.mounts,network:s.config.network.enabled}))},null,2))
