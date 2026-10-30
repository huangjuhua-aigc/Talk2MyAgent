import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { createHash } from 'node:crypto'
import { assertPrivateDirectory, configure, setEnabled, status, type PublicationStatus } from '@talk2myagent/a2a-connector'
import { hostHome } from './paths.ts'
import { listAgents, type AgentRecord } from './files.ts'
import { resolveBindHost } from './url.ts'
import { visitorInstruction } from './invitation.ts'
import type { WizardConfig } from './types.ts'

const safeId = (id: string): string => { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid agent ID'); return id }
export const publicationDir = (id: string): string => join(hostHome(), 'relay', safeId(id))
export const defaultRelayHost = (): string => process.env['A2A_RELAY_DEFAULT_HOST'] ?? ''
export async function validateSharedRoots(config: WizardConfig): Promise<void> {
  const roots = [config.isolation.workspaceRoot, ...Object.values(config.isolation.peerWorkspaces)]
  if (roots.some(root => !root)) throw new Error('工作目录不能为空')
  await assertPrivateDirectory(join(hostHome(), 'relay'), roots)
}
const fingerprint = (config: WizardConfig): string => createHash('sha256').update(JSON.stringify({ peers: config.peers, isolation: config.isolation })).digest('hex')
interface Runtime { host: string; port: number; fingerprint: string }
const runtimePath = (id: string): string => join(publicationDir(id), 'applied.json')
export async function recordRuntime(record: AgentRecord, bind: { host: string; port: number }): Promise<void> {
  await validateSharedRoots(record.config)
  await mkdir(publicationDir(record.id), { recursive: true, mode: 0o700 })
  await writeFile(runtimePath(record.id), JSON.stringify({ ...bind, fingerprint: fingerprint(record.config) }), { mode: 0o600 })
}
async function runtime(record: AgentRecord): Promise<Runtime | undefined> {
  try { return JSON.parse(await readFile(runtimePath(record.id), 'utf8')) as Runtime } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return undefined }
}
export async function publicationStatus(id: string): Promise<PublicationStatus> { return await status(publicationDir(id)) }
export async function stopPublication(id: string): Promise<void> {
  const s = await publicationStatus(id)
  if (s.state !== 'unregistered') await setEnabled(publicationDir(id), false)
}
export async function publish(record: AgentRecord): Promise<PublicationStatus> {
  // Protect credentials against every saved visitor workspace, including another agent's.
  for (const agent of await listAgents()) await validateSharedRoots(agent.config)
  await validateSharedRoots(record.config)
  const relay = record.config.network.relay
  const relayOrigin = relay?.provider === 'custom' ? relay.host?.trim() : defaultRelayHost()
  if (!relayOrigin) throw new Error('默认 Relay 地址尚未配置，请选择自定义 Relay host')
  const active = await runtime(record)
  if (!active || active.fingerprint !== fingerprint(record.config)) throw new Error('请先启动或重新启动本地 agent，应用访客凭据和工作目录后再开启公网发布')
  const lan = Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => !!i).map(i => i.address)
  let host = active?.host ?? resolveBindHost(record.config.network, lan)
  if (host === '0.0.0.0') host = '127.0.0.1'
  if (host === '::') host = '::1'
  const base = `http://${host.includes(':') ? `[${host}]` : host}:${active?.port ?? record.config.network.port}`
  const previous = await publicationStatus(record.id)
  if (previous.desiredEnabled && previous.state !== 'stopped') return previous
  if (previous.desiredEnabled) await setEnabled(publicationDir(record.id), false)
  await configure(publicationDir(record.id), { relayOrigin, localRpcUrl: `${base}/a2a`, localCardUrl: `${base}/.well-known/agent-card.json`,
    displayName: record.config.card.name, allowHttp: process.env['A2A_RELAY_ALLOW_LOOPBACK_HTTP'] === '1' })
  return await setEnabled(publicationDir(record.id), true)
}
export async function invitation(record: AgentRecord, peerName: string): Promise<{ text: string }> {
  const s = await publicationStatus(record.id)
  if (s.state !== 'online' || !s.desiredEnabled || !s.publicRpcUrl || !s.publicCardUrl) throw new Error('公网地址尚未在线，暂不能生成邀请')
  const applied = await runtime(record)
  if (!applied || applied.fingerprint !== fingerprint(record.config)) throw new Error('访客凭据或工作目录尚未应用，请停止并重新启动本地 agent')
  const peer = record.config.peers.find(p => p.name === peerName && p.trusted)
  if (!peer) throw new Error('请选择已允许聊天的访客')
  return { text: visitorInstruction(record.config, peer, undefined, { publicRpcUrl: s.publicRpcUrl, publicCardUrl: s.publicCardUrl }) }
}
