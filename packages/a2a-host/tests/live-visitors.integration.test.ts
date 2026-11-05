/** Cross-repository regression: real Portal, real plugin/IPC, deterministic model only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startPortal } from './support/portal.ts'
import { recordRuntime } from '../src/publication.ts'
import { agentManagementPath } from '../src/paths.ts'
import type { AgentRecord } from '../src/files.ts'

test('Portal adds a visitor to the actual running plugin without restarting or interrupting an existing task',
  { skip: !process.env['A2A_PLUGIN_SOURCE'] }, async () => {
  const { compose } = await import(pathToFileURL(join(process.env['A2A_PLUGIN_SOURCE']!, 'example/compose.ts')).href)
  const portal = await startPortal(0), workspace = join(portal.root, 'public')
  const keys = ['A2A_HOST_HOME', 'DSH_HOME', 'A2A_LIVE_E2E_OWNER', 'A2A_LIVE_E2E_ALICE'] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  let app: any, release: (() => void) | undefined
  try {
    process.env['A2A_HOST_HOME'] = portal.host; process.env['DSH_HOME'] = join(portal.root, 'dsh')
    process.env['A2A_LIVE_E2E_OWNER'] = 'fixture-live-e2e-owner-token'
    process.env['A2A_LIVE_E2E_ALICE'] = 'fixture-live-e2e-alice-token'
    await mkdir(workspace)
    const { csrfToken } = await (await fetch(portal.baseURL + '/api/session')).json() as any
    const post = (path: string, body: unknown, method = 'POST') => fetch(portal.baseURL + path,
      { method, headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }, body: JSON.stringify(body) })
    const created = await (await post('/api/agents', {
      card: { name: 'Live admission E2E', description: 'Isolated test' }, models: [{ provider: 'deepseek', model: 'fixture' }], activeModelIndex: 0,
      peers: [{ name: 'alice', token: process.env['A2A_LIVE_E2E_ALICE'], trusted: true }], adminToken: process.env['A2A_LIVE_E2E_OWNER'],
      isolation: { workspaceRoot: workspace, peerWorkspaces: {} }, network: { mode: 'lan', host: '127.0.0.1', port: 9991 },
    })).json() as { record: AgentRecord }
    const record = created.record
    app = await compose({ forceStub: true, workspaceRoot: workspace, peers: { alice: 'A2A_LIVE_E2E_ALICE' }, trustedPeers: ['alice'], adminTokenEnv: 'A2A_LIVE_E2E_OWNER',
      overrides: { admin: { tokenEnv: 'A2A_LIVE_E2E_OWNER', socketPath: agentManagementPath(record.id) },
        isolation: { workspaceRoot: workspace, privateRoot: join(portal.root, 'private'), peerWorkspaces: {}, workspaceMode: 'per-peer', execution: 'read-only' },
        storage: { directory: join(portal.root, 'state'), retentionMs: 86400000, maxContexts: 100, maxContextBytes: 4000000 } } })
    record.config.network.port = app.port
    assert.equal((await post(`/api/agents/${record.id}`, record.config, 'PUT')).status, 200)
    await recordRuntime(record, { host: '127.0.0.1', port: app.port })
    await writeFile(join(portal.host, 'agents', `${record.id}.pid`), String(process.pid))
    const rpc = async (token: string, method: string, params: unknown) => {
      const response = await fetch(app.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      return { status: response.status, body: await response.json() as any }
    }
    const message = { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: 'before addition' }] }, configuration: { returnImmediately: true } }
    release = app.adapter.hold()
    const task = (await rpc(process.env['A2A_LIVE_E2E_ALICE']!, 'SendMessage', message)).body.result.task
    assert.ok(['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'].includes(task.status.state))
    const port = app.port, token = 'fixture-live-e2e-bob-token'
    assert.equal((await rpc(token, 'ListTasks', {})).status, 401)
    const added = await (await post(`/api/agents/${record.id}/visitors`, { displayName: 'Bob', token })).json() as any
    assert.equal(added.applied, true); assert.equal(added.requiresRestart, false)
    assert.ok(!JSON.stringify(added).includes(token))
    assert.equal(app.port, port)
    assert.ok(['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'].includes((await rpc(process.env['A2A_LIVE_E2E_ALICE']!, 'GetTask', { id: task.id })).body.result.status.state))
    assert.ok((await rpc(token, 'GetTask', { id: task.id })).body.error)
    release!(); release = undefined
    const reply = await rpc(token, 'SendMessage', { message: { ...message.message, messageId: crypto.randomUUID() } })
    assert.equal(reply.body.result.task.status.state, 'TASK_STATE_COMPLETED')
    const detail = await (await fetch(`${portal.baseURL}/api/agents/${record.id}`)).json() as any
    assert.deepEqual(detail.appliedPeers, ['alice', added.peer.name])
    assert.deepEqual((await portal.readRecord(record.id)).config.peers[0], record.config.peers[0])
    await rm(join(portal.host, 'agents', `${record.id}.pid`), { force: true })
  } finally {
    release?.(); await app?.stop(); await portal.close()
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key] }
  }
})
