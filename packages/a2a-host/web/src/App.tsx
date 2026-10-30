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
  | { kind: 'wizard'; agentId?: string; initial: WizardConfig; formKey: string }

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loadError, setLoadError] = useState<string>()

  const reload = (): void => {
    void api.agents().then(list => {
      setLoadError(undefined)
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
    }).catch(error => setLoadError(`暂时无法读取 Agent：${String(error)}`))
  }
  useEffect(reload, [])

  const createAgent = (): void => {
    setView({ kind: 'wizard', initial: { ...DEFAULT_CONFIG, adminToken: newToken(),
      peers: DEFAULT_CONFIG.peers.map(peer => ({ ...peer, token: newToken() })) }, formKey: crypto.randomUUID() })
  }

  const startEdit = (agentId: string): void => {
    void api.agent(agentId).then(detail => {
      setView({ kind: 'wizard', agentId, initial: migrate(detail.config), formKey: crypto.randomUUID() })
    }).catch(error => setLoadError(`配置读取失败：${String(error)}`))
  }

  return (
    <>
      <div className="topbar">
        <span className="brand-mark" aria-hidden="true">A2A</span>
        <div><h1>Talk2MyAgent</h1><div className="sub">让你的 Agent 与世界对话</div></div>
        <span className="spacer" />
        <span className="local-badge"><span className="dot off" aria-hidden="true" />本地管理</span>
      </div>
      <div className="shell">
        <aside className="sidebar" aria-label="Agent 列表">
          <div className="sidebar-heading"><span>我的 AGENTS</span><span>{agents.length}</span></div>
          <div className="sidebar-list">
          {agents.map(agent => (
            <button
              key={agent.id}
              className={`agent-item${view.kind === 'console' && view.agentId === agent.id ? ' now' : ''}`}
              aria-current={view.kind === 'console' && view.agentId === agent.id ? 'page' : undefined}
              title={`${agent.name} · ${agent.running ? '运行中' : '未运行'}`}
              onClick={() => { setView({ kind: 'console', agentId: agent.id }) }}
            >
              <span className={`dot ${agent.running ? 'on' : 'off'}`} />
              <span className="grow">{agent.name}</span>
            </button>
          ))}
          </div>
          <button
            className="agent-item new"
            onClick={createAgent}
          >
            + 新建 Agent
          </button>
          <p className="sidebar-note">配置模型与共享资料，启动 Agent，再把邀请发给访客。</p>
        </aside>
        <main>
          <ErrorBoundary>
          {loadError ? <div role="alert">{loadError} <button onClick={reload}>重新加载</button></div> : null}
          {view.kind === 'loading' ? <p className="muted">加载中…</p> : null}
          {view.kind === 'empty' ? (
            <div className="card empty-state">
              <div className="empty-symbol" aria-hidden="true">↗</div>
              <span className="eyebrow">开始使用</span>
              <h2>让你的 Agent 开始接待访客</h2>
              <p className="hint">选择模型和允许分享的资料，创建一个能替你回答问题、读取项目文件的 Agent。</p>
              <button className="primary" onClick={createAgent}>创建第一个 Agent →</button>
              <div className="empty-path"><span>01 配置模型</span><span>02 选择共享资料</span><span>03 发布与邀请</span></div>
            </div>
          ) : null}
          {view.kind === 'wizard' ? (
            <Wizard
              key={view.formKey}
              initial={view.initial}
              agentId={view.agentId}
              onDone={agentId => {
                if (agentId !== undefined) setView({ kind: 'console', agentId })
                else setView(agents[0] ? { kind: 'console', agentId: agents[0].id } : { kind: 'empty' })
                reload()
              }}
            />
          ) : null}
          {view.kind === 'console' ? (
            <MonitorView
              key={view.agentId}
              agentId={view.agentId}
              onEdit={() => { startEdit(view.agentId) }}
              onDeleted={reload}
              onChanged={reload}
            />
          ) : null}
          </ErrorBoundary>
        </main>
      </div>
    </>
  )
}
