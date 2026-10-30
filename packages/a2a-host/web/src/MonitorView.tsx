/**
 * One agent's console: overview card, run controls, and the who-came-and-
 * what-was-said timeline from that agent's admin snapshot.
 *
 * @module a2a-host/web/MonitorView
 */

import { useEffect, useState } from 'react'
import { api, type AgentDetail } from './api.ts'
import type { MonitorSnapshot } from '../../src/types.ts'
import { PROVIDERS } from '../../src/providers.ts'
import { derivedPublicUrl } from '../../src/url.ts'
import { HandoffCard } from './HandoffCard.tsx'
import { PublicationCard } from './PublicationCard.tsx'
import { CollapsibleCard } from './CollapsibleCard.tsx'

const STATE_LABELS: Record<string, string> = {
  TASK_STATE_SUBMITTED: '已提交',
  TASK_STATE_WORKING: '进行中',
  TASK_STATE_INPUT_REQUIRED: '待补充',
  TASK_STATE_AUTH_REQUIRED: '待认证',
  TASK_STATE_COMPLETED: '已完成',
  TASK_STATE_CANCELED: '已取消',
  TASK_STATE_FAILED: '失败',
  TASK_STATE_REJECTED: '已拒绝',
}

/** One summary row: label left, value right. */
function SummaryRow(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="overview-item">
      <div className="label">{props.label}</div>
      <div className="value">{props.children}</div>
    </div>
  )
}

/** The configured agent at a glance: card, model, address, workspace, visitors. */
function AgentOverview(props: { detail: AgentDetail; running: boolean | undefined; children: React.ReactNode }): React.JSX.Element {
  const config = props.detail.config
  const active = config.models[config.activeModelIndex] ?? config.models[0]
  const provider = active !== undefined ? (PROVIDERS[active.provider] ?? PROVIDERS.deepseek) : undefined
  const standbys = config.models.length - 1
  const url = config.network.mode === 'relay' ? '见下方公网中继状态' : derivedPublicUrl(config.network) ?? `http://127.0.0.1:${config.network.port}/a2a`
  const trusted = config.peers.filter(peer => peer.trusted).length
  return (
    <CollapsibleCard className="agent-overview" label="Agent 概览" storageKey={`${props.detail.id}:overview`}
      heading={<><span className="eyebrow">AGENT 概览</span><h2>{config.card.name}</h2><p className="hint">{config.card.description}</p></>}
      status={<span className={`status-pill ${props.running ? 'ok' : ''}`}><span className={`dot ${props.running ? 'on' : 'off'}`} aria-hidden="true" />{props.running === undefined ? '检测中…' : props.running ? '运行中' : '未运行'}</span>}>
      <div className="row"><span className="chip">{provider?.label ?? '未设模型'}</span>
        {active !== undefined ? <span className="mono muted">{active.model}</span> : null}
        {standbys > 0 ? <span className="chip">另有 {standbys} 个备用模型</span> : null}</div>
      <div className="overview-grid">
      <SummaryRow label="服务地址"><span className="mono">{url}</span></SummaryRow>
      <SummaryRow label="工作区"><span className="mono">{config.isolation.workspaceRoot}</span></SummaryRow>
      <SummaryRow label="访客">
        {config.peers.length} 位，其中 {trusted} 位可对话、读文件
        （{config.peers.map(peer => peer.name).join('、') || '无'}）
      </SummaryRow>
      <SummaryRow label="权限">仅可读取指定工作目录；其他工具关闭</SummaryRow>
      </div>
      {props.children}
    </CollapsibleCard>
  )
}

export function MonitorView(props: {
  agentId: string
  onEdit: () => void
  onDeleted: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<AgentDetail | undefined>(undefined)
  const [running, setRunning] = useState<boolean | undefined>(undefined)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | undefined>(undefined)
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const visitorContexts = snapshot?.contexts.filter(context => context.peer !== 'owner')

  const refresh = (): void => {
    void api.agent(props.agentId).then(setDetail).catch(error => setReason(`配置读取失败：${String(error)}`))
    void api.status(props.agentId).then(status => {
      setRunning(status.running)
      setLogs(status.logs)
    }).catch(error => setReason(`状态读取失败：${String(error)}`))
    void api.monitor(props.agentId).then(result => {
      if (result.ok) {
        setSnapshot(result.snapshot)
        setReason(undefined)
      } else {
        setSnapshot(undefined)
        setReason(result.reason)
      }
    }).catch(error => setReason(`来访记录读取失败：${String(error)}`))
  }

  const perform = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    try { await action() }
    catch (error) { setActionError(`${label}失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    setDetail(undefined)
    setSnapshot(undefined)
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId])

  const controls = (
      <div className="agent-controls" aria-label="Agent 运行控制">
        <div className="row">
          <div className="controls-main">
          {busy ? <span className="small muted">处理中…</span> : null}
          <button
            className="primary"
            disabled={busy || running === true}
            onClick={() => {
              void perform('启动', async () => { await api.start(props.agentId); refresh(); props.onChanged() })
            }}
          >
            启动
          </button>
          <button
            disabled={busy || running !== true}
            onClick={() => {
              void perform('停止', async () => { await api.stop(props.agentId); refresh(); props.onChanged() })
            }}
          >
            停止
          </button>
          <button className="quiet" onClick={props.onEdit}>编辑配置</button>
          </div>
          <div className="secondary-actions">
          <button className="quiet" aria-expanded={showLogs} onClick={() => setShowLogs(value => !value)}>{showLogs ? '收起日志' : '看日志'}</button>
          <button
            className="quiet danger"
            disabled={busy}
            onClick={() => {
              if (detail === undefined || !window.confirm(`删除 Agent「${detail.config.card.name}」？已保存的配置将移除；运行中的实例会先停止。`)) return
              void perform('删除', async () => { await api.deleteAgent(props.agentId); props.onDeleted() })
            }}
          >
            删除
          </button>
          </div>
        </div>
        {actionError ? <p role="alert" className="field-note">{actionError}</p> : null}
        {showLogs ? <pre className="code" style={{ marginTop: 12 }}>{logs.slice(-40).join('\n') || '（暂无日志）'}</pre> : null}
      </div>
  )

  return (
    <>
      {detail !== undefined ? <AgentOverview detail={detail} running={running}>{controls}</AgentOverview> : <p className="muted">加载中…</p>}
      {detail !== undefined ? <PublicationCard detail={detail} onChanged={refresh} /> : null}
      <HandoffCard key={props.agentId} agentId={props.agentId} />
      <CollapsibleCard label="来访记录" storageKey={`${props.agentId}:visitors`}
        heading={<><h2>来访记录</h2><p className="hint">访客的问题与 Agent 的答复，仅在本机显示。</p></>}
        status={<span className="chip">每 5 秒更新</span>}>
        {reason !== undefined ? <p className="muted">{reason}</p> : null}
        {visitorContexts?.length === 0 ? (
          <div className="empty-message">还没有访客来过。复制上方聊天邀请，发给第一位访客。</div>
        ) : null}
        {visitorContexts?.map(context => (
          <div className="context" key={context.contextId}>
            <header>
              <strong>{context.peer}</strong>
              <span className="chip">{new Date(context.lastTouchedAt).toLocaleString()}</span>
              {context.active > 0 ? <span className="chip ok">{context.active} 个任务进行中</span> : null}
              <span className="grow" />
              <span className="small muted mono">{context.cwd}</span>
            </header>
            {context.tasks.length === 0 ? <div className="task muted">（此会话还没有任务）</div> : null}
            {[...context.tasks].reverse().map(task => (
              <div className="task" key={task.taskId}>
                <div className="who">
                  <span className={`chip ${task.state === 'TASK_STATE_COMPLETED' ? 'ok' : task.state === 'TASK_STATE_FAILED' ? 'bad' : ''}`}>
                    {STATE_LABELS[task.state] ?? task.state}
                  </span>
                  {'　'}{new Date(task.updatedAt).toLocaleString()}
                </div>
                <div className="text">{task.input ?? '（无原文记录）'}</div>
                {task.output !== undefined && task.output.length > 0 ? <div className="answer">{task.output}</div> : null}
              </div>
            ))}
          </div>
        ))}
      </CollapsibleCard>
    </>
  )
}
