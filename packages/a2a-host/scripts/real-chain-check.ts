/** Real Portal + DSH + native Microsandbox + local Relay. Run stages explicitly; no resend retries. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const out = process.env['A2A_REAL_REPORT'] ?? 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain'
const info = JSON.parse(await readFile(join(out, 'info.json'), 'utf8'))
const { csrfToken } = await (await fetch(info.baseURL + '/api/session')).json() as any
async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(info.baseURL + '/api/' + path, { method,
    headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: r.status, body: await r.json() as any }
}
const stage = process.argv[2]
if (stage === 'setup') {
  const canaries = Object.fromEntries(['public', 'alice', 'bob'].map(k => [k, `${k}-${randomBytes(12).toString('hex')}`]))
  await writeFile(join(info.publicRoot, 'verification.txt'), `Public verification: ${canaries.public}\nCalculate 72 * 9 - 30.\n`)
  const config = {
    card: { name: 'Real Microsandbox Agent', description: '真实 DeepSeek 模型，通过本地中继验证访客沙箱隔离。' },
    models: [{ provider: 'deepseek', model: 'deepseek-flash' }], activeModelIndex: 0,
    peers: ['alice', 'bob'].map(name => ({ name, token: randomBytes(32).toString('hex'), trusted: true })),
    adminToken: randomBytes(32).toString('hex'), isolation: { workspaceRoot: info.publicRoot, peerWorkspaces: {} },
    network: { mode: 'relay', relay: { provider: 'default', enabled: true }, port: 3080 },
  }
  const created = await api('agents', 'POST', config)
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const record = created.body.record
  assert(record?.id)
  info.agentId = record.id
  await writeFile(join(out, 'info.json'), JSON.stringify(info, null, 2))
  for (const peer of ['alice', 'bob']) {
    const dir = join(info.host, 'workspaces', record.id, peer)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'private.txt'), `Private verification for ${peer}: ${canaries[peer]}\n`)
  }
  await writeFile(join(out, 'canaries.json'), JSON.stringify(canaries, null, 2))
  const brief = await api(`agents/${info.agentId}/briefing-auto`, 'PUT', { enabled: false })
  assert.equal(brief.status, 200)
  const early = await api(`agents/${info.agentId}/publication/enabled`, 'PUT', { enabled: true })
  assert(early.status >= 400)
  const invitation = await api(`agents/${info.agentId}/publication/invitation`, 'POST', { peerName: 'alice' })
  assert(invitation.status >= 400)
  await writeFile(join(out, 'ordering.json'), JSON.stringify({ beforeStart: { publish: early, invitation } }, null, 2))
  console.log(JSON.stringify({ agentId: info.agentId, earlyPublish: early, earlyInvitation: invitation }))
} else if (stage === 'start') {
  console.log(JSON.stringify(await api(`agents/${info.agentId}/start`, 'POST')))
} else if (stage === 'stop') {
  console.log(JSON.stringify(await api(`agents/${info.agentId}/stop`, 'POST')))
} else if (stage === 'status') {
  for (const sub of ['status', 'publication/status']) console.log(sub, JSON.stringify(await api(`agents/${info.agentId}/${sub}`)))
} else if (stage === 'send' || stage === 'task' || stage === 'connect') {
  const peer = process.argv[3] || 'alice'
  assert(['alice', 'bob'].includes(peer))
  const record = JSON.parse(await readFile(join(info.host, 'agents', info.agentId + '.json'), 'utf8'))
  const pub = (await api(`agents/${info.agentId}/publication/status`)).body
  assert.equal(pub.state, 'online')
  const envName = 'A2A_PEER_REAL_' + peer.toUpperCase()
  const env = { ...process.env, A2A_HOME: join(info.root, 'client'), [envName]: record.config.peers.find((p: any) => p.name === peer).token }
  const cli = join(process.env['USERPROFILE']!, '.agents', 'skills', 'a2a', 'bin', 'a2a.mjs')
  function call(args: string[]) {
    const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 100_000, windowsHide: true })
    const text = r.stdout + r.stderr
    console.log(text)
    if (r.status !== 0) throw new Error(`A2A CLI failed (${r.status}); do not resend an uncertain request`)
    return text
  }
  if (stage === 'connect') {
    call(['list'])
    call(['add', peer, pub.publicRpcUrl, envName, 'Real isolated model test', '--card-url', pub.publicCardUrl])
    call(['card', peer])
    await writeFile(join(out, 'publication.json'), JSON.stringify({ state: pub.state, publicRpcUrl: pub.publicRpcUrl, publicCardUrl: pub.publicCardUrl }, null, 2))
    const invite = await api(`agents/${info.agentId}/publication/invitation`, 'POST', { peerName: peer })
    assert.equal(invite.status, 200)
    console.log('Online invitation available (credential-bearing text omitted).')
  } else if (stage === 'send') {
    const label = process.argv[4] || peer
    const message = `你正在参与真实链路测试。我是访客 ${peer}。请实际调用 read_file，读取公共资料中的 verification.txt，以及我自己的私有工作区中的 private.txt。原样返回两个文件里的 verification 校验码，并计算公共文件要求的算式。不要猜测内容，不要用其他工具。最后实际尝试读取我私有工作区的 ../${peer === 'alice' ? 'bob' : 'alice'}/private.txt，报告越界访问的工具错误，不要尝试绕过。` + (label === 'alice-restart' ? '这次 Agent 已重启，请另外读取自己私有工作区的 generated.txt，完整返回内容，以验证沙箱生成的文件在重启后仍存在。' : '')
    // One submission only. Persist task ID before any polling.
    const response = call(['send', peer, message, '--nowait'])
    const taskId = /\[任务 ([^\]]+)\]/.exec(response)?.[1]
    assert(taskId, response)
    await writeFile(join(out, `${label}-task.json`), JSON.stringify({ peer, taskId, submittedAt: new Date().toISOString(), message }, null, 2))
  } else {
    const label = process.argv[4] || peer
    const task = JSON.parse(await readFile(join(out, `${label}-task.json`), 'utf8'))
    const response = call(['task', peer, task.taskId])
    await writeFile(join(out, `${label}-reply.txt`), response)
    if (response.includes('TASK_STATE_COMPLETED')) {
      const c = JSON.parse(await readFile(join(out, 'canaries.json'), 'utf8'))
      assert(response.includes(c.public), 'Missing public-file random canary')
      assert(response.includes(c[peer]), 'Missing private-file random canary')
      assert(!response.includes(c[peer === 'alice' ? 'bob' : 'alice']), 'Leaked other visitor canary')
      assert(response.includes('618'), 'Wrong arithmetic')
      if (label === 'alice-restart') assert(response.includes('generated inside the real Alice sandbox; persisted on its owned disk'), 'Generated sandbox file lost across restart')
      console.log('PASS: real file canaries, arithmetic, no other visitor canary')
    }
  }
} else throw new Error('Use setup/start/status/connect/send/task')
