/** Typed wrappers over the console CLI's /api. */

import type { DetectResult, HandoffSnapshot, MonitorSnapshot, WizardConfig } from '../../src/types.ts'
import type { PublicationStatus } from '@talk2myagent/a2a-connector'
let session: Promise<{ csrfToken: string; defaultRelayHost: string }> | undefined
const localSession = () => session ??= get<{ csrfToken: string; defaultRelayHost: string }>('/api/session').catch(error => { session = undefined; throw error })

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`)
  return await response.json() as T
}

async function post<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-a2a-csrf': (await localSession()).csrfToken },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) { const detail = await response.json().catch(() => ({})) as { error?: string }; throw new Error(detail.error ?? `请求失败（HTTP ${response.status}）`) }
  return await response.json() as T
}

export interface AgentSummary {
  id: string
  profile: string
  name: string
  running: boolean
  port: number
}

export interface AgentDetail {
  id: string
  profile: string
  config: WizardConfig
  createdAt: string
  updatedAt: string
  running: boolean
  manual?: string
}

export interface PreviewResult {
  patchYaml: string
  credentials: Record<string, string>
  launch: string
}

export const api = {
  session: localSession,
  publication: (id: string) => get<PublicationStatus>(`/api/agents/${encodeURIComponent(id)}/publication/status`),
  setPublication: (id: string, config: { enabled: boolean; provider: 'default' | 'custom'; host: string }) => post<PublicationStatus>(`/api/agents/${encodeURIComponent(id)}/publication/config`, config, 'PUT'),
  invitation: (id: string, peerName: string) => post<{ text: string }>(`/api/agents/${encodeURIComponent(id)}/publication/invitation`, { peerName }),
  detect: () => get<DetectResult>('/api/detect'),
  agents: () => get<AgentSummary[]>('/api/agents'),
  agent: (id: string) => get<AgentDetail>(`/api/agents/${encodeURIComponent(id)}`),
  createAgent: (config: WizardConfig) => post<{ record: AgentDetail }>('/api/agents', config),
  updateAgent: (id: string, config: WizardConfig) => post<{ record: AgentDetail }>(`/api/agents/${encodeURIComponent(id)}`, config, 'PUT'),
  deleteAgent: (id: string) => post<{ deleted: string }>(`/api/agents/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  preview: (id: string, config: WizardConfig) => post<PreviewResult>(`/api/agents/${encodeURIComponent(id)}/preview`, config),
  install: (id: string, sources: string[]) => post<{ results: { source: string; ok: boolean; output: string }[] }>(`/api/agents/${encodeURIComponent(id)}/install`, { sources }),
  start: (id: string) => post<{ started: boolean; manual: string }>(`/api/agents/${encodeURIComponent(id)}/start`),
  stop: (id: string) => post<{ stopped: boolean }>(`/api/agents/${encodeURIComponent(id)}/stop`),
  status: (id: string) => get<{ running: boolean; logs: string[] }>(`/api/agents/${encodeURIComponent(id)}/status`),
  monitor: (id: string) => get<{ ok: true; snapshot: MonitorSnapshot } | { ok: false; reason: string }>(`/api/agents/${encodeURIComponent(id)}/monitor`),
  handoff: (id: string) => get<HandoffSnapshot>(`/api/agents/${encodeURIComponent(id)}/handoff`),
  saveHandoff: (id: string, text: string) => post<{ saved: boolean; note: string }>(`/api/agents/${encodeURIComponent(id)}/handoff`, { text }, 'PUT'),
  setAutomaticBriefing: (id: string, enabled: boolean) => post<{ enabled: boolean }>(`/api/agents/${encodeURIComponent(id)}/briefing-auto`, { enabled }, 'PUT'),
  pickDirectory: () => post<{ ok: true; path: string } | { ok: false; reason: string }>('/api/pick-directory'),
  ensurePlugin: () => post<{ ok: boolean; output: string }>('/api/ensure-plugin'),
}

/** A fresh 32-byte hex token, generated in the page so it never transits logs. */
export function newToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
