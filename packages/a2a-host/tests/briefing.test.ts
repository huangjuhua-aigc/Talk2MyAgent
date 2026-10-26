import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startPortal } from './support/portal.ts'
import type { HandoffSnapshot } from '../src/types.ts'

test('Portal defaults automatic briefing on, persists its switch and exposes direct updates', { timeout: 25_000 }, async () => {
  const portal = await startPortal()
  try {
    const agent = portal.agents[0]!
    const base = `${portal.baseURL}/api/agents/${agent.record.id}`
    const original = await readFile(agent.briefing, 'utf8')
    const get = async (): Promise<HandoffSnapshot> => {
      const response = await fetch(`${base}/handoff`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return await response.json() as HandoffSnapshot
    }
    const toggle = (enabled: unknown) => fetch(`${base}/briefing-auto`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
    })
    const initial = await get()
    assert.equal(initial.autoUpdateEnabled, true)
    assert.equal(initial.text, original)
    assert.ok(initial.updatedAt && Number.isFinite(Date.parse(initial.updatedAt)))

    assert.equal((await toggle(false)).status, 200)
    assert.equal((await get()).autoUpdateEnabled, false)
    assert.equal(await readFile(agent.briefing, 'utf8'), original)
    assert.deepEqual(JSON.parse(await readFile(join(portal.host, 'briefings', `${agent.record.id}.json`), 'utf8')), { enabled: false })
    assert.equal((await toggle('false')).status, 400)
    assert.equal((await get()).autoUpdateEnabled, false)
    const other = await fetch(`${portal.baseURL}/api/agents/${portal.agents[1]!.record.id}/handoff`)
    assert.equal((await other.json() as HandoffSnapshot).autoUpdateEnabled, true)

    await writeFile(agent.briefing, '自动更新的正式简报')
    assert.equal((await get()).text, '自动更新的正式简报')
    assert.equal((await toggle(true)).status, 200)
    assert.equal((await get()).autoUpdateEnabled, true)
    assert.equal(agent.taskCalls, 0)
    assert.equal((await fetch(`${base}/briefing-schedule`, { method: 'POST' })).status, 404)

    await rm(agent.briefing)
    assert.deepEqual(await get(), { text: '', updatedAt: null, autoUpdateEnabled: true })
    const manual = await fetch(`${base}/handoff`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '手动更新' }) })
    assert.equal(manual.status, 200)
    assert.equal((await get()).text, '手动更新')
    for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await fetch(`${base}/handoff-draft`, { method })).status, 404)
  } finally { await portal.close() }
})
