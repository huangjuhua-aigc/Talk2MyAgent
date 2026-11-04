import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPortal } from './support/portal.ts'
import { newVisitor } from '../src/visitors.ts'
import { recordRuntime } from '../src/publication.ts'
import { join } from 'node:path'

test('adding a named visitor validates identities and credentials, preserves config, and keeps old applied visitors', async()=>{
  const portal=await startPortal(1), agent=portal.agents[0]!.record
  const previousHost=process.env['A2A_HOST_HOME'], previousDsh=process.env['DSH_HOME']
  try {
    process.env['A2A_HOST_HOME']=portal.host;process.env['DSH_HOME']=join(portal.root,'dsh')
    await recordRuntime(agent,{host:'127.0.0.1',port:agent.config.network.port})
    const {csrfToken}=await(await fetch(portal.baseURL+'/api/session')).json() as {csrfToken:string}
    const url=`${portal.baseURL}/api/agents/${agent.id}/visitors`
    assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403)
    const add=(body:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-a2a-csrf':csrfToken},body:JSON.stringify(body)})
    for(const body of [{displayName:''},{displayName:'alice'},{displayName:'\n',token:'abc'}, {displayName:'新访客',token:'short'},
      {displayName:'新访客',token:agent.config.adminToken},{displayName:'新访客',token:agent.config.peers[0]!.token}])assert.equal((await add(body)).status,400)
    const responses=await Promise.all([add({displayName:'小林',token:'distinct-test-token-001'}),add({displayName:'小林',token:'distinct-test-token-002'})])
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,400])
    const record=await portal.readRecord(agent.id), peer=record.config.peers[1]!
    assert.equal(peer.displayName,'小林');assert.match(peer.name,/^visitor-[a-f0-9]+$/);assert.equal(peer.trusted,true)
    assert.deepEqual(record.config.peers[0],agent.config.peers[0]);assert.deepEqual(record.config.isolation,agent.config.isolation)
    const detail=await(await fetch(`${portal.baseURL}/api/agents/${agent.id}`)).json() as {appliedPeers:string[]}
    assert.deepEqual(detail.appliedPeers,['alice'])
    const generated=newVisitor(record,{displayName:'自动生成'});assert.match(generated.token,/^[a-f0-9]{64}$/)
    assert.throws(()=>newVisitor(record,{displayName:'小林',token:'different-long-token'}),/同名/)
  } finally {
    if(previousHost===undefined)delete process.env['A2A_HOST_HOME'];else process.env['A2A_HOST_HOME']=previousHost
    if(previousDsh===undefined)delete process.env['DSH_HOME'];else process.env['DSH_HOME']=previousDsh
    await portal.close()
  }
})
