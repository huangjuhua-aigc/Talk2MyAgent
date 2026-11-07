/** Opt-in real-model walkthrough. Requires public-e2e-server.ts; never retries SendMessage. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
const exec = promisify(execFile), cwd = fileURLToPath(new URL('..', import.meta.url))
const out = resolve(process.env.A2A_REAL_REPORT || 'qa-artifacts/public-access-e2e')
const info = JSON.parse(await readFile(join(out, 'info.json'), 'utf8'))
const browse = join(homedir(), '.agents/skills/gstack/browse/dist/browse.exe')
const cli = fileURLToPath(new URL('../../a2a-skill/bin/a2a.mjs', import.meta.url))
const cmd = async (...args) => (await exec(browse, args, { cwd: out, windowsHide: true, timeout: 25000, maxBuffer: 2_000_000 })).stdout
const wait = ms => new Promise(done => setTimeout(done, ms))
const checks = [], chapters = [], frames = [], events = [], secrets = []
const check = (value, message) => { assert.ok(value, message); checks.push(message); console.log('PASS ' + message) }
const safe = text => secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), String(text))
let chapter = '', recording = true, failure, start, rpcUrl, contact
async function event(title, text) {
  events.push({ title, text: safe(text), at: new Date().toISOString() })
  await writeFile(join(out, 'events.json'), JSON.stringify({ chapter, events }, null, 2))
}
async function mark(title) {
  chapter = title; chapters.push({ time: (Date.now() - start) / 1000, title }); console.log(title)
  await event('测试步骤', title); await wait(1300)
}
const { csrfToken } = await (await fetch(info.baseURL + '/api/session')).json()
async function api(path, method = 'GET', body) {
  const r = await fetch(info.baseURL + '/api/agents/' + info.agentId + '/' + path, { method,
    headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const result = await r.json(); assert.ok(r.ok, safe(JSON.stringify(result))); return result
}
async function until(predicate, label, timeout = 240000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await wait(1000) }
  throw new Error('Timed out: ' + label)
}
async function online() {
  const state = await api('status')
  if (state.preparation?.phase === 'error') throw new Error('Agent startup failed: ' + state.preparation.message)
  return (await api('publication/status')).state === 'online'
}
async function run(who, args, extra = {}) {
  try { const result = await exec(process.execPath, [cli, ...args], { cwd,
    env: { ...process.env, A2A_HOME: join(info.root, 'client-' + who), ...extra },
    windowsHide: true, timeout: 45000, maxBuffer: 2_000_000 }); return safe(result.stdout + result.stderr)
  } catch (e) { throw new Error(safe(e.stdout + e.stderr || e.message)) }
}
async function credential(who) {
  const file = join(info.root, 'client-' + who, 'private-credentials', createHash('sha256').update(rpcUrl).digest('hex') + '.json')
  const value = JSON.parse(await readFile(file, 'utf8')); secrets.push(value.token); return value
}
async function send(who, label, message, context, extra) {
  await event(`${who} → Agent`, message)
  const first = await run(who, ['send', contact, message, '--nowait', ...(context ? ['--context', context] : [])], extra)
  const taskId = /\[任务 ([^\]]+)\]/.exec(first)?.[1]
  assert.ok(taskId, first)
  // Save before polling: a failure must be recovered with task, never another send.
  await writeFile(join(out, label + '-task.json'), JSON.stringify({ who, taskId, message, submittedAt: new Date().toISOString() }, null, 2))
  let reply = first
  await until(async () => {
    reply = await run(who, ['task', contact, taskId], extra)
    if (/TASK_STATE_(FAILED|CANCELED|REJECTED)/.test(reply)) throw new Error(reply)
    return reply.includes('TASK_STATE_COMPLETED')
  }, label, 180000)
  await writeFile(join(out, label + '-reply.txt'), reply)
  await event(`Agent → ${who} · 真实模型回复`, reply)
  await wait(2200)
  return { taskId, reply, context: /\[对话 ([^\]]+)\]/.exec(reply)?.[1] }
}
async function rejected(who, message, reason) {
  let error = ''
  try { await run(who, ['send', contact, message, '--nowait']) } catch (e) { error = e.message }
  await event(`${who} · 请求结果`, error || 'Unexpectedly accepted')
  check(error.includes(reason), `${who}: ${reason}，没有重新登记或重发`)
  await event(`${who} · 请求被服务端拒绝`, error); await wait(2500)
}
await mkdir(join(out, 'frames'), { recursive: true })
await cmd('goto', info.baseURL); await cmd('viewport', '1280x960'); await cmd('console', '--clear')
start = Date.now()
const capture = (async () => {
  while (recording) {
    const file = `frames/${String(frames.length).padStart(6, '0')}.png`
    await cmd('screenshot', '--viewport', join(out, file)); frames.push({ file, time: (Date.now() - start) / 1000 }); await wait(300)
  }
})().catch(error => { failure = 'Recording failed: ' + safe(error.message); recording = false })
try {
  await mark('01 · Agent 尚未启动，先获取固定中继地址')
  check(!(await api('status')).running, '分配地址前 Agent 未启动')
  await cmd('click', 'button:text-is("获取中继地址")')
  await until(async () => !!(await api('publication/status')).publicRpcUrl, 'relay reservation')
  const pub = await api('publication/status'); rpcUrl = pub.publicRpcUrl; contact = pub.contactId
  check(rpcUrl.startsWith(info.relay + '/r/') && contact === '13800001105', '本地 Relay 分配用户指定编号')
  check(!(await api('status')).running, '无需启动 Agent 即可获取地址')
  await cmd('scroll', '[aria-label="允许公开访客"]'); await wait(700)
  await cmd('click', '[aria-label="允许公开访客"]')
  await until(async () => (await api('public-visitors')).enabled, 'public access enabled')
  await cmd('click', 'button:text-is("复制公开邀请")'); await wait(1200)
  const invite = await api('publication/invitation', 'POST', { peerName: '__public__' })
  check(invite.text.includes(' send ') && !invite.text.includes(' join ') && !invite.text.includes('Bearer'), '公开邀请直接发消息，不包含访客 Token')
  await cmd('screenshot', '--viewport', join(out, 'public-invitation.png'))
  await mark('02 · 启动真实 Agent：应用访客设置并连接本地中继')
  await cmd('scroll', 'button:text-is("启动")'); await cmd('click', 'button:text-is("启动")')
  await until(online, 'real Agent and connector online')
  check((await api('status')).running, '真实 DSH Agent 已启动')
  await cmd('screenshot', '--viewport', join(out, 'agent-online.png'))
  await cmd('goto', info.consoleURL)
  await mark('03 · Alice 无 Token 直接聊天，自动登记并保存身份')
  await run('alice', ['add', contact, rpcUrl])
  const aliceHello = await send('alice', 'alice-1', '你好，我是 Alice。请实际读取公共资料 verification.txt，回复 READY ALICE 和 Public code。')
  const alice = await credential('alice')
  check(/^public-[a-f0-9]{32}$/.test(alice.visitorId), 'Alice 身份由服务端生成')
  check(!(await readFile(join(info.root, 'client-alice/contacts.json'), 'utf8')).includes(alice.token), '通讯录不包含 Token')
  await event('登记结果（Token 隐藏）', `visitorId: ${alice.visitorId}\n${await run('alice', ['quota', contact])}`)
  const aliceCode = 'ALICE_' + randomBytes(8).toString('hex'), bobCode = 'BOB_' + randomBytes(8).toString('hex')
  async function seed(id, code) {
    // Owner-side fixture setup inside the real VM, not a tool granted to visitors.
    // An already-created private disk intentionally does not import later host edits.
    process.env.MSB_HOME = join(info.sandboxHome, 'state'); process.env.MSB_BACKEND = 'local'
    const sdk = await import(pathToFileURL(join(info.sandboxHome, 'sdk-0.7.11-win32-x64/node_modules/microsandbox/dist/index.js')).href)
    const record = JSON.parse(await readFile(join(info.host, 'workspaces', info.agentId, '.microsandbox', id, 'record.json'), 'utf8'))
    const handle = await sdk.Sandbox.get(record.name)
    if (handle.status === 'paused') await handle.resume()
    const sandbox = await handle.connect()
    const before = await readFile(join(info.publicRoot, 'verification.txt'), 'utf8')
    const python = `import pathlib,os,json
assert os.getuid()==1000
p=pathlib.Path('/source/verification.txt')
denied=[]
for label,fn in [('write',lambda:p.write_text('BAD')),('delete',lambda:p.unlink()),('rename',lambda:p.rename('/source/moved.txt')),('create',lambda:pathlib.Path('/source/new.txt').write_text('BAD'))]:
 try: fn()
 except OSError: denied.append(label)
assert len(denied)==4,denied
p=pathlib.Path('/work/crud.txt');p.write_text('first');p.write_text('updated');assert p.read_text()=='updated';p.unlink();assert not p.exists()
assert not pathlib.Path('/mnt/c/Users').exists()
assert not pathlib.Path('/backend/chat.txt').exists()
assert not os.getenv('DEEPSEEK_API_KEY')
pathlib.Path('/work/private.txt').write_text(${JSON.stringify('Private code: ' + code)})
print(json.dumps({'publicMutationsDenied':denied,'privateCrud':True,'hostFilesAbsent':True,'modelKeyAbsent':True}))`
    const execution = await sandbox.execStreamWith('python3', b => b.args(['-I', '-c', python]).user('1000:1000').timeout(10000))
    let output = '', exitCode
    for await (const e of execution) { if (e.kind === 'stdout' || e.kind === 'stderr') output += Buffer.from(e.data).toString(); if (e.kind === 'exited') exitCode = e.code }
    assert.equal(exitCode, 0, output); assert.equal(await readFile(join(info.publicRoot, 'verification.txt'), 'utf8'), before)
    check(true, '真实 Python：公共资料禁止改写/删除/重命名，私有工作区支持增改删，宿主资料未改变')
    await event('Microsandbox 隔离探针（测试专用）', output)
    await writeFile(join(out, id + '-isolation.json'), JSON.stringify({ visitorId: id, ...JSON.parse(output), hostPublicUnchanged: true }, null, 2))
  }
  await seed(alice.visitorId, aliceCode)
  await mark('04 · 真实 read_file：公共资料和 Alice 私有文件')
  const aliceRead = await send('alice', 'alice-2', '请实际调用 read_file 读取公共资料 verification.txt，以及我自己的私有工作区 private.txt。原样返回两个 code，并计算公共文件里的算式。请勿猜测。')
  check(aliceRead.reply.includes(info.canary) && aliceRead.reply.includes(aliceCode) && aliceRead.reply.includes('630'), '真实模型读取随机公共码、Alice 私有码并计算 630')
  await mark('05 · Bob 独立身份和沙箱，不能读取 Alice 数据')
  await run('bob', ['add', contact, rpcUrl])
  await send('bob', 'bob-1', '你好，我是 Bob。请实际读取公共资料 verification.txt，回复 READY BOB 和 Public code。')
  const bob = await credential('bob'); check(bob.visitorId !== alice.visitorId, 'Bob 与 Alice 身份不同')
  await seed(bob.visitorId, bobCode)
  const bobRead = await send('bob', 'bob-2', `请实际调用 read_file 读取公共资料 verification.txt 和我自己的私有工作区 private.txt，返回两个 code。再尝试读取私有工作区 ../${alice.visitorId}/private.txt，报告错误即可，不要绕过限制。`)
  check(bobRead.reply.includes(info.canary) && bobRead.reply.includes(bobCode) && !bobRead.reply.includes(aliceCode), 'Bob 仅得到公共和自己的私有码，没有泄漏 Alice 文件')
  const cross = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0', authorization: 'Bearer ' + bob.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 'cross-owner', method: 'GetTask', params: { id: aliceRead.taskId } }) })
  const crossBody = await cross.json(); check(!!crossBody.error && !JSON.stringify(crossBody).includes(aliceCode), 'Bob 无法查询 Alice 的任务记录')
  await event('隔离断言', '公共资料可读；自己的私有文件可读；跨访客路径和任务均被拒绝。')
  await mark('06 · 第 5 次后额度归零，第 6 次明确提示联系主人')
  await send('alice', 'alice-3', '请只回复：第三轮已收到。', aliceHello.context)
  await send('alice', 'alice-4', '请只回复：第四轮已收到。')
  await send('alice', 'alice-5', '请只回复：第五轮已收到。')
  await rejected('alice', '这是第六次，应该被拒绝。', 'PUBLIC_VISITOR_QUOTA_EXHAUSTED')
  check((await run('alice', ['quota', contact])).includes('0/5'), '更换对话也不重置累计额度')
  check((await credential('alice')).visitorId === alice.visitorId, '额度用完仍保留原身份')
  await cmd('screenshot', '--viewport', join(out, 'quota-exhausted.png'))
  await mark('07 · 关闭公开访问实时生效，受邀访客仍然可用')
  await cmd('goto', info.baseURL); await cmd('scroll', '[aria-label="允许公开访客"]')
  await cmd('click', '[aria-label="允许公开访客"]')
  await until(async () => !(await api('public-visitors')).enabled, 'disable public access')
  await wait(1800); await cmd('goto', info.consoleURL)
  await rejected('bob', '关闭后的公开请求。', 'HTTP 403')
  check((await credential('bob')).visitorId === bob.visitorId, '关闭公开模式后 Bob 没有换身份')
  await run('charlie', ['add', contact, rpcUrl]); await rejected('charlie', '关闭后新访客请求。', 'rejected (401)')
  const charlieFile = join(info.root, 'client-charlie/private-credentials', createHash('sha256').update(rpcUrl).digest('hex') + '.json')
  await assert.rejects(readFile(charlieFile), { code: 'ENOENT' }); check(true, '关闭后新访客未创建身份凭据')
  const record = JSON.parse(await readFile(join(info.host, 'agents', info.agentId + '.json'), 'utf8'))
  const invitedToken = record.config.peers.find(p => p.name === 'invited').token; secrets.push(invitedToken)
  await run('invited', ['add', contact, rpcUrl, 'A2A_E2E_INVITED'])
  const invitedReply = await send('invited', 'invited-1', '请只回复：受邀访客仍可访问。', undefined, { A2A_E2E_INVITED: invitedToken })
  check(invitedReply.reply.includes('受邀访客'), '关闭公开模式不影响已授权访客')
  await mark('08 · 重新开启并重启 Agent：地址、额度和私有文件保留')
  await cmd('goto', info.baseURL); await cmd('scroll', '[aria-label="允许公开访客"]'); await cmd('click', '[aria-label="允许公开访客"]')
  await until(async () => (await api('public-visitors')).enabled, 're-enable public access')
  await cmd('scroll', 'button:text-is("停止")'); await cmd('click', 'button:text-is("停止")')
  await until(async () => !(await api('status')).running, 'stop Agent')
  await until(async () => (await cmd('is', 'enabled', 'button:text-is("启动")')).trim() === 'true', 'start enabled')
  await cmd('click', 'button:text-is("启动")')
  await until(online, 'restart online')
  check((await api('publication/status')).publicRpcUrl === rpcUrl, 'Agent 重启后中继地址不变')
  check((await run('alice', ['quota', contact])).includes('0/5'), 'Agent 重启后已耗尽额度不重置')
  await cmd('goto', info.consoleURL)
  const bobRestart = await send('bob', 'bob-3-restart', '请实际读取我自己的私有工作区 private.txt，原样返回其中的 code。')
  check(bobRestart.reply.includes(bobCode) && !bobRestart.reply.includes(aliceCode), 'Agent 重启后 Bob 私有磁盘保留且隔离')
  check((await credential('bob')).visitorId === bob.visitorId, 'Bob 跨进程和重启复用原身份')
  await event('通过的端到端检查', checks.join('\n'))
  await wait(4000); await cmd('screenshot', '--viewport', join(out, 'completed.png'))
  await cmd('goto', info.baseURL); await cmd('scroll', '[aria-label="来访记录"]'); await wait(1500)
  await cmd('screenshot', '--viewport', join(out, 'portal-records.png'))
  await mark('09 · 手机宽度检查和测试结束')
  await cmd('viewport', '390x844'); await cmd('js', 'window.scrollTo(0,0)')
  check((await cmd('js', 'document.documentElement.scrollWidth <= window.innerWidth')).trim() === 'true', '手机宽度无横向溢出')
  await cmd('screenshot', '--viewport', join(out, 'mobile.png')); await wait(2500)
  await cmd('viewport', '1280x960'); await cmd('goto', info.consoleURL); await wait(2500)
} catch (e) { failure = safe(e.message); console.error(failure); await event('测试中断（不会自动重发消息）', failure); await wait(2000) }
finally {
  recording = false; await capture
  const duration = (Date.now() - start) / 1000
  await writeFile(join(out, 'frames.ffconcat'), 'ffconcat version 1.0\n' + frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(.04, (frames[i + 1]?.time ?? duration) - f.time).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`)
  await writeFile(join(out, 'walkthrough.json'), JSON.stringify({ model: info.model, checks, chapters, duration, frames: frames.length, failure }, null, 2))
  console.log(JSON.stringify({ checks: checks.length, duration, frames: frames.length, failure }))
}
if (failure) process.exitCode = 1
