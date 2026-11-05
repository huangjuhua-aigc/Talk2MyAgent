import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { preferContactAddress } from '../src/public-address.mjs'
import { pipePath, status } from '../src/manager.mjs'

const origin = 'https://relay.example.com', publicationId = '12345678-1234-1234-1234-123456789012'
const legacy = { publicationId, contactId: '13800000002', relayOrigin: origin,
  publicRpcUrl: `${origin}/r/${publicationId}/a2a`, publicCardUrl: `${origin}/r/${publicationId}/.well-known/agent-card.json`,
  contactRpcUrl: `${origin}/r/13800000002/a2a`, contactCardUrl: `${origin}/r/13800000002/.well-known/agent-card.json` }

test('prefers confirmed phone aliases while keeping the publication identity and legacy metadata unchanged', () => {
  const preferred = preferContactAddress(legacy)
  assert.equal(preferred.publicRpcUrl, legacy.contactRpcUrl)
  assert.equal(preferred.publicCardUrl, legacy.contactCardUrl)
  assert.equal(preferred.publicationId, publicationId)
  assert.equal(legacy.publicRpcUrl, `${origin}/r/${publicationId}/a2a`)
  assert.equal(preferContactAddress(preferred), preferred)
})

test('never invents an alias or accepts cross-origin, mismatched, or incomplete phone endpoints', () => {
  for (const change of [{ contactRpcUrl: undefined }, { contactCardUrl: undefined }, { contactId: '13900000003' },
    { contactRpcUrl: 'https://other.example.com/r/13800000002/a2a' },
    { contactCardUrl: `${origin}/r/13800000002/.well-known/agent-card.json?secret=x` },
    { relayOrigin: 'https://other.example.com' }, { publicRpcUrl: `${origin}/r/unrelated/a2a` }]) {
    const info = { ...legacy, ...change }; assert.equal(preferContactAddress(info), info)
  }
})

test('old daemon responses and offline saved state expose the same phone address without rewriting credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-address-status-')), token = 'fixture-private-control'
  const saved = JSON.stringify({ config: { relayOrigin: origin }, registrations: { [origin]: { token: 'fixture-device-secret', info: legacy } }, desiredEnabled: false })
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ...legacy, state: 'online', desiredEnabled: true }))
  })
  try {
    await writeFile(join(root, 'control.json'), JSON.stringify({ token })); await writeFile(join(root, 'state.json'), saved)
    assert.equal((await status(root)).publicRpcUrl, legacy.contactRpcUrl)
    await new Promise(done => server.listen(pipePath(root), done))
    const online = await status(root); assert.equal(online.publicRpcUrl, legacy.contactRpcUrl); assert.equal(online.state, 'online')
    assert.equal(await readFile(join(root, 'state.json'), 'utf8'), saved)
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done))
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
