/** Local acceptance helper: restart Connector code, retaining routes and previous enable intent. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { command, ensureDaemon, register, setEnabled, status } from '@talk2myagent/a2a-connector'
const out = 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-relay-numbers'
const live = JSON.parse(await readFile('D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain/info.json', 'utf8'))
await mkdir(out, { recursive: true })
const until = async (check: () => Promise<boolean>) => {
  const deadline = Date.now() + 20000
  while (!await check()) { if (Date.now() > deadline) throw new Error('Connector transition timed out'); await new Promise(r => setTimeout(r, 100)) }
}
if (process.argv[2] === 'stop') {
  const agents = await (await fetch(live.baseURL + '/api/agents')).json() as { id: string }[]
  const before = []
  for (const a of agents) {
    const dir = join(live.host, 'relay', a.id), s = await status(dir)
    if (s.publicRpcUrl) before.push({ id: a.id, dir, enabled: s.desiredEnabled, url: s.publicRpcUrl })
  }
  await writeFile(join(out, 'before.json'), JSON.stringify(before, null, 2))
  for (const a of before) {
    await command(a.dir, 'shutdown'); await until(async () => !(await status(a.dir)).instanceId)
    console.log(JSON.stringify({ id: a.id, connector: 'stopped' }))
  }
} else if (process.argv[2] === 'restore') {
  const before = JSON.parse(await readFile(join(out, 'before.json'), 'utf8'))
  const after = []
  for (const a of before) {
    await ensureDaemon(a.dir)
    const s = await register(a.dir)
    assert.equal(s.publicRpcUrl, a.url); assert.match(s.contactId!, /^13[89]\d{8}$/)
    if (a.enabled) { await setEnabled(a.dir, true); await until(async () => (await status(a.dir)).state === 'online') }
    const current = await status(a.dir)
    after.push({ id: a.id, contactId: s.contactId, url: s.publicRpcUrl, state: current.state, enabled: current.desiredEnabled })
    console.log(JSON.stringify(after.at(-1)))
  }
  assert.equal(new Set(after.map(a => a.contactId)).size, after.length)
  await writeFile(join(out, 'after.json'), JSON.stringify(after, null, 2))
} else throw new Error('Usage: relay-number-upgrade.ts stop|restore')
