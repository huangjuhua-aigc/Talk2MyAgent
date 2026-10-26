import { useEffect, useState } from 'react'
import { api } from './api.ts'
import type { HandoffSnapshot } from '../../src/types.ts'

/** Show the live briefing while keeping any manual edit separate from polling. */
export function HandoffCard(props: { agentId: string }): React.JSX.Element {
  const [live, setLive] = useState<HandoffSnapshot>()
  const [editing, setEditing] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [changingAutomatic, setChangingAutomatic] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let canceled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await api.handoff(props.agentId)
        if (!canceled) { setLive(result); setLoadError(undefined) }
      } catch (error) {
        if (!canceled) setLoadError(`简报读取失败：${String(error)}`)
      } finally {
        if (!canceled) timer = setTimeout(() => { void poll() }, 5000)
      }
    }
    void poll()
    return () => { canceled = true; clearTimeout(timer) }
  }, [props.agentId, refresh])

  const save = async (): Promise<void> => {
    if (editing === undefined) return
    setSaving(true)
    setNotice(undefined)
    try {
      const result = await api.saveHandoff(props.agentId, editing)
      if (!result.saved) throw new Error('简报未保存')
      setEditing(undefined)
      setNotice('简报已保存。')
      setRefresh(value => value + 1)
    } catch (error) { setNotice(`保存失败：${String(error)}`) }
    finally { setSaving(false) }
  }

  const toggleAutomatic = async (enabled: boolean): Promise<void> => {
    setChangingAutomatic(true)
    setNotice(undefined)
    try {
      const result = await api.setAutomaticBriefing(props.agentId, enabled)
      setLive(previous => previous ? { ...previous, autoUpdateEnabled: result.enabled } : previous)
      setNotice(result.enabled ? '自动更新已开启，在线 agent 将自动整理简报。' : '自动更新已关闭，现有简报已保留。已开始的一次更新会完成。')
      setRefresh(value => value + 1)
    } catch (error) { setNotice(`设置失败：${String(error)}`) }
    finally { setChangingAutomatic(false) }
  }

  return (
    <div className="card">
      <h2>公开简报</h2>
      <p className="hint">
        自动更新完成后直接公开，无需确认。每个新访客会话开启时自动加载最新版；进行中的会话不会自动更新。
      </p>
      <div className="small muted" style={{ marginBottom: 8 }}>
        {live?.updatedAt ? `最近更新：${new Date(live.updatedAt).toLocaleString()}` : '尚无更新时间'} · 每 5 秒自动刷新
      </div>
      {live === undefined
        ? <p className="muted">正在加载简报…</p>
        : live.text
          ? <pre className="code" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{live.text}</pre>
          : <p className="muted">暂无简报。自动更新默认开启，agent 在线后会整理；也可以手动填写。</p>}
      {loadError ? <p className="field-note" role="alert">{loadError}</p> : null}
      {editing === undefined ? (
        <button className="quiet" disabled={live === undefined} onClick={() => { setEditing(live?.text ?? ''); setNotice(undefined) }}>
          编辑简报
        </button>
      ) : (
        <>
          <p className="hint">正在手动编辑，自动刷新会保留你的未保存内容；保存后会覆盖当前公开简报。</p>
          <textarea aria-label="编辑公开简报" rows={8} value={editing} disabled={saving} onChange={event => setEditing(event.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={saving} onClick={() => { void save() }}>{saving ? '保存中…' : '保存简报'}</button>
            <button className="quiet" disabled={saving} onClick={() => setEditing(undefined)}>取消编辑</button>
          </div>
        </>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>文件位置：&lt;工作区&gt;/.hop/handoff.md</div>
      <div className="row" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" role="switch" aria-label="自动更新简报" checked={live?.autoUpdateEnabled ?? true}
            disabled={live === undefined || changingAutomatic} onChange={event => { void toggleAutomatic(event.target.checked) }} />
          <strong className="small">自动更新简报</strong>
        </label>
        <span className="small muted">默认开启，每小时更新一次；关闭 Portal 页面后仍会继续。agent 离线时暂停。</span>
        <span className="grow" />
        <span className="small muted">{changingAutomatic ? '保存中…' : live?.autoUpdateEnabled === false ? '已关闭' : '已开启'}</span>
      </div>
      {notice ? <p className="field-note" role="status">{notice}</p> : null}
    </div>
  )
}
