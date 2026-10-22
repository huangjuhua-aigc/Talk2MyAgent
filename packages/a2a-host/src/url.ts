/**
 * One place for deriving the URL visitors use, shared by config generation
 * and the wizard's copyable instructions.
 *
 * @module a2a-host/url
 */

import type { WizardConfig } from './types.ts'

/** Historical network modes collapse onto the current two. */
export function normalizeNetworkMode(value: string | undefined): 'lan' | 'custom' {
  return value === 'custom' || value === 'tailscale' || value === 'cloudflared' ? 'custom' : 'lan'
}

/**
 * The public URL from the network settings: a host carrying its own scheme is
 * used verbatim; a bare host gets http and the port; the legacy full publicUrl
 * is the next fallback; a detected LAN IP (or loopback) may be the last one.
 */
export function derivedPublicUrl(network: WizardConfig['network'], fallbackHost?: string): string | undefined {
  const host = network.host ?? fallbackHost
  if (host !== undefined && host.length > 0) {
    if (host.includes('://')) return host
    return `http://${host}:${network.port}/a2a`
  }
  return network.publicUrl
}
