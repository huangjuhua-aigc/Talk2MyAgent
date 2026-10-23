/**
 * Proxy the plugin's loopback-only admin surface so the admin token never
 * has to enter the browser context.
 *
 * @module a2a-host/monitor
 */

import type { MonitorSnapshot } from './types.ts'

/**
 * Fetch the monitoring snapshot from one agent's resident dsh instance.
 * @param baseUrl - the agent's actual base URL (its bound host, not loopback).
 * @param token - that agent's admin token (kept in its saved record).
 * @returns the snapshot, or a short reason it is unavailable.
 */
export async function fetchSnapshot(baseUrl: string, token: string): Promise<{ ok: true; snapshot: MonitorSnapshot } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/a2a/admin/contexts`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    })
    if (response.status === 404) return { ok: false, reason: 'the admin surface is not mounted (is the plugin the 0.3.0 build?)' }
    if (!response.ok) return { ok: false, reason: `admin surface answered ${response.status}` }
    return { ok: true, snapshot: await response.json() as MonitorSnapshot }
  } catch (error) {
    return { ok: false, reason: `cannot reach the agent (${String(error)})` }
  }
}
