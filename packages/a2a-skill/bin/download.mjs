import { open, link, rm, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/** Credential-bearing requests use only the saved contact endpoint, never an artifact URL. */
export async function downloadFile(endpoint, token, id, destination) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid file ID')
  const path = resolve(destination)
  if (await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })) throw new Error('Destination already exists; choose a new file name')
  const target = `${String(endpoint).replace(/\/$/, '')}/files/${id}`
  const request = (method, headers = {}) => fetch(target, { method, redirect:'error', signal:AbortSignal.timeout(90_000), headers:{authorization:`Bearer ${token}`, ...headers} })
  const head = await request('HEAD')
  if (!head.ok) throw new Error(`File access rejected (${head.status}); restore access or ask the owner, do not repeat the chat task`)
  const etag = head.headers.get('etag'), length = head.headers.get('content-length')
  if (!/^"[a-f0-9]{64}"$/.test(etag ?? '') || !/^\d+$/.test(length ?? '')) throw new Error('Invalid download metadata')
  const size = Number(length)
  if (!Number.isSafeInteger(size) || size > 256 * 1024 * 1024) throw new Error('File exceeds the 256 MiB download limit')
  const temporary = `${path}.${randomUUID()}.part`
  const output = await open(temporary, 'wx', 0o600), hash = createHash('sha256')
  try {
    // Bounded range requests also work through function-based Relays with response limits.
    for (let start = 0; start < size; start += 1024 * 1024) {
      const end = Math.min(size - 1, start + 1024 * 1024 - 1)
      const response = await request('GET', {range:`bytes=${start}-${end}`, 'if-range':etag})
      if (response.status !== 206 || response.headers.get('etag') !== etag || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
        await response.body?.cancel(); throw new Error('Download interrupted or changed; retry the download, not the chat task')
      }
      let received = 0
      for await (const chunk of response.body) {
        received += chunk.length
        if (received > end - start + 1) throw new Error('Oversized download response')
        hash.update(chunk); await output.writeFile(chunk)
      }
      if (received !== end - start + 1) throw new Error('Incomplete download')
    }
    if (hash.digest('hex') !== etag.slice(1, -1)) throw new Error('Downloaded file checksum mismatch')
    await output.close()
    await link(temporary, path) // Atomic publication; refuse to overwrite an existing destination.
    return { path, size }
  } finally { await output.close().catch(() => {}); await rm(temporary, {force:true}) }
}
