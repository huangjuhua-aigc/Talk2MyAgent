import http from 'node:http'
import https from 'node:https'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { LIMIT, originOf, decodeFrame, bytesOf, headersOf, wire, sameSession, readLimited, adaptCard } from '@talk2myagent/a2a-relay-protocol'

export function localTarget(input) {
  const u = new URL(input), host = u.hostname.replace(/^\[|\]$/g, '')
  const local = Object.values(networkInterfaces()).flat().filter(Boolean).map(i => i.address)
  if (u.protocol !== 'http:' || !isIP(host) || !['127.0.0.1','::1',...local].includes(host) ||
      u.username || u.password || u.search || u.hash) throw new Error('Local target must be a pinned HTTP address on this device')
  return u.toString()
}
function upstream(url, { method = 'GET', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(localTarget(url), { method, headers: { ...headers, 'accept-encoding': 'identity', ...(body ? { 'content-length': body.length } : {}) },
      signal, maxHeaderSize: LIMIT.headers, timeout: LIMIT.first }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(new Error('Local redirects and encoded responses are unsupported')); return
      }
      res.setTimeout(LIMIT.idle, () => res.destroy(new Error('Local response idle timeout')))
      resolve(res)
    })
    req.on('timeout', () => req.destroy(new Error('Local response timeout')))
    req.on('error', reject); req.end(body)
  })
}
export async function control(origin, path, token, method = 'GET', body) {
  // Node HTTP does not follow redirects or use ambient browser credentials.
  return await new Promise((resolve, reject) => {
    const url = new URL(path, origin), data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, timeout: 8000, maxHeaderSize: LIMIT.headers,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, res => {
      void readLimited(res, LIMIT.body).then(buffer => {
        if (res.statusCode !== 200) throw Object.assign(new Error(`Relay control HTTP ${res.statusCode}`), { status: res.statusCode })
        resolve(JSON.parse(buffer.toString()))
      }).catch(reject)
    })
    req.on('timeout', () => req.destroy(new Error('Relay control timeout'))); req.on('error', reject); req.end(data)
  })
}
export class Connector {
  constructor({ config, state, save, onStatus = () => {} }) {
    this.config = { ...config, relayOrigin: originOf(config.relayOrigin, config.allowHttp) }
    localTarget(config.localRpcUrl); localTarget(config.localCardUrl)
    if (new URL(config.localRpcUrl).origin !== new URL(config.localCardUrl).origin) throw new Error('Local RPC and Agent Card must use the same origin')
    this.state = state; this.save = save; this.onStatus = onStatus; this.stopped = false; this.flows = new Map(); this.attempt = 0
  }
  status(state, error) { this.onStatus({ state, ...(error ? { error } : {}), ...(this.registration?.info ?? {}), relayOrigin: this.config.relayOrigin }) }
  async register() {
    const origin = this.config.relayOrigin
    let registration = this.state.registrations[origin]
    if (!registration) {
      registration = { registrationId: randomUUID(), token: randomBytes(32).toString('hex') }
      this.state.registrations[origin] = registration
      await this.save() // Persist the secret before the first network write; retries recover the same identity.
    }
    this.registration = registration
    if (!registration.info) {
      this.status('registering')
      const info = await control(origin, '/v1/agents/register', undefined, 'POST', { registrationId: registration.registrationId,
        deviceTokenHash: createHash('sha256').update(registration.token).digest('hex'), displayName: this.config.displayName, protocolVersion: '1.0' })
      const expected = `/r/${info.publicationId}`
      if (!/^[a-zA-Z0-9_-]{16,80}$/.test(info.publicationId) || info.publicRpcUrl !== `${origin}${expected}/a2a` ||
          info.publicCardUrl !== `${origin}${expected}/.well-known/agent-card.json` || info.connectUrl !== `${origin.replace(/^http/, 'ws')}/v1/connect`) throw new Error('Relay returned inconsistent endpoints')
      registration.info = info; await this.save()
    }
    return registration
  }
  async syncIntent() {
    const r = this.registration ?? this.state.registrations[this.config.relayOrigin]
    if (!r?.info) return
    const revision = this.state.revision, enabled = this.state.desiredEnabled, operationId = this.state.operationId
    await control(this.config.relayOrigin, '/v1/publication/enabled', r.token, 'PUT', { enabled, revision, operationId })
    if (this.state.revision === revision && this.state.operationId === operationId) { this.state.cloudSyncPending = false; await this.save() }
  }
  async start() {
    this.status('starting')
    try {
      await this.register()
      if (this.stopped) return
      await this.syncIntent()
      if (this.stopped) return
      const check = await upstream(this.config.localCardUrl, { signal: AbortSignal.timeout(5000) })
      if (check.statusCode !== 200) { check.destroy(); throw new Error('Local Agent Card is unavailable') }
      adaptCard(JSON.parse((await readLimited(check)).toString()), this.registration.info.publicRpcUrl)
      if (this.stopped) return
      this.connect()
    } catch (error) { this.retry(error) }
  }
  retry(error) {
    if (this.stopped) return
    if ([401,403,409].includes(error?.status)) { this.status('blocked', 'Relay 拒绝设备凭据或发布意图，请检查服务端状态'); return }
    this.status('reconnecting', error?.message ?? 'Connector disconnected')
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => { void this.start() }, Math.min(30000, 500 * 2 ** Math.min(this.attempt++, 6)) + Math.random() * 250)
  }
  connect() {
    this.status('connecting')
    const ws = this.ws = new WebSocket(this.registration.info.connectUrl, { headers: { authorization: `Bearer ${this.registration.token}` },
      maxPayload: LIMIT.frame, perMessageDeflate: false, followRedirects: false, handshakeTimeout: 8000 })
    let session, lastPing = Date.now(), online = false, blocked
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPing > LIMIT.idle) ws.terminate()
    }, 5000)
    const localProbe = setInterval(() => {
      if (!online || this.stopped) return
      void upstream(this.config.localCardUrl, { signal: AbortSignal.timeout(5000) }).then(async res => {
        if (res.statusCode !== 200) throw new Error('Local agent offline')
        adaptCard(JSON.parse((await readLimited(res)).toString()), this.registration.info.publicRpcUrl)
      }).catch(() => ws.terminate())
    }, 10000)
    ws.on('ping', () => { lastPing = Date.now() })
    ws.on('unexpected-response', (_req, res) => { blocked = Object.assign(new Error('Handshake rejected'), { status: res.statusCode }); res.resume(); ws.terminate() })
    ws.on('error', () => {})
    ws.on('close', () => {
      clearInterval(heartbeat); clearInterval(localProbe)
      for (const f of this.flows.values()) this.abort(f)
      this.flows.clear()
      this.retry(blocked)
    })
    ws.on('message', (raw, binary) => {
      try {
        if (binary) throw new Error('Expected JSON')
        const m = decodeFrame(raw)
        if (m.type === 'hello' && !session) {
          session = { connectionId: m.connectionId, generation: m.generation }
          void wire(ws, session, { type: 'ready' }).catch(() => ws.terminate()); return
        }
        if (!session || !sameSession(m, session)) throw new Error('Session mismatch')
        if (m.type === 'ready_ack' && !online) { online = true; this.attempt = 0; this.status('online'); return }
        if (!online) throw new Error('Not ready')
        if (m.type === 'request_begin') {
          if (this.flows.has(m.requestId) || this.flows.size >= LIMIT.concurrent || !['card','rpc'].includes(m.route) ||
              !Number.isInteger(m.length) || m.length < 0 || m.length > LIMIT.body || m.route === 'card' && m.length) throw new Error('Invalid request')
          const f = { id: m.requestId, route: m.route, headers: headersOf(m.headers), length: m.length, received: 0, seq: 0, chunks: [],
            sent: 0, consumed: 0, responseSeq: 0, controller: new AbortController(), ended: false }
          f.timer = setTimeout(() => { this.abort(f); this.flows.delete(f.id); void wire(ws, session, { type: 'abort', requestId: f.id }).catch(() => {}) }, LIMIT.total)
          this.flows.set(f.id, f); return
        }
        const f = this.flows.get(m.requestId)
        if (!f) return
        if (m.type === 'abort') { this.abort(f); this.flows.delete(f.id); return }
        if (m.type === 'credit') {
          if (!Number.isSafeInteger(m.consumed) || m.consumed < f.consumed || m.consumed > f.sent) throw new Error('Invalid credit')
          f.consumed = m.consumed; f.wake?.(); return
        }
        if (m.type === 'request_data') {
          const chunk = bytesOf(m)
          if (f.ended || m.seq !== f.seq++ || f.received + chunk.length > f.length) throw new Error('Invalid request data')
          f.chunks.push(chunk); f.received += chunk.length; return
        }
        if (m.type === 'request_end') {
          if (f.ended || m.seq !== f.seq || f.received !== f.length) throw new Error('Incomplete request')
          f.ended = true
          void this.forward(f, ws, session).catch(() => wire(ws, session, { type: 'abort', requestId: f.id }).catch(() => {}))
            .finally(() => { this.abort(f); this.flows.delete(f.id) }); return
        }
        throw new Error('Unexpected frame')
      } catch { ws.terminate() }
    })
  }
  abort(f) { clearTimeout(f.timer); f.controller.abort(); f.wake?.() }
  async forward(f, ws, session) {
    const body = Buffer.concat(f.chunks); f.chunks = []
    let extended = false
    if (f.route === 'rpc') { try { extended = JSON.parse(body.toString()).method === 'GetExtendedAgentCard' } catch {} }
    const res = await upstream(f.route === 'card' ? this.config.localCardUrl : this.config.localRpcUrl, {
      method: f.route === 'card' ? 'GET' : 'POST', headers: f.headers, ...(f.route === 'rpc' ? { body } : {}), signal: f.controller.signal })
    let stream = res
    const headers = headersOf(res.headers, true)
    if (res.statusCode >= 200 && res.statusCode < 300 && (f.route === 'card' || extended)) {
      const data = JSON.parse((await readLimited(res)).toString())
      if (f.route === 'card') stream = [Buffer.from(JSON.stringify(adaptCard(data, this.registration.info.publicRpcUrl)))]
      else { if (data.result) data.result = adaptCard(data.result, this.registration.info.publicRpcUrl); stream = [Buffer.from(JSON.stringify(data))] }
      headers['content-type'] = 'application/json'
    }
    await wire(ws, session, { type: 'response_begin', requestId: f.id, status: res.statusCode, headers })
    for await (const chunk of stream) {
      for (let offset = 0; offset < chunk.length; offset += LIMIT.chunk) {
        const bytes = chunk.subarray(offset, offset + LIMIT.chunk)
        while (!f.controller.signal.aborted && f.sent + bytes.length - f.consumed > LIMIT.window) await new Promise(resolve => { f.wake = resolve })
        if (f.controller.signal.aborted) throw new Error('Aborted')
        f.sent += bytes.length
        await wire(ws, session, { type: 'response_data', requestId: f.id, seq: f.responseSeq++, data: bytes.toString('base64') })
      }
    }
    await wire(ws, session, { type: 'response_end', requestId: f.id, seq: f.responseSeq })
  }
  stop() {
    this.stopped = true; clearTimeout(this.retryTimer)
    for (const f of this.flows.values()) this.abort(f)
    this.flows.clear(); this.ws?.terminate(); this.status('stopped')
  }
}
