/** Typed wrappers over the console CLI's /api. */

import type { DetectResult, HandoffSnapshot, MonitorSnapshot, WizardConfig } from '../../src/types.ts'

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`)
  return await response.json() as T
}

async function post<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`)
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
