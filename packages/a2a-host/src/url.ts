/**
 * One place for deriving the URL visitors use, shared by config generation
 * and the wizard's copyable instructions.
 *
 * @module a2a-host/url
 */

import type { WizardConfig } from './types.ts'

/** Historical network modes collapse onto the current two. */
export function normalizeNetworkMode(value: string | undefined): 'lan' | 'custom' | 'relay' {
  if (value === 'relay') return 'relay'
  return value === 'custom' || value === 'tailscale' || value === 'cloudflared' ? 'custom' : 'lan'
}

/**
 * Normalize a public origin or path prefix to an /a2a endpoint. Explicit URLs
 * control their own port; a bare host uses the configured local port.
 */
export function derivedPublicUrl(network: WizardConfig['network'], fallbackHost?: string): string | undefined {
  if (network.mode === 'relay') return undefined
  const host = network.host?.trim() || network.publicUrl?.trim() || fallbackHost
  if (!host) return undefined
  const full = host.includes('://')
  const literal = host.includes(':') && !host.startsWith('[') && !host.includes('/') && host.split(':').length > 2
    ? `[${host}]` : host
  const url = new URL(full ? host : `http://${literal}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('公网地址必须是无用户名、密码、查询参数和片段的 HTTP(S) 地址')
  }
  if (!full && !url.port) url.port = String(network.port)
  const prefix = url.pathname.replace(/\/+$/, '')
  url.pathname = prefix.endsWith('/a2a') ? prefix : `${prefix}/a2a`
  return url.toString()
}

/** Public domains describe routing, not permission to expose the LAN listener. */
export function resolveBindHost(network: WizardConfig['network'], lanIps: readonly string[]): string {
  if (network.bindHost) {
    if (!['127.0.0.1', '::1', '0.0.0.0', '::', ...lanIps].includes(network.bindHost)) throw new Error('指定的监听地址不在本机，请更新配置')
    return network.bindHost
  }
  if (network.mode === 'relay') return '127.0.0.1'
  const host = network.host?.trim().replace(/^\[|\]$/g, '')
  const literal = host !== undefined && (/^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') && /^[0-9a-f:]+$/i.test(host))
  if (normalizeNetworkMode(network.mode) === 'custom' && !literal) return '127.0.0.1'
  if (host) {
    if (!['127.0.0.1', '::1', ...lanIps].includes(host)) throw new Error('配置的局域网地址不在本机，请更新配置')
    return host
  }
  return lanIps[0] ?? '127.0.0.1'
}

/** Typing an incomplete URL in the wizard must not crash rendering. */
export function previewPublicUrl(network: WizardConfig['network'], fallbackHost?: string): string | undefined {
  try { return derivedPublicUrl(network, fallbackHost) } catch { return undefined }
}
