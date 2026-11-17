import { useEffect, useState } from 'react'
import { api, type CalendarStatus } from './api.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'

const labels: Record<string, string> = { google: 'Google Calendar', feishu: '飞书日历' }
export function CalendarCard({ agentId, running }: { agentId: string; running: boolean | undefined }): React.JSX.Element {
  const [status, setStatus] = useState<CalendarStatus>()
  const [provider, setProvider] = useState('feishu')
  const [phase, setPhase] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const [showGoogleSetup, setShowGoogleSetup] = useState(false)
  const [clientFile, setClientFile] = useState<File>()
  const [fileKey, setFileKey] = useState(0)
  const refresh = async (): Promise<void> => { const value = await api.calendar(agentId); setStatus(value); setWaiting(value.pending); setAuthorizationUrl(value.authorizationUrl || ''); setPhase(value.phase || '') }
  useEffect(() => { void refresh().catch(e => setError(String(e))) }, [agentId])
  useEffect(() => {
    if (!waiting) return
    let active = true, polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void api.pollCalendar(agentId).then(async result => {
        if (!active) return
        if (result.status === 'pending') {
          setPhase(result.phase || '')
          if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl)
        } else if (result.status === 'connected') {
          setWaiting(false); setAuthorizationUrl(''); setError('')
          setMessage(running ? '日历已授权。重新启动 Agent 后启用会议预约工具。' : '日历已授权。下次启动 Agent 时自动启用会议预约工具。')
          await refresh()
        } else if (['failed', 'expired', 'idle'].includes(result.status)) {
          setWaiting(false); setError(result.error || (result.status === 'expired' ? '授权链接已过期，请重新连接。' : '授权未完成，请重试。'))
        }
      }).catch(e => { if (active) setError(String(e)) }).finally(() => { polling = false })
    }, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [waiting, agentId, running])
  const connect = async (importClient = false): Promise<void> => {
    if (provider === 'google' && !status?.googleConfigured && !importClient) {
      setShowGoogleSetup(true); setError(''); setMessage(''); return
    }
    // Open synchronously to avoid popup blockers; the fallback link remains available.
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    setBusy(true); setError(''); setMessage('')
    try {
      if (importClient) {
        if (!clientFile || clientFile.size > 65536) throw new Error('请选择 Google 客户端 JSON 文件，大小不超过 64 KiB。')
        let document: unknown
        try { document = JSON.parse(await clientFile.text()) } catch { throw new Error('文件不是有效的 JSON，请重新下载并选择 Google 客户端配置。') }
        await api.importGoogleClient(agentId, document)
        setClientFile(undefined); setFileKey(key => key + 1); setShowGoogleSetup(false)
        await refresh()
      }
      const result = await api.connectCalendar(agentId, provider)
      setAuthorizationUrl(result.authorizationUrl); setPhase(provider === 'feishu' ? 'creating_app' : 'authorizing'); setWaiting(true)
      if (popup) popup.location.href = result.authorizationUrl
    } catch (e) { popup?.close(); setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const disconnect = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await api.disconnectCalendar(agentId)
      setWaiting(false); setAuthorizationUrl('')
      setMessage('已删除本机日历授权，Agent 不再具有预约权限。已有日程保留；如需撤销应用授权，可前往日历平台。')
      await refresh()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <CollapsibleCard label="日历授权" storageKey={`${agentId}:calendar`}
    heading={<><h2>日历授权</h2><p className="hint">连接一个日历，允许 Agent 与访客商量时间并自动预约。启动 Agent 时启用。</p></>}
    status={status?.connected ? <span className="chip ok">已连接</span> : undefined}>
    {status?.connected || status?.needsReconnect ? <>
      <p><strong>{labels[status.provider || '']}</strong> · {status.label}</p>
      {status.needsReconnect ? <p className="hint">旧版连接需要解除后重新在本机授权。</p> : null}
      <button disabled={busy} onClick={() => { void disconnect() }}>解除日历连接</button>
    </> : <>
      <label htmlFor={`calendar-provider-${agentId}`}>日历渠道</label>
      <div className="row">
        <select id={`calendar-provider-${agentId}`} value={provider} onChange={e => { setProvider(e.target.value); setShowGoogleSetup(false); setClientFile(undefined); setFileKey(key => key + 1); setError('') }} disabled={busy || waiting}>
          {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button className="primary" disabled={busy || waiting || !status} onClick={() => { void connect() }}>
          {waiting ? '等待平台授权…' : '连接日历'}
        </button>
      </div>
      {provider === 'feishu' ? <p className="hint">先在飞书确认创建专属应用，再确认日历授权。企业策略可能需要管理员批准应用权限。</p> : null}
      {provider === 'google' && !waiting ? <>
        <p className="hint">{status?.googleConfigured ? '已保存此 Agent 的 Google 配置，可直接登录授权。' : '首次连接时，导入你自己的 Google 桌面应用配置；之后只需登录授权。'}</p>
        {status?.googleConfigured && !showGoogleSetup ? <button disabled={busy} onClick={() => setShowGoogleSetup(true)}>更换 Google 配置</button> : null}
        {showGoogleSetup ? <div role="group" aria-labelledby={`google-setup-${agentId}`} className="google-calendar-setup">
          <h3 id={`google-setup-${agentId}`}>首次连接 Google Calendar</h3>
          <p>配置由你自己持有，只保存在本机。已有下载好的客户端 JSON，可直接选择文件。</p>
          <ol>
            <li>打开 <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud</a> 创建或选择项目，在该项目中启用 <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Calendar API</a>。</li>
            <li>在 <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noreferrer">Google Auth Platform</a> 配置应用信息；个人账号选择 External（外部）。测试模式下，在 Audience 中将自己的邮箱添加为测试用户。</li>
            <li>到 <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> 创建 Desktop app（桌面应用）客户端，下载 JSON 文件。</li>
          </ol>
          <label htmlFor={`google-client-${agentId}`}>Google 客户端 JSON</label>
          <input key={fileKey} id={`google-client-${agentId}`} type="file" accept=".json,application/json" disabled={busy}
            onChange={e => { setClientFile(e.target.files?.[0]); setError('') }} />
          <p className="hint">文件只发送给本机 Portal，配置加密保存。无需手动复制 Client ID 或密钥，也不用配置环境变量。</p>
          <div className="row">
            <button className="primary" disabled={busy || !clientFile} onClick={() => { void connect(true) }}>{busy ? '正在处理…' : '保存配置并授权'}</button>
            <button disabled={busy} onClick={() => { setShowGoogleSetup(false); setClientFile(undefined); setFileKey(key => key + 1); setError('') }}>取消</button>
          </div>
        </div> : null}
      </> : null}
      {waiting ? <><p className="hint">{phase === 'creating_app' ? '第 1 步：在飞书创建本机使用的应用。' : provider === 'feishu' ? '第 2 步：应用已准备好，请点击下方链接同意日历权限。' : '请在平台页面同意日历权限，授权后返回本页。'}</p><div className="row" style={{ marginTop: 12 }}>
        {authorizationUrl ? <a href={authorizationUrl} target="_blank" rel="noreferrer">{provider === 'feishu' && phase === 'authorizing' ? '继续授权飞书日历' : '打开平台授权页面'}</a> : <span className="hint">请在已打开的平台页面完成授权。</span>}
        <button disabled={busy} onClick={() => { void disconnect() }}>取消连接</button>
      </div></> : null}
    </>}
    <p className="hint">授权凭据加密保存在本机，日历由本机 Agent 直接调用，无需另外部署服务。Portal 关闭后仍可预约。</p>
    <p className="hint">访客确认后自动创建日程。预约时间偏好由主人在 Agent 启动配置中设置。</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert" className="error">{error}</p> : null}
  </CollapsibleCard>
}
