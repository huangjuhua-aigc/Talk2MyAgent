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
    <div className="row" style={{ margin: '6px 0' }}>
      <span className="muted" style={{ width: 88, flex: 'none' }}>{props.label}</span>
      <span className="grow">{props.children}</span>
    </div>
  )
}

/** The configured agent at a glance: card, model, address, workspace, visitors. */
function AgentOverview(props: { detail: AgentDetail }): React.JSX.Element {
  const config = props.detail.config
  const active = config.models[config.activeModelIndex] ?? config.models[0]
  const provider = active !== undefined ? (PROVIDERS[active.provider] ?? PROVIDERS.deepseek) : undefined
  const standbys = config.models.length - 1
  const url = derivedPublicUrl(config.network) ?? `http://127.0.0.1:${config.network.port}/a2a`
  const trusted = config.peers.filter(peer => peer.trusted).length
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{config.card.name}</h2>
        <span className="chip">{provider?.label ?? '未设模型'}</span>
        {active !== undefined ? <span className="mono">{active.model}</span> : null}
        {standbys > 0 ? <span className="chip">另有 {standbys} 个备用模型</span> : null}
      </div>
      <p className="hint">{config.card.description}</p>
      <SummaryRow label="服务地址"><span className="mono">{url}</span></SummaryRow>
      <SummaryRow label="工作区"><span className="mono">{config.isolation.workspaceRoot}</span></SummaryRow>
      <SummaryRow label="访客">
        {config.peers.length} 位，其中 {trusted} 位可执行任务
        （{config.peers.map(peer => peer.name).join('、') || '无'}）
      </SummaryRow>
      <SummaryRow label="隔离">内置沙箱（默认只读）</SummaryRow>
    </div>
  )
}

/** The agent-level host briefing, editable in place, with draft adoption. */
function HandoffCard(props: { agentId: string }): React.JSX.Element {
  const [text, setText] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<{ exists: boolean; text: string } | undefined>(undefined)
  const [showDraft, setShowDraft] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scheduling, setScheduling] = useState<string | undefined>(undefined)

  const refresh = (): void => {
    void api.handoff(props.agentId).then(result => { setText(result.text) })
    void api.handoffDraft(props.agentId).then(setDraft)
  }
  useEffect(() => {
    setText(undefined)
    setDraft(undefined)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId])

  if (text === undefined) return <></>
  return (
    <div className="card">
      <h2>主人简报</h2>
      <p className="hint">
        每个新访客会话开启时自动注入给模型（进行中的会话不受影响）。推荐写：最近在做什么、关键决定、待办。
      </p>
      {draft !== undefined && draft.exists ? (
        <div className="callout" style={{ marginBottom: 10 }}>
          <div className="row">
            <strong>有一份新草稿待审核</strong>
            <span className="grow" />
            <button className="quiet" onClick={() => { setShowDraft(value => !value) }}>
              {showDraft ? '收起' : '预览'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void api.adoptDraft(props.agentId).then(() => {
                  setBusy(false)
                  refresh()
                })
              }}
            >
              采纳为正式简报
            </button>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void api.dismissDraft(props.agentId).then(() => {
                  setBusy(false)
                  setDraft({ exists: false, text: '' })
                })
              }}
            >
              忽略
            </button>
          </div>
          {showDraft ? <pre className="code" style={{ marginTop: 8 }}>{draft.text}</pre> : null}
        </div>
      ) : null}
      <textarea
        rows={6}
        value={text}
        placeholder="例如：&#10;最近在做 dsh-a2a 升级…&#10;关键决定：出站用 skill…&#10;待办：发版 0.3.0"
        onChange={event => { setText(event.target.value) }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className={saved ? 'primary' : undefined}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.saveHandoff(props.agentId, text).then(() => {
              setBusy(false)
              setSaved(true)
              setTimeout(() => { setSaved(false) }, 2500)
            })
          }}
        >
          {saved ? '已保存 ✓' : '保存简报'}
        </button>
        <span className="small muted">文件位置：&lt;工作区&gt;/.hop/handoff.md</span>
      </div>
      <div className="row" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <strong className="small">自动维护</strong>
        <span className="small muted">让本 agent 每小时自动蒸馏各本地 agent（claude code / codex / zcode / kimi / workbuddy）中与本项目相关的会话，产出草稿待您审核（只读该项目范围，不写正式简报）。</span>
        <span className="grow" />
        <button
          disabled={busy}
          title="需要在线 agent 正在运行"
          onClick={() => {
            setScheduling('正在指示 agent 建立定时任务（最长两分钟）…')
            void api.scheduleBriefing(props.agentId).then(result => {
              setScheduling(result.ok ? `已建立：${result.reply.slice(0, 120)}` : `失败：${result.reply.slice(0, 160)}`)
            })
          }}
        >
          开启定时简报
        </button>
      </div>
      {scheduling !== undefined ? <p className="field-note">{scheduling}</p> : null}
    </div>
  )
}

export function MonitorView(props: {
  agentId: string
  onEdit: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<AgentDetail | undefined>(undefined)
  const [running, setRunning] = useState<boolean | undefined>(undefined)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | undefined>(undefined)
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void api.agent(props.agentId).then(setDetail)
    void api.status(props.agentId).then(status => {
      setRunning(status.running)
      setLogs(status.logs)
    })
    void api.monitor(props.agentId).then(result => {
      if (result.ok) {
        setSnapshot(result.snapshot)
        setReason(undefined)
      } else {
        setSnapshot(undefined)
        setReason(result.reason)
      }
    })
  }

  useEffect(() => {
    setDetail(undefined)
    setSnapshot(undefined)
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId])

  return (
    <>
      {detail !== undefined ? <AgentOverview detail={detail} /> : <p className="muted">加载中…</p>}
      <HandoffCard agentId={props.agentId} />

      <div className="card">
        <div className="row">
          <span className={`dot ${running ? 'on' : 'off'}`} />
          <strong>{running === undefined ? '检测中…' : running ? '在线 agent 运行中' : '在线 agent 未运行'}</strong>
          <span className="grow" />
          {busy ? <span className="small muted">处理中…</span> : null}
          <button
            disabled={busy || running === true}
            onClick={() => {
              setBusy(true)
              void api.start(props.agentId).then(() => { setBusy(false); setTimeout(refresh, 1500) })
            }}
          >
            启动
          </button>
          <button
            disabled={busy || running !== true}
            onClick={() => {
              setBusy(true)
              void api.stop(props.agentId).then(() => { setBusy(false); setTimeout(refresh, 1000) })
            }}
          >
            停止
          </button>
          <button className="quiet" onClick={() => setShowLogs(value => !value)}>{showLogs ? '收起日志' : '看日志'}</button>
          <button className="quiet" onClick={props.onEdit}>编辑配置</button>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => {
              if (detail === undefined || !window.confirm(`删除 Agent「${detail.config.card.name}」？已保存的配置将移除；运行中的实例会先停止。`)) return
              setBusy(true)
              void api.deleteAgent(props.agentId).then(() => { setBusy(false); props.onDeleted() })
            }}
          >
            删除
          </button>
        </div>
        {showLogs ? <pre className="code" style={{ marginTop: 12 }}>{logs.slice(-40).join('\n') || '（暂无日志）'}</pre> : null}
      </div>

      <div className="card">
        <h2>来访记录</h2>
        <p className="hint">谁来访过、说了什么、agent 答了什么（5 秒自动刷新；仅本机可见）。</p>
        {reason !== undefined ? <p className="muted">{reason}</p> : null}
        {snapshot !== undefined && snapshot.contexts.length === 0 ? (
          <p className="muted">还没有访客来过。把地址和令牌发出去，等第一条消息进来。</p>
        ) : null}
        {snapshot?.contexts.map(context => (
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
      </div>
    </>
  )
}
