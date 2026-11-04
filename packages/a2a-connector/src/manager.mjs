import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, realpath, rename, unlink, rmdir } from 'node:fs/promises'
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path'
import { request } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const pipePath = dir => process.platform === 'win32' ? `\\\\.\\pipe\\a2a-connector-${createHash('sha256').update(resolve(dir).toLowerCase()).digest('hex').slice(0,32)}` : join(resolve(dir), 'control.sock')
async function canonical(path) {
  try { return await realpath(path) } catch (e) { if (e.code !== 'ENOENT') throw e; const parent = dirname(path); if (parent === path) throw e; return join(await canonical(parent), path.slice(parent.length)) }
}
export async function assertPrivateDirectory(stateDir, roots) {
  const state = await canonical(resolve(stateDir))
  for (const root of roots) {
    const full = await canonical(resolve(root)), rel = relative(full, state), inverse = relative(state, full)
    const inside = value => value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
    if (inside(rel) || inside(inverse)) {
      throw new Error('Connector 凭据目录与访客工作目录重叠，请选择独立的工作目录')
    }
  }
}
async function credentials(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'control.json')
  try { await writeFile(path, JSON.stringify({ token: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  return JSON.parse(await readFile(path, 'utf8'))
}
export async function command(dir, action, data = {}) {
  const secret = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8'))
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, ...data })
    const req = request({ socketPath: pipePath(dir), path: '/', method: 'POST', timeout: 12000,
      headers: { authorization: `Bearer ${secret.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; if (text.length > 65536) res.destroy(new Error('IPC response too large')) })
      res.on('error', reject); res.on('end', () => {
        try { const result = JSON.parse(text); if (res.statusCode !== 200) throw new Error(result.error); resolve(result) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Connector IPC timeout'))); req.end(body)
  })
}
export async function ensureDaemon(dir) {
  dir = resolve(dir); await credentials(dir)
  try { return await command(dir, 'status') } catch (e) { if (!['ECONNREFUSED','ENOENT'].includes(e.code)) throw e }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./daemon.mjs', import.meta.url)), dir], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }); child.on('error', () => {}); child.unref()
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 100))
    try { return await command(dir, 'status') } catch (e) { if (!['ECONNREFUSED','ENOENT'].includes(e.code)) throw e }
  }
  throw new Error('Connector did not start; check Node version and private state directory')
}
export async function configure(dir, config) { await ensureDaemon(dir); return await command(dir, 'configure', { config }) }
export async function setEnabled(dir, enabled) { await ensureDaemon(dir); return await command(dir, 'enable', { enabled }) }
export async function register(dir) { await ensureDaemon(dir); return await command(dir, 'register') }
export async function status(dir) {
  try { return await command(dir, 'status') } catch (e) {
    if (!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e
    try { const s = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')); return { ...s.registrations?.[s.config?.relayOrigin]?.info, state: 'stopped', desiredEnabled: s.desiredEnabled,
      cloudSyncPending: s.cloudSyncPending, relayOrigin: s.config?.relayOrigin, error: s.desiredEnabled ? 'Connector 未运行，开启发布可恢复' : undefined } } catch (e) { if (e.code !== 'ENOENT') throw e }
    return { state: 'unregistered', desiredEnabled: false, cloudSyncPending: false }
  }
}
/**
 * Forget the relay device identity so the next publish registers from scratch.
 * Works whether or not the daemon is running; refuses while publishing is enabled.
 */
export async function resetIdentity(dir) {
  dir = resolve(dir)
  try { return await command(dir, 'reset') } catch (e) { if (!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e }
  // No socket does not prove no daemon: one may hold daemon.lock and be loading state.
  // Take the daemon lock ourselves so a starting daemon and concurrent resets serialize.
  const empty = { state: 'unregistered', desiredEnabled: false, cloudSyncPending: false }
  try { await readFile(join(dir, 'state.json')) } catch (e) { if (e.code === 'ENOENT') return empty; throw e } // never published: nothing to forget
  const release = await lockOffline(dir)
  try {
    const path = join(dir, 'state.json')
    let saved
    try { saved = JSON.parse(await readFile(path, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return { state: 'unregistered', desiredEnabled: false, cloudSyncPending: false }; throw e }
    if (saved.desiredEnabled) throw new Error('请先关闭发布，再重置 Relay 身份')
    const next = { ...saved, registrations: {}, cloudSyncPending: false, revision: 0, operationId: randomUUID() }
    const tmp = join(dir, `state.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 }); await rename(tmp, path)
    return { state: 'unregistered', desiredEnabled: false, cloudSyncPending: false, relayOrigin: next.config?.relayOrigin }
  } finally { await release() }
}
const BUSY = 'Connector 正在启动或被占用，请稍后再重置'
async function lockOffline(dir) {
  const lock = join(dir, 'daemon.lock'), instanceId = randomUUID()
  const take = () => writeFile(lock, JSON.stringify({ pid: process.pid, instanceId }), { flag: 'wx', mode: 0o600 })
  try { await take() } catch (e) {
    if (e.code !== 'EEXIST') throw e
    // Same stale-lock recovery protocol as the daemon.
    const recovery = join(dir, 'lock-recovery')
    try { await mkdir(recovery, { mode: 0o700 }) } catch (err) { if (err.code === 'EEXIST') throw new Error(BUSY); throw err }
    try {
      let previous
      try { previous = JSON.parse(await readFile(lock, 'utf8')) } catch { throw new Error(BUSY) }
      try { process.kill(previous.pid, 0); throw new Error(BUSY) } catch (err) { if (err.code !== 'ESRCH') throw err.message === BUSY ? err : new Error(BUSY) }
      await unlink(lock); await take()
    } finally { await rmdir(recovery) }
  }
  return async () => { try { if (JSON.parse(await readFile(lock, 'utf8')).instanceId === instanceId) await unlink(lock) } catch {} }
}
