import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hostHome } from './paths.ts'
import { calendarModule } from './visitor-runtime.ts'

export type CalendarProvider = 'google' | 'feishu'
interface Info { connectionId: string; provider: CalendarProvider; label: string; coverage: string }
interface Progress { status: string; phase: string; authorizationUrl: string; expiresAt: number; error?: string }
interface Authorization { ready: Promise<Progress>; view: () => Progress; cancel: () => Promise<void> }
interface GoogleClient { clientId: string; clientSecret?: string }
interface Core {
  connectionInfo: (file: string) => Promise<Info | undefined>; disconnect: (file: string) => Promise<void>
  readGoogleClient: (file: string) => Promise<GoogleClient | undefined>
  importGoogleClient: (file: string, document: unknown) => Promise<{ saved: boolean }>
  forgetGoogleClient: (file: string) => Promise<void>
}
const pending = new Map<string, Authorization>()
export const calendarConnectionPath = (id: string): string => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid agent ID')
  return join(hostHome(), 'calendar', `${id}.connection.json`)
}
async function core(id: string, install = false) {
  const record = JSON.parse(await readFile(join(hostHome(), 'agents', `${id}.json`), 'utf8')) as { profile: string }
  const file = await calendarModule(record.profile, install)
  return { module: await import(pathToFileURL(file).href) as Core, file }
}
async function googleClient(id: string): Promise<GoogleClient | undefined> {
  const file = calendarConnectionPath(id)
  if (existsSync(join(dirname(file), 'calendar.sqlite'))) {
    const loaded = await core(id).catch(() => undefined)
    const client = await loaded?.module.readGoogleClient(file)
    if (client) return client
  }
  const clientId = process.env['A2A_GOOGLE_CLIENT_ID'], clientSecret = process.env['A2A_GOOGLE_CLIENT_SECRET']
  return clientId ? { clientId, ...(clientSecret ? { clientSecret } : {}) } : undefined
}
export async function importCalendarGoogleClient(id: string, document: unknown) {
  const status = await calendarStatus(id)
  if (status.connected || status.needsReconnect || status.pending) throw new Error('请先解除当前连接或取消正在进行的授权，再更换 Google 配置')
  return (await core(id, true)).module.importGoogleClient(calendarConnectionPath(id), document)
}
export async function calendarStatus(id: string) {
  let connection: Info | undefined, needsReconnect = false
  try {
    const envelope = JSON.parse(await readFile(calendarConnectionPath(id), 'utf8')) as { version: number }
    if (envelope.version !== 2) needsReconnect = true
    else connection = await (await core(id)).module.connectionInfo(calendarConnectionPath(id))
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const progress = pending.get(id)?.view()
  return { configured: true, connected: Boolean(connection), provider: connection?.provider, label: connection?.label,
    googleConfigured: Boolean(await googleClient(id)),
    coverage: connection?.coverage, mode: 'auto' as const, pending: progress?.status === 'pending', needsReconnect,
    ...(progress ? { phase: progress.phase, authorizationUrl: progress.authorizationUrl } : {}),
    providers: [{ id: 'google', available: true }, { id: 'feishu', available: true }] }
}
export async function startCalendarConnection(id: string, provider: unknown) {
  if (!['google', 'feishu'].includes(String(provider))) throw new Error('请选择 Google 或飞书日历')
  const status = await calendarStatus(id)
  if (status.connected || status.needsReconnect) throw new Error('请先解除当前日历连接')
  const client = provider === 'google' ? await googleClient(id) : undefined
  if (provider === 'google' && !client) throw new Error('请先在 Portal 导入你自己的 Google 桌面应用客户端 JSON')
  await pending.get(id)?.cancel(); pending.delete(id)
  const loaded = await core(id, true)
  const auth = await import(pathToFileURL(join(dirname(loaded.file), 'auth.mjs')).href) as {
    createAuthorization: (file: string, provider: unknown, config: object) => Authorization
  }
  const session = auth.createAuthorization(calendarConnectionPath(id), provider, {
    googleClientId: client?.clientId, googleClientSecret: client?.clientSecret,
  })
  pending.set(id, session)
  try { return await session.ready } catch (e) { pending.delete(id); throw e }
}
export async function pollCalendarConnection(id: string) {
  const session = pending.get(id)
  if (!session) return { status: (await calendarStatus(id)).connected ? 'connected' : 'idle' }
  const result = session.view()
  if (result.status !== 'pending') pending.delete(id)
  return result
}
export async function disconnectCalendar(id: string, forgetClient = false) {
  const session = pending.get(id)
  await session?.cancel(); pending.delete(id)
  const path = calendarConnectionPath(id)
  let version: number | undefined
  try { version = (JSON.parse(await readFile(path, 'utf8')) as { version: number }).version } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  if (version === 1) await rm(path, { force: true })
  else {
    // Acquire the same store lock even if the file does not exist yet: an OAuth
    // callback may already be committing its temporary file concurrently.
    const loaded = await core(id).catch(error => { if (version !== undefined || session) throw error; return undefined })
    if (loaded) {
      await loaded.module.disconnect(path)
      if (forgetClient) await loaded.module.forgetGoogleClient(path)
    }
    else await rm(path, { force: true })
  }
  await rm(`${path}.pending`, { force: true })
  return { disconnected: true }
}
