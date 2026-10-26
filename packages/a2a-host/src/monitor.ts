/** Owner traffic uses local IPC; the token never travels to the public listener. */
import { request } from 'node:http'
import type { MonitorSnapshot } from './types.ts'

export function managementRequest(socketPath: string, token: string, path: string, body?: unknown, timeoutMs = 4000): Promise<{ ok: boolean; status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'a2a-version': '1.0' },
    }, res => {
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 32_000_000) { req.destroy(new Error('management response exceeds limit')); return }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        try { resolve({ ok: (res.statusCode ?? 500) < 300, status: res.statusCode ?? 500,
          json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) } catch (error) { reject(error) }
      })
    })
    const timer = setTimeout(() => req.destroy(new Error('management request timed out')), timeoutMs)
    timer.unref()
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

export async function fetchSnapshot(socketPath: string, token: string): Promise<{ ok: true; snapshot: MonitorSnapshot } | { ok: false; reason: string }> {
  try {
    const response = await managementRequest(socketPath, token, '/a2a/admin/contexts')
    if (!response.ok) return { ok: false, reason: `admin surface answered ${response.status}` }
    return { ok: true, snapshot: response.json as MonitorSnapshot }
  } catch (error) {
    return { ok: false, reason: `无法连接本机管理接口；请更新插件并重新保存、启动 agent（${String(error)}）` }
  }
}
