/** Inline feedback only; the Connector independently validates every target. */
export function relayHostIssue(value: string): string | undefined {
  const host = value.trim()
  if (!host) return '请填写 Relay 服务地址。'
  try {
    const url = new URL(host.includes('://') ? host : `https://${host}`)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return '只填写域名或服务入口，不需要路径、账号或查询参数。'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return '请使用 HTTPS 地址；本机开发服务可以使用 HTTP。'
  } catch { return '地址格式不完整，例如 https://relay.example.com。' }
  return undefined
}
