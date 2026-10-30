import { useEffect, useState } from 'react'
import type { PublicationStatus } from '@talk2myagent/a2a-connector'
import { api, type AgentDetail } from './api.ts'
import { relayHostIssue } from './relayForm.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'

const labels: Record<string, string> = {
  unregistered: '尚未发布', stopped: '已关闭', starting: '正在启动', registering: '正在注册',
  connecting: '正在连接', reconnecting: '正在重连／等待本地 agent', online: '公网已上线', blocked: '发布被拒绝',
}
const message = (error: unknown): string => error instanceof Error ? error.message.replace(/^Error:\s*/, '') : String(error)

export function PublicationCard({ detail, onChanged }: { detail: AgentDetail; onChanged: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<PublicationStatus>()
  const [provider, setProvider] = useState<'default' | 'custom'>(detail.config.network.relay?.provider ?? 'default')
  const [host, setHost] = useState(detail.config.network.relay?.host ?? '')
  const [defaultHost, setDefaultHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [addressCopied, setAddressCopied] = useState(false)
  const peers = detail.config.peers.filter(p => p.trusted)
  const [peer, setPeer] = useState(peers[0]?.name ?? '')
  const online = status?.state === 'online' && status.desiredEnabled
  const issue = provider === 'custom' ? relayHostIssue(host) : undefined
  const pending = status?.desiredEnabled && !online && status.state !== 'blocked'

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void api.publication(detail.id).then(s => {
        if (!disposed) {
          setStatus(s)
          if (s.state !== 'online') { setText(''); setCopied(false); setAddressCopied(false) }
        }
      }).catch(e => { if (!disposed) setError(message(e)) })
    }
    refresh()
    void api.session().then(s => { if (!disposed) setDefaultHost(s.defaultRelayHost) })
      .catch(e => { if (!disposed) setError(message(e)) })
    const timer = setInterval(refresh, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [detail.id])
  useEffect(() => { setText(''); setCopied(false) }, [peer, detail.updatedAt])
  useEffect(() => {
    if (!detail.config.peers.some(p => p.trusted && p.name === peer)) setPeer(detail.config.peers.find(p => p.trusted)?.name ?? '')
  }, [detail.config.peers, peer])

  const toggle = async (enabled: boolean) => {
    setBusy(true); setError(''); setText(''); setCopied(false)
    try { setStatus(await api.setPublication(detail.id, { provider, host, enabled })); onChanged() }
    catch (e) {
      setError(message(e))
      try { setStatus(await api.publication(detail.id)) } catch { /* Keep the useful action error. */ }
    } finally { setBusy(false) }
  }
  const copyInvitation = async () => {
    setBusy(true); setError(''); setCopied(false)
    try {
      const result = await api.invitation(detail.id, peer)
      setText(result.text)
      try { await navigator.clipboard.writeText(result.text); setCopied(true) }
      catch { setError('剪贴板不可用，请手动复制下方完整邀请。') }
    } catch (e) { setText(''); setError(message(e)) }
    finally { setBusy(false) }
  }

  return <CollapsibleCard className="publication-card" label="公网中继" storageKey={`${detail.id}:publication`}
    heading={<><h2>公网中继</h2><p className="hint">自动连接 Relay，让访客从其他网络联系你的 Agent。</p></>}
    status={<span className={`status-pill ${online ? 'ok' : pending ? 'pending' : status?.state === 'blocked' ? 'bad' : ''}`} role="status" aria-live="polite">
        {status ? labels[status.state] ?? status.state : '正在读取状态'}
      </span>}>
    <div className="publication-settings">
      <h3><span className="section-number" aria-hidden="true">1</span>连接服务</h3>
      <label className="field"><span>Relay 服务</span>
        <select aria-label="Relay 服务" value={provider} disabled={busy || status?.desiredEnabled}
          onChange={e => { setProvider(e.target.value as 'default' | 'custom'); setError('') }}>
          <option value="default">默认 Relay{defaultHost ? ` · ${defaultHost}` : '（尚未配置）'}</option>
          <option value="custom">自定义 Relay host</option>
        </select>
      </label>
      {provider === 'custom' ? <label className="field"><span>Relay host</span>
        <input type="text" className="relay-host-input" aria-label="Relay host" aria-describedby="relay-host-help"
          spellCheck={false} autoComplete="url" aria-invalid={!!host && !!issue} value={host} placeholder="https://relay.example.com"
          disabled={busy || status?.desiredEnabled} onChange={e => { setHost(e.target.value); setError('') }} />
        <span id="relay-host-help" className="field-note">只需填写服务入口。Agent 地址和连接凭据会自动生成。</span>
      </label> : null}
      {provider === 'custom' && host && issue && !status?.desiredEnabled ? <p role="alert">{issue}</p> : null}
      <div className="row">
        <button className={status?.desiredEnabled ? 'quiet' : 'primary'}
          disabled={busy || !status || !status.desiredEnabled && (provider === 'default' ? !defaultHost : !!issue)}
          onClick={() => { void toggle(!status?.desiredEnabled) }}>
          {busy ? '处理中…' : status?.desiredEnabled ? '关闭公网发布' : '开启公网发布'}
        </button>
        <span className="small muted">{status?.desiredEnabled ? '关闭发布后，本地 Agent 仍会继续运行。' : provider === 'default' && !defaultHost ? '没有默认服务？选择上方的自定义 Relay。' : '请先启动本地 Agent，再开启发布。'}</span>
      </div>
      <p className="field-note">关闭管理页不影响连接；电脑和本地 Agent 需要保持运行。</p>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {status?.error ? <p className="field-note">{status.error}</p> : null}
    {status?.cloudSyncPending && !status.desiredEnabled ? <p className="field-note">本地转发已关闭，云端状态待同步。</p> : null}
    {online ? <div className="publication-address">
      <div className="grow"><span className="small muted">Agent 访问地址</span><div className="mono public-url" data-testid="relay-url">{status.publicRpcUrl}</div></div>
      <button onClick={() => { void navigator.clipboard.writeText(status.publicRpcUrl ?? '').then(() => setAddressCopied(true), () => setError('剪贴板不可用，请选中上方地址手动复制。')) }}>
        {addressCopied ? '地址已复制' : '复制地址'}
      </button>
    </div> : null}
    <div className="invitation-section">
      <h3><span className="section-number" aria-hidden="true">2</span>邀请访客聊天</h3>
      <p className="field-note">选择访客，将包含访问地址和访客令牌的完整邀请发给对方。</p>
      <div className="invitation-controls">
        <label className="field"><span>邀请访客</span><select aria-label="邀请访客" value={peer} disabled={!peers.length || busy} onChange={e => setPeer(e.target.value)}>
          {!peers.length ? <option value="">尚无获准访客</option> : null}
          {peers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select></label>
        <button className="primary" disabled={busy || !online || !peer} onClick={() => { void copyInvitation() }}>
          {copied ? '邀请已复制' : '复制聊天邀请'}
        </button>
      </div>
      {!online ? <p className="field-note">公网地址在线后即可复制完整邀请。</p> : null}
      {!peers.length ? <p className="field-note">先在“编辑配置 → 访客”中添加一位允许聊天的访客。</p> : null}
      {text ? <pre className="code invitation-preview" data-testid="relay-invitation">{text}</pre> : null}
    </div>
  </CollapsibleCard>
}
