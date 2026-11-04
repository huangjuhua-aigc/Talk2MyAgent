/** Keep the LAN address and its listener port together in the form. */
export function formatLocalAddress(host: string, port: number): string {
  return `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`
}

/** Accept an IP and explicit port, optionally pasted as an HTTP A2A URL. */
export function parseLocalAddress(value: string): { host: string; port: number } | undefined {
  const match = /^(?:http:\/\/)?(\[[0-9a-f:]+\]|\d+(?:\.\d+){3}):(\d+)(?:\/(?:a2a\/?)?)?$/i.exec(value.trim())
  if (!match) return undefined
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  try {
    const url = new URL(`http://${match[1]}:${port}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (host === '0.0.0.0' || host === '::') return undefined
    return { host, port }
  } catch { return undefined }
}
