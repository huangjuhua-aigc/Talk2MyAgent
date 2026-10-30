// Wire version 1. Shared by Connector and the independently deployable Relay.
export const LIMIT = Object.freeze({ body: 1_000_000, frame: 128 * 1024, chunk: 48 * 1024,
  window: 256 * 1024, queue: 1024 * 1024, headers: 16 * 1024, concurrent: 8,
  total: 600_000, first: 90_000, idle: 45_000, heartbeat: 20_000 })
export const hashPattern = /^[a-f0-9]{64}$/
export const idPattern = /^[a-zA-Z0-9_-]{16,80}$/
export function originOf(input, allowHttp = false) {
  const u = new URL(input.includes('://') ? input : `https://${input}`)
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
      !(u.protocol === 'https:' || allowHttp && u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname))) {
    throw new Error('Relay host must be an HTTPS origin (loopback HTTP requires development mode)')
  }
  return u.origin
}
export function decodeFrame(raw) {
  if (raw.length > LIMIT.frame) throw new Error('Frame too large')
  const m = JSON.parse(raw.toString())
  if (!m || m.v !== 1 || !idPattern.test(m.connectionId ?? '') || !Number.isSafeInteger(m.generation) || m.generation < 1 ||
      !['hello','ready','ready_ack','request_begin','request_data','request_end','response_begin','response_data','response_end','credit','abort'].includes(m.type)) throw new Error('Invalid envelope')
  if (!['hello','ready','ready_ack'].includes(m.type) && !idPattern.test(m.requestId ?? '')) throw new Error('Invalid request ID')
  return m
}
export function bytesOf(m) {
  if (typeof m.data !== 'string' || m.data.length > Math.ceil(LIMIT.chunk / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data)) throw new Error('Invalid chunk')
  return Buffer.from(m.data, 'base64')
}
export function headersOf(input, response = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > LIMIT.headers) throw new Error('Invalid headers')
  const allowed = response ? ['content-type','cache-control','www-authenticate','retry-after','a2a-version'] : ['authorization','content-type','accept','a2a-version']
  const out = {}
  for (const k of allowed) {
    const v = input[k]
    if (v !== undefined) {
      if (typeof v !== 'string' || /[\r\n\0]/.test(v)) throw new Error('Invalid header value')
      out[k] = v
    }
  }
  return out
}
export async function wire(ws, session, message) {
  const text = JSON.stringify({ ...message, v: 1, connectionId: session.connectionId, generation: session.generation })
  if (ws.readyState !== 1 || Buffer.byteLength(text) > LIMIT.frame || ws.bufferedAmount + Buffer.byteLength(text) > LIMIT.queue) throw new Error('Tunnel unavailable or congested')
  return new Promise((resolve, reject) => ws.send(text, error => error ? reject(error) : resolve()))
}
export function sameSession(m, s) { return m.connectionId === s.connectionId && m.generation === s.generation }
export async function readLimited(stream, limit = LIMIT.body) {
  const parts = []; let size = 0
  for await (const chunk of stream) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 }); parts.push(chunk) }
  return Buffer.concat(parts)
}
export function adaptCard(card, url) {
  if (!card || card.signatures !== undefined || !Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length !== 1 ||
      card.supportedInterfaces[0].protocolBinding !== 'JSONRPC' || card.supportedInterfaces[0].protocolVersion !== '1.0') throw new Error('Only unsigned, single-interface A2A 1.0 JSONRPC cards are supported')
  return { ...card, supportedInterfaces: [{ ...card.supportedInterfaces[0], url }] }
}
