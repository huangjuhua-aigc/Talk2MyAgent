import { randomBytes } from 'node:crypto'
import type { AgentRecord } from './files.ts'
import type { PeerEntry } from './types.ts'

export function newVisitor(record: AgentRecord, body: { displayName?: unknown; token?: unknown }): PeerEntry {
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().normalize('NFC') : ''
  if (!displayName || displayName.length > 80 || /[\p{Cc}\p{Cf}]/u.test(displayName)) throw new Error('姓名应为 1–80 个字符，不能包含换行或控制字符')
  const normalized = (name: string) => name.normalize('NFKC').toLowerCase()
  if (record.config.peers.some(p => normalized(p.displayName ?? p.name) === normalized(displayName))) throw new Error('已有同名访客，请使用不同姓名')
  const token = body.token === undefined ? randomBytes(32).toString('hex') : typeof body.token === 'string' ? body.token : ''
  if (token.length < 16 || token.length > 512 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) throw new Error('Token 需要 16–512 位，不可含空格或中文；可以点击重新生成')
  if (record.config.peers.some(p => p.token === token) || record.config.adminToken === token) throw new Error('此 Token 已在使用，请为新访客使用独立 Token')
  return { name: `visitor-${randomBytes(12).toString('hex')}`, displayName, token, trusted: true }
}
