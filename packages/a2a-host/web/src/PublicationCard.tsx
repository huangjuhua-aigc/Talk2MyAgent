import { useEffect, useState } from 'react'
import type { PublicationStatus } from '@talk2myagent/a2a-connector'
import { api, type AgentDetail } from './api.ts'
import { relayHostIssue } from './relayForm.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'
import { isContactId } from '../../src/contact-id.ts'

const labels: Record<string,string> = { unregistered:'尚未获取地址', registered:'地址已分配', starting:'正在启动', registering:'正在注册', connecting:'正在连接', reconnecting:'正在重连／等待本地 agent', online:'公网已上线', blocked:'发布被拒绝' }
const message = (e: unknown) => e instanceof Error ? e.message.replace(/^Error:\s*/, '') : String(e)
export function PublicationCard({ detail, onChanged }: { detail: AgentDetail; onChanged: () => void }): React.JSX.Element {
  const [status,setStatus] = useState<PublicationStatus>()
  const [provider,setProvider] = useState<'default'|'custom'>(detail.config.network.relay?.provider ?? 'default')
  const [host,setHost] = useState(detail.config.network.relay?.host ?? '')
  const [contactId,setContactId] = useState(detail.config.network.relay?.contactId ?? '')
  const [defaultHost,setDefaultHost] = useState('')
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [copied,setCopied] = useState(false)
  const online = status?.state === 'online' && status.desiredEnabled
  const configured = detail.config.network.mode === 'relay' && detail.config.network.relay?.enabled === true
  const origin = (provider === 'custom' ? host.trim() : defaultHost).replace(/\/$/,'')
  const hasAddress = !!status?.publicRpcUrl && status.relayOrigin === origin
  const enabled = !!status?.desiredEnabled || configured && hasAddress
  const waiting = hasAddress && configured && !status?.desiredEnabled
  const issue = provider === 'custom' ? relayHostIssue(host) : undefined
  const fixedNumber = hasAddress && isContactId(status?.contactId)
  const numberInvalid = !fixedNumber && !isContactId(contactId.trim())
  useEffect(() => {
    let disposed=false
    const refresh=()=>{void api.publication(detail.id).then(s=>{if(!disposed)setStatus(s)}).catch(e=>{if(!disposed)setError(message(e))})}
    refresh();void api.session().then(s=>{if(!disposed)setDefaultHost(s.defaultRelayHost)}).catch(e=>{if(!disposed)setError(message(e))})
    const timer=setInterval(refresh,1000)
    return()=>{disposed=true;clearInterval(timer)}
  },[detail.id])
  const toggle=async(value:boolean)=>{
    setBusy(true);setError('');setCopied(false)
    try{setStatus(await api.setPublication(detail.id,{provider,host,enabled:value,
      ...(!fixedNumber && isContactId(contactId.trim()) ? {contactId:contactId.trim()} : {})}));onChanged()}
    catch(e){setError(message(e));try{setStatus(await api.publication(detail.id))}catch{/* keep action error */}}
    finally{setBusy(false)}
  }
  const resetIdentity=async()=>{
    if(!window.confirm('重置会停用旧地址和邀请，原编号仍被保留，不能重新申请。之后需填写另一个未占用的手机号编号。确定重置 Relay 身份吗？'))return
    setBusy(true);setError('');setCopied(false)
    try{setStatus(await api.resetPublication(detail.id));setContactId('');onChanged()}
    catch(e){setError(message(e))}
    finally{setBusy(false)}
  }

  return <CollapsibleCard className="publication-card" label="公网中继" storageKey={`${detail.id}:publication`}
    heading={<><h2>公网中继</h2><p className="hint">先获取固定地址，稍后启动 Agent 自动上线。</p></>}
    status={status?.state === 'stopped' && !waiting ? null : <span className={`status-pill ${online?'ok':waiting||status?.desiredEnabled?'pending':''}`} role="status" aria-live="polite">
      {waiting?'地址已分配 · 待 Agent 启动':status?labels[status.state]??status.state:'正在读取状态'}</span>}>
    <div className="publication-settings">
      <label className="field"><span>Relay 服务</span><select aria-label="Relay 服务" value={provider} disabled={busy||enabled} onChange={e=>{setProvider(e.target.value as 'default'|'custom');setError('')}}>
        <option value="default">默认 Relay{defaultHost?` · ${defaultHost}`:'（尚未配置）'}</option><option value="custom">自定义 Relay host</option>
      </select></label>
      {provider==='custom'?<label className="field"><span>Relay host</span>
        <input className="relay-host-input" aria-label="Relay host" aria-describedby="relay-host-help" spellCheck={false} autoComplete="url" value={host} placeholder="https://relay.example.com" aria-invalid={!!host&&!!issue} disabled={busy||enabled} onChange={e=>{setHost(e.target.value);setError('')}}/>
        <span id="relay-host-help" className="field-note">填写服务入口即可，Agent 访问路径会自动分配。</span></label>:null}
      {provider==='custom'&&host&&issue&&!enabled?<p role="alert">{issue}</p>:null}
      <label className="field"><span>手机号（公开编号）</span>
        <input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={11} placeholder="13812345678" aria-label="手机号（公开编号）"
          aria-describedby="relay-number-help" aria-invalid={!fixedNumber&&!!contactId&&numberInvalid} value={fixedNumber?status!.contactId:contactId}
          readOnly={fixedNumber} disabled={busy||enabled} onChange={e=>{setContactId(e.target.value);setError('')}}/>
        <span id="relay-number-help" className="field-note">{fixedNumber?'已登记，编号固定；关闭发布仍会保留。':'填写自己的 11 位手机号，将公开显示在 Agent 地址和邀请中。暂不验证号码归属；已占用号码不可重复注册。'}</span>
      </label>
      {!fixedNumber&&contactId&&numberInvalid?<p role="alert">请填写有效的 11 位手机号。</p>:null}
      <div className="row"><button className={enabled?'quiet':'primary'} disabled={busy||!status||!enabled&&(numberInvalid||(provider==='default'?!defaultHost:!!issue))} onClick={()=>{void toggle(!enabled)}}>
        {busy?'处理中…':enabled?'关闭公网发布':hasAddress?'开启公网发布':'获取中继地址'}</button>
        <span className="small muted">{enabled?'关闭发布会保留地址，本地 Agent 仍会继续运行。':provider==='default'&&!defaultHost?'没有默认服务？选择上方的自定义 Relay。':'无需启动 Agent，也可以先分配地址。'}</span></div>
      {status&&!enabled&&status.state!=='unregistered'?<div className="row">
        <button className="quiet" disabled={busy} onClick={()=>{void resetIdentity()}}>重置 Relay 身份</button>
        <span className="small muted">Relay 数据丢失或一直显示“发布被拒绝”时使用；会生成新的公网地址和编号。</span>
      </div>:null}
    </div>
    {error?<p role="alert">{error}</p>:null}
    {hasAddress&&!isContactId(status?.contactId)?<div className="row"><p className="field-note">中继地址已保存，等待 Relay 分配通讯录编号。</p><button disabled={busy} onClick={()=>{void toggle(true)}}>同步中继编号</button></div>:null}
    {status?.error?<p className="field-note">{status.error}</p>:null}
    {status?.cloudSyncPending&&!status.desiredEnabled?<p className="field-note">本地转发已关闭，云端状态待同步。</p>:null}
    {hasAddress?<><div className="publication-address"><div className="grow"><span className="small muted">Agent 固定访问地址</span><div className="mono public-url" data-testid="relay-url">{status?.publicRpcUrl}</div></div>
      <button onClick={()=>{void navigator.clipboard.writeText(status?.publicRpcUrl??'').then(()=>setCopied(true),()=>setError('剪贴板不可用，请选中上方地址手动复制。'))}}>{copied?'地址已复制':'复制地址'}</button></div>
      <p className="field-note">{online?'已连接，可以在下方邀请访客聊天。':configured?'地址已保存。启动 Agent 后自动使用这个地址；现在可以提前复制邀请。':'地址已保留。重新开启发布并启动 Agent 后，访客即可连接。'}</p></>:null}
    <p className="field-note">关闭管理页不影响连接；接待访客时，电脑和本地 Agent 需要保持运行。</p>
  </CollapsibleCard>
}
