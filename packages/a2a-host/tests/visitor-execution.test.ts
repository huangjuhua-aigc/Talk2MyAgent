import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { buildPatchYaml } from '../src/files.ts'
import { visitorExecution } from '../src/visitor-execution.ts'
import type { WizardConfig } from '../src/types.ts'

const original = process.env['A2A_VISITOR_EXECUTION']
afterEach(() => {
  if (original === undefined) delete process.env['A2A_VISITOR_EXECUTION']
  else process.env['A2A_VISITOR_EXECUTION'] = original
})

const config: WizardConfig = { card: { name: 'test', description: '' }, models: [{ provider: 'deepseek', model: 'test' }], activeModelIndex: 0,
  peers: [{ name: 'alice', token: 'test-only', trusted: false }], adminToken: 'test-only-owner', isolation: { workspaceRoot: tmpdir(), peerWorkspaces: {} },
  network: { mode: 'custom', host: 'https://agent.example', port: 3080 } }
const execution = (): string => parse(buildPatchYaml(config, 'TEST_ADMIN', 'test-agent'))[0].insert.find((r: any) => r.id === 'a2a-server').config.isolation.execution

test('visitorExecution defaults to microsandbox and accepts only known values', () => {
  assert.equal(visitorExecution({}), 'microsandbox')
  assert.equal(visitorExecution({ A2A_VISITOR_EXECUTION: '' }), 'microsandbox')
  assert.equal(visitorExecution({ A2A_VISITOR_EXECUTION: 'microsandbox' }), 'microsandbox')
  assert.equal(visitorExecution({ A2A_VISITOR_EXECUTION: 'read-only' }), 'read-only')
  assert.throws(() => visitorExecution({ A2A_VISITOR_EXECUTION: 'readonly' }), /Invalid A2A_VISITOR_EXECUTION/)
})

test('patch execution follows A2A_VISITOR_EXECUTION', () => {
  delete process.env['A2A_VISITOR_EXECUTION']
  assert.equal(execution(), 'microsandbox')
  process.env['A2A_VISITOR_EXECUTION'] = 'read-only'
  assert.equal(execution(), 'read-only')
  process.env['A2A_VISITOR_EXECUTION'] = 'typo'
  assert.throws(() => execution(), /Invalid A2A_VISITOR_EXECUTION/)
})

test('switching execution mode invalidates the applied runtime until restart', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'a2a-exec-'))
  const shared = await mkdtemp(join(tmpdir(), 'a2a-exec-shared-'))
  const previousHome = process.env['A2A_HOST_HOME']
  process.env['A2A_HOST_HOME'] = home
  try {
    const { recordRuntime, appliedVisitors } = await import('../src/publication.ts')
    const record = { id: 'exec-mode', profile: 'a2a-exec-mode', config: { ...config, isolation: { workspaceRoot: shared, peerWorkspaces: {} } } } as any
    delete process.env['A2A_VISITOR_EXECUTION']
    await recordRuntime(record, { host: '127.0.0.1', port: 3999 })
    assert.deepEqual(await appliedVisitors(record), ['alice'])
    process.env['A2A_VISITOR_EXECUTION'] = 'read-only'
    assert.deepEqual(await appliedVisitors(record), [])
    await recordRuntime(record, { host: '127.0.0.1', port: 3999 })
    assert.deepEqual(await appliedVisitors(record), ['alice'])
  } finally {
    if (previousHome === undefined) delete process.env['A2A_HOST_HOME']; else process.env['A2A_HOST_HOME'] = previousHome
    await rm(home, { recursive: true, force: true }); await rm(shared, { recursive: true, force: true })
  }
})
