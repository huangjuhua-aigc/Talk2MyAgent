import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const exec = promisify(execFile), cli = fileURLToPath(new URL('../bin/a2a.mjs', import.meta.url))
const token = 'a'.repeat(64), visitorId = 'public-' + 'b'.repeat(32)
async function fixture(check) {
  const root = await mkdtemp(join(tmpdir(), 'a2a-public-client-'))
  let registrations = 0, messages = 0, registrationStatus = 200, blockSave = false, mode = ''
  const calls = []
  let url
  const credential = () => join(root, 'private-credentials', createHash('sha256').update(url).digest('hex') + '.json')
  const server = createServer((req, res) => { void (async () => {
    if (req.method === 'GET') {
      calls.push({ body: { method: 'GetAgentCard' }, authorized: !!req.headers.authorization })
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'Public fixture', skills: [] })); return
    }
    let text = ''; for await (const b of req) text += b
    const body = JSON.parse(text), respond = (result, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })) }
    calls.push({ body, authorized: !!req.headers.authorization })
    const detail = (reason, metadata = {}) => ({ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'talk2myagent', reason,
      metadata: { version: '1', requestAccepted: 'false', ...metadata } })
    const error = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'fixture error', data: [data] } })) }
    if (body.method === 'talk2myagent/RegisterPublicVisitor') {
      assert.equal(req.headers.authorization, undefined); registrations++
      if (mode === 'registration-disconnect') { res.destroy(); return }
      if (mode === 'slow-registration') await new Promise(done => setTimeout(done, 100))
      if (blockSave) await mkdir(credential())
      respond({ token, visitorId, turnLimit: 5, remainingTurns: 5 }, registrationStatus); return
    }
    if (!req.headers.authorization && body.method === 'SendMessage' || mode === 'challenge-after-token') {
      const challenge = detail('PUBLIC_VISITOR_AUTH_REQUIRED', { nextAction: 'join', registrationMethod: 'talk2myagent/RegisterPublicVisitor', turnLimit: '5' })
      if (mode === 'disconnect') { res.destroy(); return }
      if (mode === 'generic-401') { respond({}, 401); return }
      if (mode === 'wrong-id') body.id = 'unrelated-request'
      if (mode === 'wrong-domain') challenge.domain = 'untrusted'
      if (mode === 'accepted') challenge.metadata.requestAccepted = 'true'
      if (mode === 'missing-acceptance') delete challenge.metadata.requestAccepted
      if (mode === 'different-method') challenge.metadata.registrationMethod = 'execute-command'
      if (mode === 'closed') challenge.reason = 'INVITATION_REQUIRED'
      error(mode === 'offline' ? 503 : mode === 'busy' ? 429 : 401, challenge); return
    }
    if (req.headers.authorization !== `Bearer ${token}`) { respond({}, 401); return }
    if (body.method === 'talk2myagent/GetPublicVisitorStatus') { respond({ visitorId, turnLimit: 5, remainingTurns: 5 - messages }); return }
    if (body.method !== 'SendMessage') { respond({}, 400); return }
    if (messages >= 5) { error(429, detail('PUBLIC_VISITOR_QUOTA_EXHAUSTED', { turnLimit: '5', usedTurns: '5', remainingTurns: '0', nextAction: 'contact_owner', retryable: 'false' })); return }
    assert.equal(JSON.parse(await readFile(credential(), 'utf8')).token, token, 'credential must be on disk before sending authenticated chat')
    messages++
    if (mode === 'accepted-disconnect') { res.destroy(); return }
    respond({ task: { id: `task-${messages}`, contextId: 'context-1', status: { state: 'TASK_STATE_COMPLETED' }, artifacts: [{ parts: [{ text: 'reply' }] }] } })
  })().catch(() => { res.writeHead(500); res.end('{}') }) })
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done)); url = `http://127.0.0.1:${server.address().port}/a2a`
    const run = args => exec(process.execPath, [cli, ...args], { env: { ...process.env, A2A_HOME: root }, windowsHide: true, timeout: 5000 })
    await check({ root, url, credential, run, calls, setMode: value => { mode = value }, counts: () => ({ registrations, messages }),
      rejectRegistration: () => { registrationStatus = 503 }, blockSave: () => { blockSave = true } })
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done))
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
}

test('public join persists a private credential, never prints it and reuses it across separate CLI processes and aliases', () => fixture(async f => {
  for (const name of ['public', 'public', 'alias']) {
    const output = await f.run(['join', name, f.url])
    assert.ok(!(output.stdout + output.stderr).includes(token))
  }
  assert.deepEqual(f.counts(), { registrations: 1, messages: 0 })
  const contacts = await readFile(join(f.root, 'contacts.json'), 'utf8')
  assert.ok(!contacts.includes(token)); assert.ok(contacts.includes('public_visitor'))
  assert.equal(JSON.parse(await readFile(f.credential(), 'utf8')).token, token)
  await f.run(['send', 'public', 'hello']); await f.run(['send', 'alias', 'again', '--context', 'context-1'])
  assert.match((await f.run(['quota', 'public'])).stdout, /3\/5/)
  assert.deepEqual(f.counts(), { registrations: 1, messages: 2 })
}))
test('exhaustion, contact conflicts and missing credentials never trigger a replacement public identity', () => fixture(async f => {
  await f.run(['join', 'public', f.url])
  for (let i = 0; i < 5; i++) await f.run(['send', 'public', 'hello'])
  await assert.rejects(f.run(['send', 'public', 'sixth']), e => /429/.test(e.stderr) && !e.stderr.includes(token))
  await f.run(['join', 'public', f.url])
  await assert.rejects(f.run(['join', 'public', 'https://different.test/a2a']), e => /existing contact was not changed/.test(e.stderr))
  await rm(f.credential())
  await assert.rejects(f.run(['join', 'public', f.url]), e => /missing or unreadable/.test(e.stderr))
  await assert.rejects(f.run(['send', 'public', 'hello']), e => /missing or unreadable/.test(e.stderr))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 5 })
}))
test('failed admission has no automatic retry, starts no chat and cleans up the client lock', () => fixture(async f => {
  f.rejectRegistration()
  await assert.rejects(f.run(['join', 'public', f.url]), e => /503/.test(e.stderr))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 0 })
  assert.deepEqual(await readdir(join(f.root, 'private-credentials')), [])
}))

test('a rejected saved token never causes automatic admission or exposes the credential', () => fixture(async f => {
  await f.run(['join', 'public', f.url])
  const saved = JSON.parse(await readFile(f.credential(), 'utf8'))
  saved.token = 'c'.repeat(64)
  await writeFile(f.credential(), JSON.stringify(saved))
  await assert.rejects(f.run(['send', 'public', 'hello']), e => /401/.test(e.stderr) && !e.stderr.includes(saved.token))
  await f.run(['join', 'public', f.url])
  assert.deepEqual(f.counts(), { registrations: 1, messages: 0 })
}))
test('credential write failure never saves a contact or sends a message', () => fixture(async f => {
  f.blockSave()
  await assert.rejects(f.run(['join', 'public', f.url]), e => !e.stderr.includes(token))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 0 })
  await assert.rejects(readFile(join(f.root, 'contacts.json')), { code: 'ENOENT' })
  assert.ok(!(await readdir(join(f.root, 'private-credentials'))).some(n => n.endsWith('.lock')))
}))

test('normal send follows one explicit challenge, saves its token, continues the original message and reuses the identity', () => fixture(async f => {
  await f.run(['add', 'public', f.url])
  assert.deepEqual(f.counts(), { registrations: 0, messages: 0 })
  const first = await f.run(['send', 'public', 'hello', '--nowait'])
  assert.ok(!(first.stdout + first.stderr).includes(token))
  assert.deepEqual(f.calls.map(c => [c.body.method, c.authorized]), [['SendMessage', false], ['talk2myagent/RegisterPublicVisitor', false], ['SendMessage', true]])
  assert.deepEqual(f.calls[0].body.params, f.calls[2].body.params, 'preserve messageId, original text and returnImmediately')
  assert.deepEqual(f.calls[1].body.params, {}, 'the client cannot choose visitorId')
  await f.run(['add', 'public', f.url]) // Re-importing a public invitation must not erase credentials.
  await f.run(['send', 'public', 'again', '--context', 'context-1'])
  assert.deepEqual(f.counts(), { registrations: 1, messages: 2 })
  assert.equal(f.calls.length, 4)
  assert.ok(!(await readFile(join(f.root, 'contacts.json'), 'utf8')).includes(token))
}))

test('quota exhaustion gives an actionable message and does not change identity', () => fixture(async f => {
  await f.run(['add', 'public', f.url])
  for (let i = 0; i < 5; i++) await f.run(['send', 'public', 'hello'])
  await assert.rejects(f.run(['send', 'public', 'sixth']), e => /PUBLIC_VISITOR_QUOTA_EXHAUSTED/.test(e.stderr) && /5\/5/.test(e.stderr) && /联系这个 Agent 的主人/.test(e.stderr))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 5 })
}))

test('only a correlated pre-execution challenge allows anonymous admission', async () => {
  for (const mode of ['generic-401', 'wrong-id', 'wrong-domain', 'accepted', 'missing-acceptance', 'different-method', 'closed', 'offline', 'busy', 'disconnect']) await fixture(async f => {
    await f.run(['add', 'public', f.url]); f.setMode(mode)
    await assert.rejects(f.run(['send', 'public', 'hello']))
    assert.deepEqual(f.counts(), { registrations: 0, messages: 0 }, mode)
    assert.equal(f.calls.length, 1, mode)
  })
})

test('a second challenge, interrupted registration or lost accepted response never loops or replays', async () => {
  for (const mode of ['challenge-after-token', 'registration-disconnect', 'accepted-disconnect']) await fixture(async f => {
    await f.run(['add', 'public', f.url]); f.setMode(mode)
    await assert.rejects(f.run(['send', 'public', 'hello']))
    assert.deepEqual(f.counts(), { registrations: 1, messages: mode === 'accepted-disconnect' ? 1 : 0 }, mode)
    assert.equal(f.calls.length, mode === 'registration-disconnect' ? 2 : 3, mode)
  })
})

test('failed credential saving blocks continuation after a challenge', () => fixture(async f => {
  await f.run(['add', 'public', f.url]); f.blockSave()
  await assert.rejects(f.run(['send', 'public', 'hello']), e => !e.stderr.includes(token))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 0 })
  assert.equal(f.calls.length, 2)
}))

test('concurrent first sends share one registration and aliases remember existing credentials', () => fixture(async f => {
  await f.run(['add', 'one', f.url]); await f.run(['add', 'two', f.url]); f.setMode('slow-registration')
  await Promise.all([f.run(['send', 'one', 'first']), f.run(['send', 'two', 'second'])])
  assert.deepEqual(f.counts(), { registrations: 1, messages: 2 })
  await f.run(['add', 'alias', f.url]); await f.run(['send', 'alias', 'third'])
  await rm(f.credential())
  await assert.rejects(f.run(['send', 'alias', 'again']), e => /missing or unreadable/.test(e.stderr))
  assert.deepEqual(f.counts(), { registrations: 1, messages: 3 })
}))

test('reading a public card never registers an identity or sends an empty bearer token', () => fixture(async f => {
  await f.run(['add', 'public', f.url])
  assert.match((await f.run(['card', 'public'])).stdout, /Public fixture/)
  assert.deepEqual(f.calls, [{ body: { method: 'GetAgentCard' }, authorized: false }])
  assert.deepEqual(f.counts(), { registrations: 0, messages: 0 })
  await assert.rejects(readFile(f.credential()), { code: 'ENOENT' })
}))

test('continuing an existing context without its credential refuses before network admission', () => fixture(async f => {
  await f.run(['add', 'public', f.url])
  await assert.rejects(f.run(['send', 'public', 'continue', '--context', 'other-visitor-context']), e => /original credential/.test(e.stderr))
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.counts(), { registrations: 0, messages: 0 })
}))

test('reimporting a public invitation preserves an invited identity and never downgrades a missing token to anonymous', () => fixture(async f => {
  const missingEnv = 'A2A_MISSING_TEST_' + process.pid
  assert.equal(process.env[missingEnv], undefined)
  await f.run(['add', 'friend', f.url, missingEnv, 'Invited identity'])
  await f.run(['add', 'friend', f.url])
  const contact = JSON.parse(await readFile(join(f.root, 'contacts.json'), 'utf8')).agents.friend
  assert.equal(contact.token_env, missingEnv)
  assert.equal(contact.note, 'Invited identity')
  await assert.rejects(f.run(['send', 'friend', 'hello']), e => e.stderr.includes(missingEnv))
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.counts(), { registrations: 0, messages: 0 })
}))
