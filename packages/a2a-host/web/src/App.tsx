/**
 * App shell: a manager layout — saved agents on the left, the selected
 * agent's console on the right. The wizard appears only when creating a new
 * agent or editing an existing one.
 *
 * @module a2a-host/web/App
 */

import React, { useEffect, useState } from 'react'
import { api, newToken, type AgentSummary } from './api.ts'
import { DEFAULT_CONFIG, Wizard } from './Wizard.tsx'
import { MonitorView } from './MonitorView.tsx'
import { normalizeProvider } from '../../src/providers.ts'
import { normalizeNetworkMode } from '../../src/url.ts'
import type { WizardConfig } from '../../src/types.ts'

/** Keep one screen's crash from blanking the whole page. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | undefined }> {
  override state: { error: Error | undefined } = { error: undefined }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  override render(): React.ReactNode {
    if (this.state.error !== undefined) {
      return (
        <div className="card">
          <h2>界面出了个错</h2>
          <p className="hint">刷新页面试试；如果反复出现，把这行错误发给维护者：</p>
          <pre className="code">{String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

/** Migrate older wizard shapes: providers, trustedAll, single model. */
function migrate(config: WizardConfig): WizardConfig {
  const legacyModel = (config as WizardConfig & { model?: WizardConfig['models'][number] }).model
  const legacyAll = (config as WizardConfig & { trustedAll?: boolean }).trustedAll
  const models = (config.models ?? (legacyModel !== undefined ? [legacyModel] : []))
    .map(entry => ({ ...entry, provider: normalizeProvider(entry.provider) }))
  return {
    ...config,
    ...(models.length > 0 ? { models } : {}),
    activeModelIndex: config.activeModelIndex ?? 0,
    network: { ...config.network, mode: normalizeNetworkMode(config.network?.mode) },
    peers: config.peers.map(peer => ({ ...peer, trusted: peer.trusted ?? legacyAll ?? true })),
  }
}

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'console'; agentId: string }
  | { kind: 'wizard'; agentId?: string; initial: WizardConfig }

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [agents, setAgents] = useState<AgentSummary[]>([])

  const reload = (): void => {
    void api.agents().then(list => {
      setAgents(list)
      setView(previous => {
        if (previous.kind === 'loading') {
          return list.length > 0
            ? { kind: 'console', agentId: list[0]!.id }
            : { kind: 'empty' }
        }
        if (previous.kind === 'console' && !list.some(agent => agent.id === previous.agentId)) {
          return list.length > 0 ? { kind: 'console', agentId: list[0]!.id } : { kind: 'empty' }
        }
        return previous
      })
    })
  }
  useEffect(reload, [])

  const startEdit = (agentId: string): void => {
    void api.agent(agentId).then(detail => {
      setView({ kind: 'wizard', agentId, initial: migrate(detail.config) })
    })
  }

  return (
    <>
      <div className="topbar">
        <h1>Talk2MyAgent</h1>
        <span className="sub">把你的 AI 开放给访客 · 本地控制台</span>
        <span className="spacer" />
      </div>
      <div className="shell">
        <aside className="sidebar">
          {agents.map(agent => (
            <button
              key={agent.id}
              className={`agent-item${view.kind === 'console' && view.agentId === agent.id ? ' now' : ''}`}
              onClick={() => { setView({ kind: 'console', agentId: agent.id }) }}
            >
              <span className={`dot ${agent.running ? 'on' : 'off'}`} />
              <span className="grow">{agent.name}</span>
            </button>
          ))}
          <button
            className="agent-item new"
            onClick={() => {
              setView({ kind: 'wizard', initial: { ...DEFAULT_CONFIG, adminToken: newToken() } })
            }}
          >
            + 新建 Agent
          </button>
        </aside>
        <main>
          <ErrorBoundary>
          {view.kind === 'loading' ? <p className="muted">加载中…</p> : null}
          {view.kind === 'empty' ? (
            <div className="card">
              <h2>还没有配置任何在线 Agent</h2>
              <p className="hint">点左侧「+ 新建 Agent」，七步配置完即可对外开放。</p>
            </div>
          ) : null}
          {view.kind === 'wizard' ? (
            <Wizard
              initial={view.initial}
              agentId={view.agentId}
              onDone={reload}
            />
          ) : null}
          {view.kind === 'console' ? (
            <MonitorView
              agentId={view.agentId}
              onEdit={() => { startEdit(view.agentId) }}
              onDeleted={reload}
            />
          ) : null}
          </ErrorBoundary>
        </main>
      </div>
    </>
  )
}
