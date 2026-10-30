import { createServer } from 'node:http'
import { readFile, writeFile, rename, unlink, chmod, mkdir, rmdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Connector, localTarget } from './connector.mjs'
import { pipePath } from './manager.mjs'
import { originOf, readLimited } from '@talk2myagent/a2a-relay-protocol'

const dir = resolve(process.argv[2]), lock = join(dir, 'daemon.lock'), instanceId = randomUUID()
try {
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, instanceId }), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    // Serialize stale-file recovery as well as normal startup. In particular, two
    // Unix contenders must never unlink a newly listening process's socket.
    const recovery = join(dir, 'lock-recovery')
    await mkdir(recovery, { mode: 0o700 })
    try {
      const previous = JSON.parse(await readFile(lock, 'utf8'))
      try { process.kill(previous.pid, 0); throw new Error('Daemon owner still alive') } catch (e) { if (e.code !== 'ESRCH') throw e }
      await unlink(lock)
      await writeFile(lock, JSON.stringify({ pid: process.pid, instanceId }), { flag: 'wx', mode: 0o600 })
    } finally { await rmdir(recovery) }
  }
} catch { process.exit(1) }
const token = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8')).token
let state = { registrations: {}, desiredEnabled: false, revision: 0, operationId: randomUUID(), cloudSyncPending: false }
try { state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
let connector, current = { state: 'stopped' }, writes = Promise.resolve(), commands = Promise.resolve(), stopping = false
function save() {
  const text = JSON.stringify(state)
  writes = writes.then(async () => { const tmp = join(dir, 'state.tmp'); await writeFile(tmp, text, { mode: 0o600 }); await rename(tmp, join(dir, 'state.json')) })
  return writes
}
const snapshot = () => ({ ...current, instanceId, desiredEnabled: state.desiredEnabled, cloudSyncPending: state.cloudSyncPending,
  relayOrigin: state.config?.relayOrigin, localRpcUrl: state.config?.localRpcUrl, localCardUrl: state.config?.localCardUrl })
function start() {
  connector?.stop()
  connector = new Connector({ config: state.config, state, save, onStatus: value => { current = value } })
  void connector.start()
}
async function enable(enabled) {
  if (!state.config) {
    if (enabled) throw new Error('Configure Relay first')
    state.desiredEnabled = false; current = { state: 'stopped' }; return
  }
  // Every explicit click gets a revision, including retry after uncertain delivery.
  state.desiredEnabled = enabled; state.revision++; state.operationId = randomUUID(); state.cloudSyncPending = true
  if (!enabled) { connector?.stop(); current = { state: 'stopped' } }
  await save()
  if (enabled) start()
  else {
    connector?.stop(); current = { state: 'stopped' }
    connector ??= new Connector({ config: state.config, state, save })
    try { await connector.syncIntent() } catch { /* Local forwarding is already stopped. Retry on next launch. */ }
  }
}
async function action(body) {
  if (body.action === 'status') return snapshot()
  if (body.action === 'configure') {
    const c = body.config
    if (!c || typeof c.displayName !== 'string' || c.displayName.length > 128) throw new Error('Invalid connector configuration')
    const config = { relayOrigin: originOf(c.relayOrigin, c.allowHttp === true), localRpcUrl: localTarget(c.localRpcUrl),
      localCardUrl: localTarget(c.localCardUrl), displayName: c.displayName, allowHttp: c.allowHttp === true }
    if (new URL(config.localRpcUrl).origin !== new URL(config.localCardUrl).origin) throw new Error('Local RPC and Agent Card must use the same origin')
    if (state.desiredEnabled) {
      if (JSON.stringify(config) === JSON.stringify(state.config)) return snapshot()
      throw new Error('请先关闭发布，再修改 Relay 或本地地址')
    }
    state.config = config
    connector = undefined; current = { state: 'stopped' }; await save(); return snapshot()
  }
  if (body.action === 'enable' && typeof body.enabled === 'boolean') { await enable(body.enabled); return snapshot() }
  if (body.action === 'shutdown') {
    if (state.config) await enable(false)
    stopping = true; setImmediate(() => { void shutdown() }); return snapshot()
  }
  throw new Error('Unknown connector command')
}
const server = createServer((req, res) => {
  const provided = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { res.writeHead(401); res.end('{}'); return }
  void readLimited(req, 16384).then(bytes => {
    const body = JSON.parse(bytes.toString())
    // Status stays responsive even when cloud disable is pending.
    if (body.action === 'status') return snapshot()
    const result = commands.then(() => { if (stopping) throw new Error('Stopping'); return action(body) })
    commands = result.catch(() => {}); return result
  }).then(result => { res.setHeader('content-type','application/json'); res.end(JSON.stringify(result)) }, error => { res.writeHead(400); res.end(JSON.stringify({ error: error.message })) })
})
const socket = pipePath(dir)
if (process.platform !== 'win32') { try { await unlink(socket) } catch (e) { if (e.code !== 'ENOENT') throw e } }
await new Promise((done, reject) => { server.once('error', reject); server.listen(socket, done) })
if (process.platform !== 'win32') await chmod(socket, 0o600)
if (state.config && state.desiredEnabled) start()
else if (state.config && state.cloudSyncPending) { connector = new Connector({ config: state.config, state, save }); void connector.syncIntent().catch(() => {}) }
async function shutdown() {
  connector?.stop(); await writes
  server.closeAllConnections(); await new Promise(r => server.close(r))
  try { if (JSON.parse(await readFile(lock, 'utf8')).instanceId === instanceId) await unlink(lock) } catch {}
  process.exit(0)
}
for (const s of ['SIGINT','SIGTERM']) process.on(s, () => { void shutdown() })
