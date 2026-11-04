/** Opt-in real-model acceptance for registration before startup and the new visitor form. */
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {homedir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const out='D:/code/dsh-a2a/qa-artifacts/2026-10-31-registration-ui'
await mkdir(out,{recursive:true})
const live=JSON.parse(await readFile('D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain/info.json','utf8'))
const {csrfToken}=await(await fetch(live.baseURL+'/api/session')).json() as any
const api=async(path:string,method='GET',body?:unknown)=>{
  const r=await fetch(live.baseURL+'/api/'+path,{method,headers:{'content-type':'application/json','x-a2a-csrf':csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const json=await r.json() as any;assert(r.ok,JSON.stringify(json));return json
}
if(process.argv[2]==='setup'){
  const root=join(live.root,'preregistration-public');await mkdir(root,{recursive:true})
  const canary='registered-before-start-'+randomBytes(12).toString('hex')
  await writeFile(join(root,'registration.txt'),canary)
  const created=await api('agents','POST',{card:{name:'先注册再上线',description:'真实模型验证：提前获得中继地址，添加访客后启动。'},models:[{provider:'deepseek',model:'deepseek-flash'}],activeModelIndex:0,
    adminToken:randomBytes(32).toString('hex'),peers:[],isolation:{workspaceRoot:root,peerWorkspaces:{}},network:{mode:'relay',relay:{provider:'default',enabled:true},port:3081}})
  const id=created.record.id
  await api(`agents/${id}/briefing-auto`,'PUT',{enabled:false})
  await writeFile(join(out,'info.json'),JSON.stringify({...live,agentId:id,canary,publicRoot:root},null,2))
  console.log(JSON.stringify({agentId:id,baseURL:live.baseURL,running:await api(`agents/${id}/status`)}))
}else{
  const info=JSON.parse(await readFile(join(out,'info.json'),'utf8'))
  const pub=await api(`agents/${info.agentId}/publication/status`)
  const record=await api(`agents/${info.agentId}`)
  if(process.argv[2]==='status'){
    const previous=await readFile(join(out,'reserved.json'),'utf8').then(JSON.parse).catch(()=>undefined)
    if(pub.publicRpcUrl&&!previous)await writeFile(join(out,'reserved.json'),JSON.stringify({url:pub.publicRpcUrl,agentWasRunning:record.running},null,2))
    if(previous)assert.equal(pub.publicRpcUrl,previous.url)
    console.log(JSON.stringify({running:record.running,state:pub.state,url:pub.publicRpcUrl,visitors:record.config.peers.map((p:any)=>({id:p.name,name:p.displayName,applied:record.appliedPeers.includes(p.name)}))}))
  }else if(process.argv[2]==='auth-before'||process.argv[2]==='auth-after'){
    const results=[]
    for(const name of ['小林','小周']){
      const peer=record.config.peers.find((p:any)=>p.displayName===name);assert(peer)
      const response=await fetch(pub.publicRpcUrl,{method:'POST',headers:{'content-type':'application/json','a2a-version':'1.0',authorization:`Bearer ${peer.token}`},
        body:JSON.stringify({jsonrpc:'2.0',id:'auth-check',method:'ListTasks',params:{}})})
      const body=await response.json() as any
      const expected=name==='小周'&&process.argv[2]==='auth-before'?401:200
      assert.equal(response.status,expected);if(expected===200){assert(!body.error);assert(Array.isArray(body.result.tasks));assert.equal(body.result.tasks.length,name==='小林'?1:0)}
      results.push({name,status:response.status,applied:record.appliedPeers.includes(peer.name),tasks:body.result?.tasks?.length})
    }
    assert.equal(pub.state,'online')
    await writeFile(join(out,process.argv[2]+'.json'),JSON.stringify({url:pub.publicRpcUrl,results},null,2))
    console.log(JSON.stringify(results))
  }else if(process.argv[2]==='evidence'){
    const key=createHash('sha256').update(`${info.publicRoot}\n/a2a\nA2A_ADMIN_TOKEN_AGENT`).digest('hex').slice(0,24)
    const store=join(homedir(),'.dsh-a2a',key)
    const calls=[]
    for(const file of await readdir(store)){
      if(!/^[0-9a-f-]{36}\.json$/.test(file))continue
      const c=JSON.parse(await readFile(join(store,file),'utf8'))
      calls.push(...c.events.filter((e:any)=>e.type==='tool/call').map((e:any)=>({time:e.time,name:e.data.name,args:e.data.arguments})))
    }
    assert(calls.some((c:any)=>c.name==='read_file'&&JSON.stringify(c.args).includes('registration.txt')))
    const peer=record.config.peers.find((p:any)=>p.displayName==='小林');assert(peer)
    const vm=JSON.parse(await readFile(join(info.host,'workspaces',info.agentId,'.microsandbox',peer.name,'record.json'),'utf8'))
    process.env['MSB_HOME']=join(info.sandboxHome,'state');process.env['MSB_BACKEND']='local'
    const sdk=await import(pathToFileURL(join(info.sandboxHome,'sdk-0.7.11-win32-x64/node_modules/microsandbox/dist/index.js')).href)
    const sandbox=await sdk.Sandbox.get(vm.name)
    const config=sandbox.config()
    const evidence={calls,sandbox:{name:vm.name,status:sandbox.status,mounts:config.mounts,network:config.network.enabled}}
    await writeFile(join(out,'sandbox-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence))
  }else if(process.argv[2]==='send'||process.argv[2]==='task'){
    assert.equal(pub.state,'online')
    const peer=record.config.peers.find((p:any)=>p.displayName==='小林')
    assert(peer);assert(record.appliedPeers.includes(peer.name))
    const cli=join(process.env['USERPROFILE']!,'.agents/skills/a2a/bin/a2a.mjs')
    const env={...process.env,A2A_HOME:join(info.root,'preregistration-client'),A2A_PREREG_VISITOR:peer.token}
    const call=(args:string[])=>{const r=spawnSync(process.execPath,[cli,...args],{env,windowsHide:true,encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);return r.stdout}
    if(process.argv[2]==='send'){
      console.log(call(['list']))
      console.log(call(['add','preregistered',pub.publicRpcUrl,'A2A_PREREG_VISITOR','先注册再上线','--card-url',pub.publicCardUrl]))
      console.log(call(['card','preregistered']))
      const text=call(['send','preregistered','这是先注册中继地址、再启动 Agent 的真实验收。请实际使用 read_file 读取公共资料 registration.txt，完整返回文件内容，不能猜测。','--nowait'])
      console.log(text);const taskId=/\[任务 ([^\]]+)\]/.exec(text)?.[1];assert(taskId)
      await writeFile(join(out,'task.json'),JSON.stringify({taskId},null,2))
    }else{
      const task=JSON.parse(await readFile(join(out,'task.json'),'utf8'))
      const text=call(['task','preregistered',task.taskId]);console.log(text)
      await writeFile(join(out,'reply.txt'),text)
      if(text.includes('TASK_STATE_COMPLETED')){assert(text.includes(info.canary));console.log('PASS: reserved URL, newly added visitor and real model sandbox read')}
    }
  }
}
