import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPortal } from './support/portal.ts'
import { visitorInstruction } from '../src/invitation.ts'
import { derivedPublicUrl, resolveBindHost } from '../src/url.ts'
import { get } from 'node:http'

test('Portal rejects foreign origins, DNS rebinding and publication without a local session', async () => {
  const portal = await startPortal(1)
  try {
    const base = portal.baseURL, id = portal.agents[0]!.record.id
    const rebindingStatus = await new Promise<number | undefined>((done, reject) => { get(`${base}/api/agents`, { headers: { host: 'attacker.test' } }, res => { res.resume(); done(res.statusCode) }).on('error', reject) })
    assert.equal(rebindingStatus, 403)
    assert.equal((await fetch(`${base}/api/session`, { headers: { origin: 'https://attacker.test' } })).status, 403)
    assert.equal((await fetch(`${base}/api/agents/${id}/publication/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403)
    const { csrfToken } = await (await fetch(`${base}/api/session`)).json() as { csrfToken: string }
    const response = await fetch(`${base}/api/agents/${id}/publication/invitation`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }, body: JSON.stringify({ peerName: 'alice' }) })
    assert.equal(response.status, 200); assert.match((await response.json() as { notice: string }).notice, /当前未连接/)
    const config = structuredClone(portal.agents[0]!.record.config)
    config.isolation.workspaceRoot = portal.root
    const rejected = await fetch(`${base}/api/agents/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })
    assert.equal(rejected.status, 500); assert.match((await rejected.json() as { error: string }).error, /重叠/)
  } finally { await portal.close() }
})
test('relay mode never falls back to localhost in invitations and quotes contact arguments', async () => {
  const portal = await startPortal(1)
  try {
    const config = portal.agents[0]!.record.config
    config.contactId = '13800000001'
    config.card.name = "Agent's name"
    config.network.mode = 'relay'
    assert.equal(derivedPublicUrl(config.network, '127.0.0.1'), undefined)
    assert.equal(resolveBindHost(config.network, ['192.168.1.2']), '127.0.0.1')
    assert.ok(!visitorInstruction(config, config.peers[0]!).includes('localhost'))
    assert.ok(!visitorInstruction(config, config.peers[0]!).includes(config.peers[0]!.token))
    const invitation = visitorInstruction(config, { name: "a'b", token: 'visitor-only', trusted: true }, undefined,
      { publicRpcUrl: 'https://relay.test/r/id/a2a', publicCardUrl: 'https://relay.test/r/id/.well-known/agent-card.json', contactId: '13800000001' })
    assert.match(invitation, /--card-url/); assert.ok(invitation.includes("'Agent'\"'\"'s name'"))
    for (const command of ['add', 'card', 'send']) assert.ok(invitation.includes(`${command} '13800000001'`))
    assert.match(invitation, /A2A_PEER_13800000001/)
    assert.ok(!invitation.includes("'a'\"'\"'b'"))
    assert.ok(!invitation.includes(config.adminToken))
  } finally { await portal.close() }
})

test('publication reset requires CSRF, turns publishing off and forgets the relay identity', async () => {
  const portal = await startPortal(1)
  try {
    const base = portal.baseURL, id = portal.agents[0]!.record.id
    assert.equal((await fetch(`${base}/api/agents/${id}/publication/reset`, { method: 'POST' })).status, 403)
    const { csrfToken } = await (await fetch(`${base}/api/session`)).json() as { csrfToken: string }
    const response = await fetch(`${base}/api/agents/${id}/publication/reset`, { method: 'POST', headers: { 'x-a2a-csrf': csrfToken } })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    const body = JSON.parse(text) as { state: string; desiredEnabled: boolean }
    assert.equal(body.state, 'unregistered'); assert.equal(body.desiredEnabled, false)
    assert.ok(!JSON.stringify(body).includes('token'))
  } finally { await portal.close() }
})
