import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostHome } from './paths.ts'

export function publicVisitorsPath(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid agent ID')
  return join(hostHome(), 'public-visitors', `${id}.json`)
}
export async function publicVisitorsEnabled(id: string): Promise<boolean> {
  try { return JSON.parse(await readFile(publicVisitorsPath(id), 'utf8')).enabled === true } catch { return false }
}
export async function setPublicVisitors(id: string, enabled: boolean): Promise<void> {
  const file = publicVisitorsPath(id), temporary = `${file}.${randomUUID()}.tmp`
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  try { await writeFile(temporary, JSON.stringify({ enabled }), { mode: 0o600 }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}
