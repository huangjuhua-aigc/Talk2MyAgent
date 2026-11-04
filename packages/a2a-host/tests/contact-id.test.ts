import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isContactId } from '../src/contact-id.ts'
import { visitorInstruction } from '../src/invitation.ts'
import { startPortal } from './support/portal.ts'

test('invitations use only the Relay-confirmed ID, never an unregistered draft or legacy local number', async () => {
  const portal = await startPortal(1)
  try {
    const config = structuredClone(portal.agents[0]!.record.config)
    config.network.mode = 'relay'; config.contactId = '13988888888'
    config.network.relay = { provider:'default', enabled:true, contactId:'18612345678' }
    const publication = { publicRpcUrl: 'https://relay.test/r/published-agent/a2a', publicCardUrl: 'https://relay.test/r/published-agent/.well-known/agent-card.json', contactId: '13800000000' }
    for (const peer of [{ name: 'alice', token: 'only-alice', trusted: true }, { name: 'bob', token: 'only-bob', trusted: true }]) {
      const text = visitorInstruction(config, peer, undefined, publication)
      for (const command of ['add', 'card', 'send']) assert(text.includes(`${command} '13800000000'`))
      assert(text.includes(peer.token)); assert(!text.includes('13988888888')); assert(!text.includes('18612345678'))
    }
    for (const value of [undefined, '12712345678', '1381234567', '139123456789', '1380000000x']) {
      assert.equal(isContactId(value), false)
      const text = visitorInstruction(config, config.peers[0]!, undefined, { ...publication, contactId: value ?? '' })
      assert(text.includes('升级中继')); assert(!text.includes(config.peers[0]!.token))
    }
    assert(isContactId('13712345678')); assert(isContactId('18612345678'))
  } finally { await portal.close() }
})

test('loading and saving unregistered agents does not allocate a local phone-like number', async () => {
  const portal = await startPortal(1)
  try {
    const before = portal.agents[0]!.record
    const detail = await (await fetch(`${portal.baseURL}/api/agents/${before.id}`)).json()
    assert.equal(detail.config.contactId, undefined)
    assert.equal(JSON.parse(await readFile(join(portal.host, 'agents', `${before.id}.json`), 'utf8')).config.contactId, undefined)
    const text = visitorInstruction(detail.config, detail.config.peers[0])
    assert(text.includes('通讯录本地别名：local-Alpha Agent'))
    assert(!/通讯录 ID：13[89]\d{8}/.test(text))
    const { csrfToken } = await (await fetch(`${portal.baseURL}/api/session`)).json()
    const response = await fetch(`${portal.baseURL}/api/agents/${before.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }, body: JSON.stringify(detail.config) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).record.config.contactId, undefined)
  } finally { await portal.close() }
})
