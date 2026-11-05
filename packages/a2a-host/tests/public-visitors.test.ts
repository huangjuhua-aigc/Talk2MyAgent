import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startPortal } from './support/portal.ts'

test('public admission defaults off, requires CSRF, persists per agent, and produces invitations without shared tokens', async () => {
  const portal = await startPortal(2), agent = portal.agents[0]!.record
  try {
    const url = `${portal.baseURL}/api/agents/${agent.id}/public-visitors`
    const before = await portal.readRecord(agent.id)
    assert.equal((await (await fetch(url)).json() as any).enabled, false)
    const { csrfToken } = await (await fetch(portal.baseURL + '/api/session')).json() as any
    const headers = { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }
    assert.equal((await fetch(url, { method: 'PUT', body: '{"enabled":true}' })).status, 403)
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{"enabled":"true"}' })).status, 400)
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{"enabled":true}' })).status, 200)
    assert.equal((await (await fetch(url)).json() as any).enabled, true)
    assert.equal((await (await fetch(`${portal.baseURL}/api/agents/${portal.agents[1]!.record.id}/public-visitors`)).json() as any).enabled, false)
    assert.deepEqual((await portal.readRecord(agent.id)).config, before.config)
    assert.equal(JSON.parse(await readFile(join(portal.host, 'public-visitors', `${agent.id}.json`), 'utf8')).enabled, true)
    const invite = await (await fetch(`${portal.baseURL}/api/agents/${agent.id}/publication/invitation`, { method: 'POST', headers, body: '{"peerName":"__public__"}' })).json() as any
    assert.match(invite.text, /a2a.mjs add/); assert.match(invite.text, /a2a.mjs send/); assert.doesNotMatch(invite.text, /a2a.mjs join/); assert.match(invite.text, /5 次/)
    for (const peer of agent.config.peers) assert.ok(!invite.text.includes(peer.token))
    assert.ok(!invite.text.includes(agent.config.adminToken))
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{"enabled":false}' })).status, 200)
    assert.equal((await (await fetch(url)).json() as any).enabled, false)
  } finally { await portal.close() }
})
