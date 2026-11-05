/** Opt-in, isolated real-model E2E environment. Secrets never enter the report. */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import YAML from 'yaml'

if (process.env['A2A_REAL_E2E'] !== '1') throw new Error('Set A2A_REAL_E2E=1 to authorize real model calls in an isolated environment')
const out = resolve(process.env['A2A_REAL_REPORT'] || 'qa-artifacts/public-access-e2e')
const plugin = process.env['A2A_PLUGIN_SOURCE'], relaySource = process.env['A2A_RELAY_SOURCE']
if (!plugin || !relaySource || !process.env['A2A_SANDBOX_HOME']) throw new Error('Set A2A_PLUGIN_SOURCE, A2A_RELAY_SOURCE and A2A_SANDBOX_HOME')
const key = process.env['DEEPSEEK_API_KEY'] || YAML.parse(await readFile(join(homedir(), '.dsh/.credentials.yaml'), 'utf8')).refs?.DEEPSEEK_API_KEY
if (typeof key !== 'string' || !key) throw new Error('DeepSeek credential is not configured')
const root = await realpath(await mkdtemp(join(tmpdir(), 'a2a-public-real-')))
const publicRoot = join(root, 'public'), host = join(root, 'host'), dsh = join(root, 'dsh')
await mkdir(out, { recursive: true }); await mkdir(join(publicRoot, '.hop'), { recursive: true })
const canary = `PUBLIC_${randomBytes(8).toString('hex')}`
await writeFile(join(publicRoot, 'verification.txt'), `Public code: ${canary}\nCalculation: 73 * 9 - 27\n`)
await writeFile(join(publicRoot, '.hop/handoff.md'), '这是隔离的端到端测试 Agent。请简短回复，文件内容必须实际读取，不猜测。')
const freePort = async (port = 0) => {
  const server = createServer(); await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>(done => server.close(() => done())); return address.port
}
const requestedPort = Number(process.env['A2A_REAL_AGENT_PORT'] || 0)
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid A2A_REAL_AGENT_PORT')
const relayPort = await freePort(), agentPort = await freePort(requestedPort), relayOrigin = `http://127.0.0.1:${relayPort}`
const { createRelay } = await import(pathToFileURL(join(relaySource, 'src/server.mjs')).href)
const relay = createRelay({ origin: relayOrigin, allowHttp: true })
await new Promise<void>(done => relay.server.listen(relayPort, '127.0.0.1', done))
Object.assign(process.env, { DEEPSEEK_API_KEY: key, DSH_HOME: dsh, A2A_HOST_HOME: host,
  A2A_HOST_PORT: '0', A2A_RELAY_DEFAULT_HOST: relayOrigin, A2A_RELAY_ALLOW_LOOPBACK_HTTP: '1' })
const { serve } = await import('../src/server.ts')
const port = await serve(), baseURL = `http://127.0.0.1:${port}`
const { csrfToken } = await (await fetch(baseURL + '/api/session')).json() as any
const api = async (path: string, method: string, body: unknown) => {
  const response = await fetch(baseURL + '/api/' + path, { method, headers: { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Setup failed: ${path} HTTP ${response.status}`)
  return await response.json() as any
}
const created = await api('agents', 'POST', {
  card: { name: 'Public Access E2E ' + randomBytes(4).toString('hex'), description: '真实 DeepSeek + Microsandbox + 本地中继；仅合成测试资料。' },
  models: [{ provider: 'deepseek', model: 'deepseek-flash' }], activeModelIndex: 0,
  peers: [{ name: 'invited', displayName: '已授权访客', token: randomBytes(32).toString('hex'), trusted: true }],
  adminToken: randomBytes(32).toString('hex'), isolation: { workspaceRoot: publicRoot, peerWorkspaces: {} },
  network: { mode: 'relay', port: agentPort, relay: { provider: 'default', enabled: false, contactId: '13800001105' } },
})
const agentId = created.record.id
await api(`agents/${agentId}/briefing-auto`, 'PUT', { enabled: false })
await writeFile(join(out, 'events.json'), JSON.stringify({ chapter: '准备本地端到端测试', events: [] }))
const consoleServer = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store')
  if (req.url === '/events') { res.setHeader('content-type', 'application/json'); res.end(await readFile(join(out, 'events.json'))); return }
  if (req.url !== '/') { res.writeHead(404); res.end(); return }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>A2A 端到端测试观察台</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f7fc;color:#17233c;font:17px/1.65 'Microsoft YaHei',sans-serif}header{padding:22px 36px;background:white;border-bottom:1px solid #dde4f1}h1{font-size:24px;margin:0}p{margin:4px 0;color:#60708a}.label{font-size:14px;color:#4256dc}main{padding:24px 36px}h2{margin:0 0 18px;font-size:23px}.event{background:white;border:1px solid #dde4f1;border-radius:12px;padding:18px 22px;margin-bottom:16px}.event strong{color:#3153cb}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.65 Consolas,'Microsoft YaHei',monospace;margin:8px 0 0}.meta{font-size:13px;color:#7a889f}</style>
  <header><div class="label">本地测试观察台 · 非产品聊天入口</div><h1>真实 Agent 的匿名接入与访客隔离</h1><p>DeepSeek Flash · 本地 Relay · 独立 Microsandbox · 实际 CLI 输出 · Token 隐藏</p></header>
  <main><h2 id="chapter"></h2><div id="events"></div></main><script>
  let last='';async function update(){try{const data=await(await fetch('/events')).json();document.querySelector('#chapter').textContent=data.chapter;const key=JSON.stringify(data.events);if(key!==last){last=key;const box=document.querySelector('#events');box.replaceChildren();for(const event of data.events.slice(-3).reverse()){const card=document.createElement('div');card.className='event';const title=document.createElement('strong');title.textContent=event.title;const pre=document.createElement('pre');pre.textContent=event.text;const meta=document.createElement('div');meta.className='meta';meta.textContent=event.at;card.append(title,pre,meta);box.append(card)}}}catch{}}update();setInterval(update,500);
  </script></html>`)
})
await new Promise<void>(done => consoleServer.listen(0, '127.0.0.1', done))
const consoleAddress = consoleServer.address(); if (!consoleAddress || typeof consoleAddress === 'string') throw new Error('No console port')
const info = { root, publicRoot, host, dsh, agentId, baseURL, agentPort, relay: relayOrigin,
  consoleURL: `http://127.0.0.1:${consoleAddress.port}`, model: 'deepseek-flash', sandboxHome: process.env['A2A_SANDBOX_HOME'], canary, pid: process.pid }
await writeFile(join(out, 'info.json'), JSON.stringify(info, null, 2))
console.log(JSON.stringify({ ready: true, agentId, baseURL, relay: relayOrigin, consoleURL: info.consoleURL, report: out }))
