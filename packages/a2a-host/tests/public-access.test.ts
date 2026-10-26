import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { derivedPublicUrl, previewPublicUrl, resolveBindHost } from '../src/url.ts'
import { buildPatchYaml } from '../src/files.ts'
import { agentBriefingPath, agentManagementPath } from '../src/paths.ts'
import { fetchSnapshot, managementRequest } from '../src/monitor.ts'
import type { WizardConfig } from '../src/types.ts'

test('normalizes HTTPS origins, RPC endpoints and proxy prefixes', () => {
  for (const [host, expected] of [
    ['https://agent.example', 'https://agent.example/a2a'],
    ['https://agent.example/', 'https://agent.example/a2a'],
    ['https://agent.example/a2a', 'https://agent.example/a2a'],
    ['https://agent.example/a2a/', 'https://agent.example/a2a'],
    ['https://agent.example/prefix', 'https://agent.example/prefix/a2a'],
    ['https://agent.example:8443', 'https://agent.example:8443/a2a'],
    ['192.168.1.2', 'http://192.168.1.2:3080/a2a'],
    ['[::1]', 'http://[::1]:3080/a2a'],
  ]) assert.equal(derivedPublicUrl({ mode: 'custom', port: 3080, host }), expected)
})
test('preserves legacy URL before fallback host', () => {
  assert.equal(derivedPublicUrl({ mode: 'custom', port: 3080, publicUrl: 'https://agent.example' }, '127.0.0.1'), 'https://agent.example/a2a')
})
test('rejects credential-bearing, query-bearing and non-HTTP URLs', () => {
  for (const host of ['https://user:secret@agent.example', 'https://agent.example/?secret=value', 'https://agent.example/#secret', 'ftp://agent.example']) {
    assert.throws(() => derivedPublicUrl({ mode: 'custom', port: 3080, host }))
  }
  assert.equal(previewPublicUrl({ mode: 'custom', port: 3080, host: 'https://' }), undefined)
})
test('binds public domains to loopback and explicit local IPs to their interface', () => {
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: 'https://agent.example' }, ['192.168.1.2']), '127.0.0.1')
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: 'agent.example' }, ['192.168.1.2']), '127.0.0.1')
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: 'agent.example:8443' }, ['192.168.1.2']), '127.0.0.1')
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: '[::1]' }, []), '::1')
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: '100.64.1.2' }, ['100.64.1.2']), '100.64.1.2')
  assert.equal(resolveBindHost({ mode: 'lan', port: 3080, host: '192.168.1.2' }, ['192.168.1.2']), '192.168.1.2')
  assert.throws(() => resolveBindHost({ mode: 'lan', port: 3080, host: '192.168.1.9' }, ['192.168.1.2']))
  assert.equal(resolveBindHost({ mode: 'custom', port: 3080, host: 'https://agent.example', bindHost: '192.168.1.2' }, ['192.168.1.2']), '192.168.1.2')
})
test('generates deny-all admission and a separate management endpoint', () => {
  const config: WizardConfig = { card: { name: 'test', description: '' }, models: [{ provider: 'deepseek', model: 'test' }], activeModelIndex: 0,
    peers: [{ name: 'alice', token: 'test-only', trusted: false }], adminToken: 'test-only-owner', isolation: { workspaceRoot: tmpdir(), peerWorkspaces: {} },
    network: { mode: 'custom', host: 'https://agent.example', port: 3080 } }
  const rows = parse(buildPatchYaml(config, 'TEST_ADMIN', 'test-agent'))[0].insert
  const plugin = rows.find((r: any) => r.id === 'a2a-server').config
  assert.deepEqual(plugin.trustedPeers, [])
  assert.equal(plugin.admin.socketPath, agentManagementPath('test-agent'))
  assert.equal(plugin.publicUrl, 'https://agent.example/a2a')
  assert.equal(plugin.briefing.settingsFile, agentBriefingPath('test-agent'))
  assert.match(plugin.briefing.prompt, /这是一次自动更新/)
  assert.match(plugin.briefing.prompt, /直接覆盖写入当前工作目录的 handoff\.md/)
  assert.ok(!plugin.briefing.prompt.includes('schedule_create'))
})
test('monitoring and owner submissions use IPC with authentication', async () => {
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\a2a-test-${randomUUID()}` : join(tmpdir(), `a2a-${randomUUID()}.sock`)
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only-owner')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') {
      assert.equal(req.url, '/a2a/admin/contexts'); res.end(JSON.stringify({ contexts: [], generatedAt: 'now' }))
    } else {
      let body = ''; for await (const chunk of req) body += chunk
      assert.equal(JSON.parse(body).method, 'SendMessage')
      res.end(JSON.stringify({ result: 'ok' }))
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  try {
    assert.equal((await fetchSnapshot(socketPath, 'test-only-owner')).ok, true)
    assert.deepEqual((await managementRequest(socketPath, 'test-only-owner', '/a2a', { method: 'SendMessage' })).json, { result: 'ok' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
