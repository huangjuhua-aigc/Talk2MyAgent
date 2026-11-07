import { useEffect, useRef, useState } from 'react'
import { api, newToken, type AgentDetail } from './api.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'
import { StartupNotice } from './StartupNotice.tsx'
import { isContactId } from '../../src/contact-id.ts'

type InvitationPreview = { audience: 'public' | 'peer'; text: string; notice: string; copied: boolean; error: string }

async function copyToClipboard(text: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Clipboard permission timed out')), 5000)
    })])
  } finally { clearTimeout(timer) }
}

export function VisitorsCard({detail,running,agentBusy,onBusyChange,onChanged}:{detail:AgentDetail;running:boolean;agentBusy:boolean;onBusyChange:(value:boolean)=>void;onChanged:()=>void}):React.JSX.Element {
  const peers=detail.config.peers.filter(p=>p.trusted)
  const [peer,setPeer]=useState(peers[0]?.name??''), [pendingSelection,setPendingSelection]=useState('')
  const [hasAddress,setHasAddress]=useState(detail.config.network.mode!=='relay')
  const [contactId,setContactId]=useState('')
  const [editing,setEditing]=useState(false), [displayName,setDisplayName]=useState(''), [token,setToken]=useState(''), [showToken,setShowToken]=useState(false)
  const [busy,setBusy]=useState(false), [restarting,setRestarting]=useState(false), [error,setError]=useState(''), [saved,setSaved]=useState('')
  const [invitation,setInvitation]=useState<InvitationPreview>()
  const [copying,setCopying]=useState(false), copySequence=useRef(0)
  const [publicAccess,setPublicAccess]=useState<{enabled:boolean;requiresRestart:boolean}|null>(null)
  const [accessError,setAccessError]=useState(''), [accessReload,setAccessReload]=useState(0)
  useEffect(()=>{
    let disposed=false
    let controller:AbortController|undefined, retry:ReturnType<typeof setTimeout>|undefined
    setPublicAccess(null);setAccessError('')
    const load=async()=>{
      controller=new AbortController()
      const deadline=setTimeout(()=>controller?.abort(),10000)
      try{const value=await api.publicVisitors(detail.id,controller.signal);if(!disposed){setPublicAccess(value);setAccessError('')}}
      catch{if(!disposed){setAccessError('无法读取公开访客设置，稍后会自动重试，也可以手动重试。');retry=setTimeout(()=>{void load()},5000)}}
      finally{clearTimeout(deadline)}
    }
    void load()
    return()=>{disposed=true;clearTimeout(retry);controller?.abort()}
  },[detail.id,running,accessReload])
  const togglePublic=async(enabled:boolean)=>{
    setBusy(true);setError('');setSaved('')
    try{const result=await api.setPublicVisitors(detail.id,enabled);setPublicAccess(result);copySequence.current++;setCopying(false);setInvitation(undefined)
      setSaved(result.requiresRestart?'设置已保存，请升级插件并重启 Agent 后生效。':running?'公开访客设置已生效。':'设置已保存，下次启动 Agent 时生效。')
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  const pending=!!peer&&!detail.appliedPeers?.includes(peer)
  useEffect(()=>{
    if(pendingSelection&&peers.some(p=>p.name===pendingSelection)){setPeer(pendingSelection);setPendingSelection('')}
    else if(!peers.some(p=>p.name===peer))setPeer(peers[0]?.name??'')
  },[detail.config.peers,pendingSelection,peer])
  useEffect(()=>{copySequence.current++;setCopying(false);setInvitation(undefined);return()=>{copySequence.current++}},[peer,detail.updatedAt,contactId])
  useEffect(()=>{
    if(detail.config.network.mode!=='relay'){setHasAddress(true);setContactId('');return}
    let disposed=false
    const refresh=()=>{void Promise.all([api.publication(detail.id),api.session()]).then(([s,session])=>{
      const relay=detail.config.network.relay
      const expected=(relay?.provider==='custom'?relay.host:session.defaultRelayHost)?.trim().replace(/\/$/,'')
      if(!disposed){const valid=s.relayOrigin===expected&&isContactId(s.contactId);setContactId(valid?s.contactId!:'');setHasAddress(valid&&!!s.publicRpcUrl&&!!s.publicCardUrl)}
    }).catch(()=>{if(!disposed){setHasAddress(false);setContactId('')}})}
    refresh();const timer=setInterval(refresh,1000);return()=>{disposed=true;clearInterval(timer)}
  },[detail.id,detail.config.network.mode,detail.config.network.relay?.provider,detail.config.network.relay?.host])
  const copy=async(publicAccess=false)=>{
    const sequence=++copySequence.current
    setCopying(true);setInvitation(undefined)
    const preview:InvitationPreview={audience:publicAccess?'public':'peer',text:'',notice:'',copied:false,error:''}
    try{const result=await api.invitation(detail.id,publicAccess?'__public__':peer);if(sequence!==copySequence.current)return
      Object.assign(preview,{text:result.text,notice:result.notice});setInvitation({...preview})
      try{await copyToClipboard(result.text);if(sequence===copySequence.current)setInvitation({...preview,copied:true})}
      catch{if(sequence===copySequence.current)setInvitation({...preview,error:'剪贴板不可用或等待超时，请手动复制下方完整邀请。'})}
    }catch(e){if(sequence===copySequence.current)setInvitation({...preview,error:(e as Error).message})}finally{if(sequence===copySequence.current)setCopying(false)}
  }
  const add=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setError('');setSaved('')
    try{const result=await api.addVisitor(detail.id,displayName,token);setPendingSelection(result.peer.name);setEditing(false);setToken('');setDisplayName('');setShowToken(false)
      setSaved(`已添加「${result.peer.displayName}」。${result.applied?'已立即生效，无需重启。':result.requiresRestart?'配置已保存，当前 Agent 未确认应用；升级插件并重启后生效，现有访客仍可使用。':'下次启动 Agent 时生效。'}`);onChanged()
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  const restart=async()=>{
    setBusy(true);onBusyChange(true);setRestarting(true);setError('')
    try{await api.stop(detail.id);await api.start(detail.id);setSaved('Agent 已重启，访客配置已应用。');onChanged()}
    catch(e){setError((e as Error).message)}finally{setBusy(false);onBusyChange(false);setRestarting(false);onChanged()}
  }
  const preview=invitation?<>
    {invitation.notice?<p className="field-note">{invitation.notice}</p>:null}
    {invitation.error?<p role="alert">{invitation.error}</p>:null}
    {invitation.text?<pre className="code invitation-preview" data-testid="relay-invitation" aria-label={invitation.audience==='public'?'公开邀请指令':'访客邀请指令'}>{invitation.text}</pre>:null}
  </>:null
  return <CollapsibleCard label="邀请访客聊天" className="visitors-card" storageKey={`${detail.id}:invitations`}
      heading={<><h2>邀请访客聊天</h2><p className="hint">每位访客有独立 Token 和私有工作区，共享资料只读。</p></>}
    status={<span className="chip">{peers.length} 位访客</span>}>
    {agentBusy?<p role="status" className="field-note">Agent 正在启动或停止，完成后可修改访客设置。</p>:!running?<p className="field-note">Agent 未启动，仍可设置公开访问和添加访客；保存后下次启动生效。</p>:null}
    <div className="public-visitors-setting">
      <label className="row"><input type="checkbox" role="switch" aria-label="允许公开访客" checked={publicAccess?.enabled??false}
        disabled={busy||agentBusy||!publicAccess} onChange={e=>{void togglePublic(e.target.checked)}}/><strong>允许公开访客</strong></label>
      {accessError?<div><p role="alert" className="field-note">{accessError}</p><button onClick={()=>setAccessReload(value=>value+1)}>重新读取访客设置</button></div>:!publicAccess?<p role="status" className="field-note">正在读取公开访客设置…</p>:null}
      <p className="field-note">无需预先邀请，系统为每个客户端分配独立身份。每位公开访客累计可发送 5 次消息；换对话或重启不会重置额度。受邀访客不受此额度影响。</p>
      <p className="small muted">公开访客可读取共享资料和公开简报，聊天记录及私有工作区相互隔离。清除客户端凭据后可能创建新身份；此额度不等于每人限额。关闭后拒绝后续公开访问，已接收的任务可继续完成。</p>
      {publicAccess?.requiresRestart?<p role="status" className="field-note">当前 Agent 需要升级插件并重启，才能应用此开关。</p>:null}
      {publicAccess?.enabled?<button disabled={busy||copying||!hasAddress||publicAccess.requiresRestart} onClick={()=>{void copy(true)}}>{invitation?.audience==='public'&&invitation.copied?'公开邀请已复制':'复制公开邀请'}</button>:null}
      {invitation?.audience==='public'?preview:null}
    </div>
    {contactId?<p className="field-note">Agent 通讯录 ID：<strong className="mono" data-testid="agent-contact-id">{contactId}</strong> · Relay 已登记，未验证手机号归属</p>:detail.config.network.mode==='relay'?<p className="field-note">通讯录编号将在 Relay 注册成功后显示。</p>:null}
    {peers.length?<div className="invitation-controls"><label className="field"><span>邀请访客</span><select aria-label="邀请访客" value={peer} disabled={busy} onChange={e=>{setPeer(e.target.value);setSaved('')}}>
      {peers.map(p=><option key={p.name} value={p.name}>{p.displayName??p.name}</option>)}</select></label>
      <button className="primary" disabled={busy||copying||!hasAddress||!peer} onClick={()=>{void copy()}}>{invitation?.audience==='peer'&&invitation.copied?'邀请已复制':'复制聊天邀请'}</button></div>
      :<div className="empty-message">还没有访客。添加第一位访客，即可生成专属聊天邀请。</div>}
    {!hasAddress?<p className="field-note">先在上方获取中继地址和编号；已有旧地址时点击「同步中继编号」。无需启动 Agent。</p>:null}
    {pending?<div className="visitor-pending"><span>{agentBusy?'正在更新 Agent 运行状态…':running?'所选访客待重启生效。':'所选访客将在 Agent 启动后生效。'}</span>
      {running?<><button disabled={busy||agentBusy} onClick={()=>{void restart()}}>重启并应用</button><span className="small muted">重启会结束进行中的对话任务。</span></>:null}</div>:null}
    {invitation?.audience==='peer'?preview:null}
    {saved?<p role="status" className="field-note">{saved}</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {restarting?<StartupNotice agentId={detail.id}/>:null}
    <div className="visitor-add-area">
      {!editing?<button className="visitor-add-button" aria-label="添加新访客" onClick={()=>{setEditing(true);setDisplayName('');setToken(newToken());setShowToken(false);setError('');setSaved('')}} disabled={busy||agentBusy}><span aria-hidden="true">＋</span> 添加访客</button>:
        <form onSubmit={e=>{void add(e)}} aria-label="添加访客表单">
          <h3>添加新访客</h3>
          <label className="field"><span>姓名</span><input autoFocus aria-label="访客姓名" autoComplete="off" maxLength={80} value={displayName} disabled={busy} onChange={e=>setDisplayName(e.target.value)} placeholder="例如：小林" required/></label>
          <label className="field"><span>Token</span><input className="mono" aria-label="访客 Token" type={showToken?'text':'password'} autoComplete="new-password" spellCheck={false} maxLength={512} value={token} disabled={busy} onChange={e=>setToken(e.target.value)} required/>
            <span className="field-note">已自动生成，也可以填写自己的 Token。它是这位访客的访问凭据。</span></label>
          <div className="row"><button type="button" className="quiet" disabled={busy} onClick={()=>setShowToken(v=>!v)}>{showToken?'隐藏 Token':'显示 Token'}</button>
            <button type="button" className="quiet" disabled={busy} onClick={()=>setToken(newToken())}>重新生成 Token</button></div>
          <p className="field-note">添加后允许聊天和读取共享资料；不会开放执行命令或修改共享资料。</p>
          <div className="row"><button type="submit" className="primary" disabled={busy||agentBusy||!displayName.trim()||token.length<16}>{busy?'正在保存…':'保存访客'}</button>
            <button type="button" disabled={busy} onClick={()=>{setEditing(false);setToken('');setShowToken(false);setError('')}}>取消</button></div>
        </form>}
    </div>
  </CollapsibleCard>
}
