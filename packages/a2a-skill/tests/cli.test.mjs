import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const cliPath = fileURLToPath(new URL('../bin/a2a.mjs', import.meta.url))
const token = 'fixture-outbound-secret'

async function withFixture(check) {
  const root = await mkdtemp(join(tmpdir(), 'a2a-cli-'))
  const calls = []
  let status = 200
  const server = createServer((req, res) => {
    void (async () => {
      if (status !== 200 || req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(status === 200 ? 401 : status); res.end('{}'); return
      }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/.well-known/agent-card.json' || req.url === '/r/test/.well-known/agent-card.json' || req.url === '/custom-card') {
        res.end(JSON.stringify({ name: 'Fixture agent', description: '项目资料助手', skills: [{ name: '读取公开资料', description: '只读文本' }] })); return
      }
      assert.equal(req.headers['a2a-version'], '1.0')
      let body = ''
      for await (const chunk of req) body += chunk
      const rpc = JSON.parse(body)
      calls.push(rpc)
      const immediate = rpc.params.configuration?.returnImmediately === true
      const task = { id: 'task-1', contextId: 'context-1',
        status: { state: immediate ? 'TASK_STATE_WORKING' : 'TASK_STATE_COMPLETED' },
        artifacts: immediate ? [] : [{ parts: [{ text: rpc.params.message?.parts[0].text ?? '查询得到的结果' }] }],
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'GetTask' ? task : { task } }))
    })().catch(error => { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })) })
  })
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
    const url = `http://127.0.0.1:${server.address().port}/a2a`
    const cli = (args, extraEnv = {}) => run(process.execPath, [cliPath, ...args], {
      env: { ...process.env, A2A_HOME: root, A2A_TEST_TOKEN: token, ...extraEnv }, timeout: 5000, windowsHide: true,
    })
    await cli(['add', 'friend', url, 'A2A_TEST_TOKEN', '测试联系人'])
    await check({ root, calls, cli, url, setStatus: value => { status = value } })
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise(done => server.close(done))
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
}

test('C01 stores contact references without persisting credential values', () => withFixture(async ({ root, cli }) => {
  const contacts = await readFile(join(root, 'contacts.json'), 'utf8')
  assert.ok(contacts.includes('A2A_TEST_TOKEN'))
  assert.ok(!contacts.includes(token))
  const listed = await cli(['list'])
  assert.match(listed.stdout, /friend/)
  assert.match(listed.stdout, /测试联系人/)
  assert.ok(!listed.stdout.includes(token))
}))

test('C02 fetches a card and sends Chinese text through A2A 1.0', () => withFixture(async ({ cli, calls }) => {
  assert.match((await cli(['card', 'friend'])).stdout, /读取公开资料/)
  const reply = await cli(['send', 'friend', '查询项目进展 🚀'])
  assert.match(reply.stdout, /查询项目进展 🚀/)
  assert.equal(calls[0].method, 'SendMessage')
  assert.equal(calls[0].params.message.role, 'ROLE_USER')
  assert.ok(calls[0].params.message.messageId)
}))

test('C03 nonblocking send returns a task that can be polled', () => withFixture(async ({ cli, calls }) => {
  assert.match((await cli(['send', 'friend', '稍后处理', '--nowait'])).stdout, /TASK_STATE_WORKING/)
  assert.equal(calls[0].params.configuration.returnImmediately, true)
  assert.match((await cli(['task', 'friend', 'task-1'])).stdout, /查询得到的结果/)
  assert.equal(calls[1].method, 'GetTask')
  assert.equal(calls[1].params.id, 'task-1')
  assert.deepEqual(calls.map(call => call.method), ['SendMessage', 'GetTask'])
}))

test('C04 missing and rejected credentials fail clearly without exposing their value', () => withFixture(async ({ cli, setStatus }) => {
  await assert.rejects(cli(['send', 'friend', 'hello'], { A2A_TEST_TOKEN: '' }), error => {
    assert.match(error.stderr, /token missing/); return error.code !== 0
  })
  setStatus(401)
  await assert.rejects(cli(['send', 'friend', 'hello']), error => {
    assert.match(error.stderr, /rejected \(401\)/)
    assert.ok(!error.stderr.includes(token))
    return error.code !== 0
  })
}))

test('C05 keeps relay prefixes and explicit card paths; rejects cross-origin credential leakage', () => withFixture(async ({ cli, root, url }) => {
  const origin = new URL(url).origin
  await cli(['add','relay',`${origin}/r/test/a2a`,'A2A_TEST_TOKEN','Relay'])
  assert.match((await cli(['card','relay'])).stdout, /Fixture agent/)
  await cli(['add','custom',url,'A2A_TEST_TOKEN','Custom','--card-url',`${origin}/custom-card`])
  assert.match((await cli(['card','custom'])).stdout, /Fixture agent/)
  const saved = JSON.parse(await readFile(join(root,'contacts.json'),'utf8'))
  assert.equal(saved.agents.custom.card_url,`${origin}/custom-card`)
  await assert.rejects(cli(['add','bad',url,'A2A_TEST_TOKEN','--card-url','https://elsewhere.test/card']))
}))
