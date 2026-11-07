import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { visitorExecution } from './visitor-execution.ts'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { assertPrivateDirectory, configure, register, resetIdentity, setEnabled, status, type PublicationStatus } from '@talk2myagent/a2a-connector'
import { hostHome, dshHome, agentManagementPath } from './paths.ts'
import { managementRequest } from './monitor.ts'
import { listAgents, type AgentRecord } from './files.ts'
import { resolveBindHost } from './url.ts'
import { visitorInstruction, publicVisitorInstruction } from './invitation.ts'
import { publicVisitorsEnabled } from './public-visitors.ts'
import type { PeerEntry, WizardConfig } from './types.ts'
import { derivedPublicUrl } from './url.ts'
import { isContactId } from './contact-id.ts'

const safeId = (id: string): string => { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid agent ID'); return id }
export const publicationDir = (id: string): string => join(hostHome(), 'relay', safeId(id))
export const defaultRelayHost = (): string => process.env['A2A_RELAY_DEFAULT_HOST'] ?? 'https://relay.creez.cn'
export async function validateSharedRoots(config: WizardConfig): Promise<void> {
  if (config.network.mode === 'relay' && config.network.relay?.contactId !== undefined && !isContactId(config.network.relay.contactId)) throw new Error('请填写有效的 11 位手机号作为公开编号')
  const roots = [config.isolation.workspaceRoot, ...Object.values(config.isolation.peerWorkspaces)]
  if (roots.some(root => !root)) throw new Error('工作目录不能为空')
  await assertPrivateDirectory(hostHome(), roots)
  await assertPrivateDirectory(dshHome(), roots)
}
// Default keeps the historical id so existing applied runtimes stay valid;
// the read-only opt-out gets its own id so switching modes requires a restart.
const visitorRuntimeId = (): string => visitorExecution() === 'read-only' ? 'read-only-v1' : 'microsandbox-0.4-v1'
const fingerprint = (config: WizardConfig): string => createHash('sha256').update(JSON.stringify({ visitorRuntime: visitorRuntimeId(), peers: config.peers, isolation: config.isolation })).digest('hex')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const accessFingerprint = (config: WizardConfig) => digest({ visitorRuntime: visitorRuntimeId(), isolation: config.isolation })
const peerFingerprint = (peer: PeerEntry) => digest({ name: peer.name, token: peer.token, trusted: peer.trusted })
interface Runtime { host: string; port: number; fingerprint: string; accessFingerprint?: string; peers?: Record<string,string> }
const runtimePath = (id: string): string => join(publicationDir(id), 'applied.json')
export async function recordRuntime(record: AgentRecord, bind: { host: string; port: number }): Promise<void> {
  await validateSharedRoots(record.config)
  await mkdir(publicationDir(record.id), { recursive: true, mode: 0o700 })
  await writeFile(runtimePath(record.id), JSON.stringify({ ...bind, fingerprint: fingerprint(record.config),
    accessFingerprint: accessFingerprint(record.config), peers: Object.fromEntries(record.config.peers.map(p => [p.name, peerFingerprint(p)])) }), { mode: 0o600 })
}
async function runtime(record: AgentRecord): Promise<Runtime | undefined> {
  try { return JSON.parse(await readFile(runtimePath(record.id), 'utf8')) as Runtime } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return undefined }
}
export async function publicationStatus(id: string): Promise<PublicationStatus> { return await status(publicationDir(id)) }
/** Forget the relay device identity; the next publish gets a new public address. */
export async function resetPublicationIdentity(id: string): Promise<PublicationStatus> {
  await stopPublication(id)
  return await resetIdentity(publicationDir(id))
}
export async function appliedVisitors(record: AgentRecord): Promise<string[]> {
  const active = await runtime(record)
  if (!active) return []
  if (active.peers && active.accessFingerprint === accessFingerprint(record.config)) {
    return record.config.peers.filter(p => active.peers![p.name] === peerFingerprint(p)).map(p => p.name)
  }
  return active.fingerprint === fingerprint(record.config) ? record.config.peers.map(p => p.name) : []
}
/** A saved addition becomes applied only after the running Agent acknowledges it over local IPC. */
export async function applyVisitorLive(record: AgentRecord, peer: PeerEntry): Promise<boolean> {
  const active = await runtime(record)
  if (!active?.peers || active.accessFingerprint !== accessFingerprint(record.config)) return false
  // An additive acknowledgement must never bless unrelated, unapplied revocations or token changes.
  const existing = record.config.peers.filter(p => p.name !== peer.name)
  if (Object.keys(active.peers).length !== existing.length || existing.some(p => active.peers![p.name] !== peerFingerprint(p))) return false
  try {
    const response = await managementRequest(agentManagementPath(record.id), record.config.adminToken, '/a2a/admin/visitors',
      { name: peer.name, token: peer.token, trusted: peer.trusted })
    const result = response.json as { name?: unknown; applied?: unknown }
    if (!response.ok || result.name !== peer.name || result.applied !== true) return false
    const peers = { ...active.peers, [peer.name]: peerFingerprint(peer) }
    const fingerprintValue = record.config.peers.every(p => peers[p.name] === peerFingerprint(p)) ? fingerprint(record.config) : active.fingerprint
    const file = runtimePath(record.id), temporary = `${file}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify({ ...active, peers, fingerprint: fingerprintValue }), { mode: 0o600 }); await rename(temporary, file) }
    finally { await rm(temporary, { force: true }) }
    return true
  } catch { return false } // Keep the persisted visitor; never retry an uncertain admission automatically.
}
export async function stopPublication(id: string): Promise<void> {
  const s = await publicationStatus(id)
  if (s.state !== 'unregistered') await setEnabled(publicationDir(id), false)
}
async function configurePublication(record: AgentRecord, requireApplied: boolean): Promise<PublicationStatus> {
  // Protect credentials against every saved visitor workspace, including another agent's.
  for (const agent of await listAgents()) await validateSharedRoots(agent.config)
  await validateSharedRoots(record.config)
  const relay = record.config.network.relay
  const relayOrigin = relay?.provider === 'custom' ? relay.host?.trim() : defaultRelayHost()
  if (!relayOrigin) throw new Error('默认 Relay 地址尚未配置，请选择自定义 Relay host')
  const active = await runtime(record)
  if (requireApplied && (!active || active.fingerprint !== fingerprint(record.config))) throw new Error('请先启动或重新启动本地 agent，应用访客凭据和工作目录后再开启公网发布')
  const lan = Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => !!i).map(i => i.address)
  let host = active?.host ?? resolveBindHost(record.config.network, lan)
  if (host === '0.0.0.0') host = '127.0.0.1'
  if (host === '::') host = '::1'
  const base = `http://${host.includes(':') ? `[${host}]` : host}:${active?.port ?? record.config.network.port}`
  const previous = await publicationStatus(record.id)
  if (previous.relayOrigin === relayOrigin && previous.contactId && relay?.contactId && previous.contactId !== relay.contactId) throw new Error('该 Agent 的公网编号已固定，不能更改。')
  if (previous.desiredEnabled && previous.state !== 'stopped' && previous.relayOrigin === relayOrigin) return previous
  if (previous.desiredEnabled) await setEnabled(publicationDir(record.id), false)
  await configure(publicationDir(record.id), { relayOrigin, localRpcUrl: `${base}/a2a`, localCardUrl: `${base}/.well-known/agent-card.json`,
    displayName: record.config.card.name, allowHttp: process.env['A2A_RELAY_ALLOW_LOOPBACK_HTTP'] === '1',
    ...(relay?.contactId ? { contactId: relay.contactId } : {}) })
  return await publicationStatus(record.id)
}
export async function publish(record: AgentRecord): Promise<PublicationStatus> {
  const previous = await configurePublication(record, true)
  if (previous.desiredEnabled && previous.state !== 'stopped') return await register(publicationDir(record.id))
  await register(publicationDir(record.id)) // Report number conflicts before enabling background reconnects.
  return await setEnabled(publicationDir(record.id), true)
}
export async function reservePublication(record: AgentRecord): Promise<PublicationStatus> {
  await configurePublication(record, false)
  return await register(publicationDir(record.id))
}
export async function requestPublication(record: AgentRecord, running: boolean): Promise<PublicationStatus> {
  const active = await runtime(record)
  return running && active?.fingerprint === fingerprint(record.config) ? await publish(record) : await reservePublication(record)
}
export async function invitation(record: AgentRecord, peerName: string, running = false): Promise<{ text: string; notice: string; online: boolean }> {
  const publicAccess = peerName === '__public__'
  if (publicAccess && !await publicVisitorsEnabled(record.id)) throw new Error('请先开启允许公开访客')
  const peer = record.config.peers.find(p => p.name === peerName && p.trusted)
  if (!peer && !publicAccess) throw new Error('请选择已允许聊天的访客')
  const applied = publicAccess || (await appliedVisitors(record)).includes(peer!.name)
  let publication: { publicRpcUrl: string; publicCardUrl: string; contactId: string } | undefined
  let online = running && applied
  if (record.config.network.mode === 'relay') {
    const s = await publicationStatus(record.id)
    const relay = record.config.network.relay
    const expected = relay?.provider === 'custom' ? relay.host?.trim().replace(/\/$/, '') : defaultRelayHost().replace(/\/$/, '')
    if (!s.publicRpcUrl || !s.publicCardUrl || s.relayOrigin !== expected) throw new Error('请先获取当前 Relay 的中继地址，再复制邀请')
    if (!isContactId(s.contactId)) throw new Error('Relay 尚未分配有效编号，请升级中继服务后点击「同步中继编号」')
    publication = { publicRpcUrl: s.publicRpcUrl, publicCardUrl: s.publicCardUrl, contactId: s.contactId }
    online = s.state === 'online' && s.desiredEnabled && applied
  } else if (!derivedPublicUrl(record.config.network)) throw new Error('请先配置可供访客访问的局域网地址')
  const notice = online ? '' : running && !applied ? '此访客配置尚未应用，请重启 Agent 后再聊天。地址和邀请可提前保存。'
    : 'Agent 当前未连接。请在主人启动 Agent 并开启发布后再聊天；访问地址保持不变。'
  const text = publicAccess ? publicVisitorInstruction(record.config, publication) : visitorInstruction(record.config, peer!, undefined, publication)
  return { text: notice ? `${notice}\n\n${text.replace('A2A 在线 agent', 'A2A agent')}` : text, notice, online }
}
