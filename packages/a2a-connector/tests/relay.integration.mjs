import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { Connector, control } from '../src/connector.mjs'
import { configure, register, setEnabled, status, command, ensureDaemon, resetIdentity } from '../src/manager.mjs'
if (!process.env.A2A_RELAY_SOURCE) throw new Error('Set A2A_RELAY_SOURCE to the independent Relay repository')
const { createRelay } = await import(pathToFileURL(join(process.env.A2A_RELAY_SOURCE, 'src/server.mjs')))
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, timeout = 10000) { const start = Date.now(); while (!await fn()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await sleep(25) } }
async function fixture() {
  let calls = 0, receivedAuth, aborted = 0, hangResponse
  const card = { name: '测试 Agent', supportedInterfaces: [{ url:'http://localhost/a2a', protocolBinding:'JSONRPC', protocolVersion:'1.0' }],
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, securityRequirements: [{ bearer: [] }], capabilities: { streaming:true }, skills: [] }
  const local = createServer(async (req,res) => {
    if (req.url === '/.well-known/agent-card.json') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(card)); return }
    if (req.url !== '/a2a') { res.writeHead(500); res.end('private'); return }
    calls++; receivedAuth = req.headers.authorization
    if (receivedAuth !== 'Bearer visitor') { res.writeHead(401, { 'www-authenticate':'Bearer' }); res.end('denied'); return }
    let data = ''; for await (const c of req) data += c
    const rpc = JSON.parse(data)
    if (rpc.method === 'GetExtendedAgentCard') { res.end(JSON.stringify({ jsonrpc:'2.0', id:1, result:card })); return }
    if (rpc.method === 'hang') { hangResponse = res; res.on('close', () => { aborted++ }); return }
    if (rpc.method === 'stream') {
      res.writeHead(200, { 'content-type':'text/event-stream', 'set-cookie':'private=never', 'x-private-header':'never' })
      const bytes = Buffer.from('data: {"text":"你好，🌈"}\n\n'.repeat(20000))
      // Split deliberately inside multibyte code points and send well beyond the credit window.
      res.write(bytes.subarray(0, 17)); setImmediate(() => res.end(bytes.subarray(17))); return
    }
    res.end(JSON.stringify({ jsonrpc:'2.0', id:rpc.id, result:{ text:'你好，🌈', received: data.length } }))
  })
  await new Promise(r => local.listen(0,'127.0.0.1',r))
  const reservation = createServer(); await new Promise(r => reservation.listen(0,'127.0.0.1',r)); const port = reservation.address().port; await new Promise(r => reservation.close(r))
  const origin = `http://127.0.0.1:${port}`, relay = createRelay({ origin, allowHttp:true, requestsPerMinute:1000 })
  await new Promise(r => relay.server.listen(port,'127.0.0.1',r))
  const base = `http://127.0.0.1:${local.address().port}`
  const config = { relayOrigin:origin, localRpcUrl:`${base}/a2a`, localCardUrl:`${base}/.well-known/agent-card.json`, displayName:'test', allowHttp:true }
  return { relay, local, config, card, get calls(){return calls}, get receivedAuth(){return receivedAuth}, get aborted(){return aborted}, get hangResponse(){return hangResponse},
    async close(){ local.closeAllConnections(); await new Promise(r => local.close(r)); await relay.close() } }
}
test('real HTTP/WS: cards, auth, Unicode SSE, capacity, reconnect, no replay and revocation', async () => {
  const f = await fixture(), state = { registrations:{}, desiredEnabled:true, revision:1, operationId:randomUUID(), cloudSyncPending:true }
  let snapshot, writes = 0
  const c = new Connector({ config:f.config, state, save:async()=>{writes++}, onStatus:s=>{snapshot=s} })
  try {
    void c.start(); await until(()=>snapshot?.state==='online')
    assert.ok(writes >= 2)
    const info = state.registrations[f.config.relayOrigin].info, pub = info.publicRpcUrl
    const card = await (await fetch(info.publicCardUrl)).json()
    assert.equal(card.supportedInterfaces[0].url,pub); assert.deepEqual(card.securitySchemes,f.card.securitySchemes)
    const rpc = (method, auth='visitor', extra={}) => fetch(pub,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json','a2a-version':'1.0'},body:JSON.stringify({id:1,method,...extra})})
    assert.equal((await rpc('SendMessage','wrong')).status,401)
    const extended = await (await rpc('GetExtendedAgentCard')).json(); assert.equal(extended.result.supportedInterfaces[0].url,pub)
    assert.equal((await (await rpc('SendMessage')).json()).result.text,'你好，🌈'); assert.equal(f.receivedAuth,'Bearer visitor')
    const stream = await rpc('stream'); assert.equal(stream.headers.get('set-cookie'),null)
    assert.equal(await stream.text(),'data: {"text":"你好，🌈"}\n\n'.repeat(20000))
    assert.equal((await fetch(pub,{method:'POST',body:'a'.repeat(1_000_001)})).status,413)
    assert.equal((await fetch(pub.replace('/a2a','/api/agents'))).status,404)
    const hanging = rpc('hang'); await until(()=>!!f.hangResponse)
    const before = f.calls
    for (const s of f.relay.sessions.values()) s.ws.terminate()
    assert.equal((await hanging).status,502)
    await until(()=>snapshot.state==='online' && f.relay.sessions.size===1)
    await sleep(800); assert.equal(f.calls,before,'a disconnected request must never replay')
    assert.equal((await rpc('SendMessage')).status,200)
    assert.equal(snapshot.publicRpcUrl,pub)
    f.relay.revoke(info.publicationId); await until(()=>snapshot.state==='blocked')
    assert.equal((await rpc('SendMessage')).status,503)
  } finally { c.stop(); await f.close() }
})

test('chosen mobile IDs form working URLs, remain stable, and conflicts never mint a replacement identity', async () => {
  const f = await fixture(), state = { registrations:{}, desiredEnabled:true, revision:1, operationId:randomUUID(), cloudSyncPending:true }
  const config = { ...f.config, contactId:'18612345678' }
  let snapshot, duplicateStatus
  const c = new Connector({config,state,save:async()=>{},onStatus:s=>{snapshot=s}})
  const duplicateState = { registrations:{}, desiredEnabled:true, revision:1, operationId:randomUUID(), cloudSyncPending:true }
  const duplicate = new Connector({config,state:duplicateState,save:async()=>{},onStatus:s=>{duplicateStatus=s}})
  try {
    void c.start(); await until(()=>snapshot?.state==='online')
    const pub = `${f.config.relayOrigin}/r/18612345678/a2a`
    assert.equal(snapshot.publicRpcUrl,pub)
    assert.equal((await (await fetch(snapshot.publicCardUrl)).json()).supportedInterfaces[0].url,pub)
    const rpc=await fetch(pub,{method:'POST',headers:{authorization:'Bearer visitor'},body:JSON.stringify({id:1,method:'SendMessage'})})
    assert.equal(rpc.status,200)
    assert.equal((await rpc.json()).result.text,'你好，🌈')
    assert.equal((await fetch(`${f.config.relayOrigin}/r/${snapshot.publicationId}/.well-known/agent-card.json`)).status,200)
    void duplicate.start(); await until(()=>duplicateStatus?.state==='blocked')
    assert.match(duplicateStatus.error,/已被占用/)
    assert.equal(duplicate.heals.identity,0)
    assert.equal(f.relay.store.db.prepare('SELECT count(*) AS n FROM agents').get().n,1)
    const saved=state.registrations[f.config.relayOrigin].info
    assert.equal((await c.register()).info.publicRpcUrl,pub)
    const altered=new Connector({config:{...config,contactId:'18512345678'},state,save:async()=>{}})
    await assert.rejects(altered.register(),e=>e.code==='CONTACT_ID_IMMUTABLE')
    assert.deepEqual(state.registrations[f.config.relayOrigin].info,saved)
  } finally {c.stop();duplicate.stop();await f.close()}
})

test('reserve a route with the Agent offline, retain it across daemon restart, then connect to the same URL', async () => {
  const f=await fixture(), dir=await mkdtemp(join(tmpdir(),'connector-reserve-'))
  const port=f.local.address().port
  await new Promise(r=>f.local.close(r))
  try {
    await configure(dir,f.config)
    const reserved=await register(dir)
    assert.equal(reserved.state,'registered');assert.equal(reserved.desiredEnabled,false)
    assert.match(reserved.contactId,/^13[89]\d{8}$/)
    assert.equal(reserved.contactId,f.relay.store.get(reserved.publicationId).contactId)
    assert.ok(reserved.publicRpcUrl);assert.equal(f.relay.sessions.size,0)
    assert.equal((await fetch(reserved.publicCardUrl)).status,503)
    assert.equal((await register(dir)).publicRpcUrl,reserved.publicRpcUrl)
    assert.equal((await register(dir)).contactId,reserved.contactId)
    await command(dir,'shutdown');await until(async()=>!(await status(dir)).instanceId)
    assert.equal((await status(dir)).publicRpcUrl,reserved.publicRpcUrl)
    await ensureDaemon(dir)
    assert.equal((await register(dir)).publicRpcUrl,reserved.publicRpcUrl)
    assert.equal((await status(dir)).contactId,reserved.contactId)
    await new Promise(r=>f.local.listen(port,'127.0.0.1',r))
    await setEnabled(dir,true);await until(async()=>(await status(dir)).state==='online')
    assert.equal((await status(dir)).publicRpcUrl,reserved.publicRpcUrl)
    assert.equal((await fetch(reserved.publicCardUrl)).status,200)
  } finally {
    await command(dir,'shutdown').catch(()=>{});await until(async()=>!(await status(dir)).instanceId).catch(()=>{})
    if(!f.local.listening)await new Promise(r=>f.local.listen(port,'127.0.0.1',r))
    await f.close();await rm(dir,{recursive:true,force:true})
  }
})
test('daemon singleton, private IPC, persistence, disable and restart keep the same registration', async () => {
  const f=await fixture(), dir=await mkdtemp(join(tmpdir(),'connector-daemon-'))
  try {
    const pair=await Promise.all([ensureDaemon(dir),ensureDaemon(dir)])
    assert.equal(pair[0].instanceId,pair[1].instanceId)
    await configure(dir,f.config); await setEnabled(dir,true)
    await until(async()=>(await status(dir)).state==='online')
    const online=await status(dir)
    assert.ok(!JSON.stringify(online).includes('token'))
    await setEnabled(dir,false)
    assert.equal((await status(dir)).state,'stopped')
    assert.equal((await fetch(online.publicCardUrl)).status,503)
    await setEnabled(dir,true); await until(async()=>(await status(dir)).state==='online')
    assert.equal((await status(dir)).publicRpcUrl,online.publicRpcUrl)
    await command(dir,'shutdown'); await until(async()=>!(await status(dir)).instanceId)
    await ensureDaemon(dir); await setEnabled(dir,true); await until(async()=>(await status(dir)).state==='online')
    assert.equal((await status(dir)).publicRpcUrl,online.publicRpcUrl)
    const saved=JSON.parse(await readFile(join(dir,'state.json'),'utf8')); assert.equal(Object.keys(saved.registrations).length,1)
  } finally { await command(dir,'shutdown').catch(()=>{}); await until(async()=>!(await status(dir)).instanceId).catch(()=>{}); await f.close(); await rm(dir,{recursive:true,force:true}) }
})

test('legacy cached registrations fetch their number from Relay without changing the route or device credential', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:false,revision:0,operationId:randomUUID()}
  const c=new Connector({config:f.config,state,save:async()=>{}})
  try {
    const r=await c.register(), token=r.token, url=r.info.publicRpcUrl, number=r.info.contactId
    delete r.info.contactId
    const refreshed=await c.register()
    assert.equal(refreshed.info.contactId,number)
    assert.equal(refreshed.info.contactId,f.relay.store.get(refreshed.info.publicationId).contactId)
    assert.equal(refreshed.token,token);assert.equal(refreshed.info.publicRpcUrl,url)
    assert.equal(f.relay.sessions.size,0)
  } finally {c.stop();await f.close()}
})

test('concurrency is bounded and visitor disconnects release every flow without replay', async () => {
  const f = await fixture(), state = { registrations:{}, desiredEnabled:true, revision:1, operationId:randomUUID() }
  let s
  const c = new Connector({ config:f.config, state, save:async()=>{}, onStatus:value=>{s=value} })
  try {
    void c.start(); await until(()=>s?.state==='online')
    const controllers = Array.from({length:8},()=>new AbortController())
    const send = signal => fetch(s.publicRpcUrl,{method:'POST',headers:{authorization:'Bearer visitor'},body:JSON.stringify({method:'hang'}),signal})
    const pending = controllers.map(controller=>send(controller.signal).catch(e=>e))
    await until(()=>f.calls===8)
    assert.equal(f.relay.active,8)
    assert.equal((await send()).status,429)
    for(const controller of controllers) controller.abort()
    await Promise.all(pending); await until(()=>f.relay.active===0 && f.aborted===8)
    assert.equal(c.flows.size,0)
  } finally {c.stop(); await f.close()}
})

test('changing Relay host creates an origin-scoped identity and never forwards old device credentials', async () => {
  const a=await fixture(), b=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const one=new Connector({config:a.config,state,save:async()=>{},onStatus:s=>{current=s}})
  let two
  try {
    void one.start(); await until(()=>current?.state==='online'); one.stop()
    const credentialA=state.registrations[a.config.relayOrigin].token
    state.revision++;state.operationId=randomUUID()
    two=new Connector({config:{...a.config,relayOrigin:b.config.relayOrigin},state,save:async()=>{},onStatus:s=>{current=s}})
    void two.start(); await until(()=>current.state==='online' && current.relayOrigin===b.config.relayOrigin)
    assert.notEqual(state.registrations[b.config.relayOrigin].token,credentialA)
    await assert.rejects(control(b.config.relayOrigin,'/v1/publication',credentialA),e=>e.status===401)
    assert.equal(Object.keys(state.registrations).length,2)
  } finally {one.stop();two?.stop();await a.close();await b.close()}
})

test('relay database loss: 401 drops cached endpoints and re-registers instead of blocking', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const c=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
  try {
    void c.start(); await until(()=>current?.state==='online')
    const before=current.publicRpcUrl, token=state.registrations[f.config.relayOrigin].token
    f.relay.store.db.exec('DELETE FROM agents')
    for (const s of f.relay.sessions.values()) s.ws.terminate()
    await until(()=>current?.state==='online' && current.publicRpcUrl!==before)
    assert.equal(state.registrations[f.config.relayOrigin].token,token)
    assert.equal((await fetch(current.publicCardUrl)).status,200)
  } finally {c.stop(); await f.close()}
})

test('stale local revision (409) re-syncs with the relay revision instead of blocking', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const one=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
  let two
  try {
    void one.start(); await until(()=>current?.state==='online'); one.stop()
    f.relay.store.db.exec('UPDATE agents SET revision=10')
    state.revision=2; state.operationId=randomUUID(); state.cloudSyncPending=true
    two=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
    void two.start(); await until(()=>current?.state==='online')
    assert.equal(state.revision,11); assert.equal(state.cloudSyncPending,false)
    const row=f.relay.store.db.prepare('SELECT revision, enabled FROM agents').get()
    assert.equal(row.revision,11); assert.equal(row.enabled,1)
  } finally {one.stop(); two?.stop(); await f.close()}
})

test('a revoked publication (403) still blocks; heal is limited to unknown credentials', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const c=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
  try {
    void c.start(); await until(()=>current?.state==='online')
    f.relay.revoke(current.publicationId)
    await until(()=>current?.state==='blocked')
    assert.ok(state.registrations[f.config.relayOrigin].info)
  } finally {c.stop(); await f.close()}
})

test('reset identity: refused while publishing, then a new publication with a new address', async () => {
  const f=await fixture(), dir=await mkdtemp(join(tmpdir(),'connector-reset-'))
  try {
    await configure(dir,f.config); await setEnabled(dir,true)
    await until(async()=>(await status(dir)).state==='online')
    const first=(await status(dir)).publicRpcUrl
    await assert.rejects(resetIdentity(dir),/关闭发布/)
    await setEnabled(dir,false)
    assert.equal((await resetIdentity(dir)).state,'unregistered')
    assert.deepEqual(JSON.parse(await readFile(join(dir,'state.json'),'utf8')).registrations,{})
    await setEnabled(dir,true); await until(async()=>(await status(dir)).state==='online')
    assert.notEqual((await status(dir)).publicRpcUrl,first)
    // Offline path: the daemon is not running, reset edits state.json directly.
    await setEnabled(dir,false); await command(dir,'shutdown'); await until(async()=>!(await status(dir)).instanceId)
    await resetIdentity(dir)
    const saved=JSON.parse(await readFile(join(dir,'state.json'),'utf8'))
    assert.deepEqual(saved.registrations,{}); assert.ok(saved.config)
    assert.ok(!JSON.stringify(await status(dir)).includes('token'))
  } finally { await command(dir,'shutdown').catch(()=>{}); await until(async()=>!(await status(dir)).instanceId).catch(()=>{}); await f.close(); await rm(dir,{recursive:true,force:true}) }
})

test('401 then registration 409 recovers with a fresh identity (separate heal budgets)', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const c=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
  try {
    void c.start(); await until(()=>current?.state==='online')
    const r=state.registrations[f.config.relayOrigin], oldId=r.registrationId, before=current.publicRpcUrl
    // Restored credential that the relay does not know, under a registrationId it does know.
    r.token='f'.repeat(64)
    for (const s of f.relay.sessions.values()) s.ws.terminate()
    await until(()=>current?.state==='online' && current.publicRpcUrl!==before)
    assert.notEqual(state.registrations[f.config.relayOrigin].registrationId,oldId)
  } finally {c.stop(); await f.close()}
})

test('a delayed self-heal never re-registers after stop/reset', async () => {
  const f=await fixture()
  const state={registrations:{[f.config.relayOrigin]:{registrationId:randomUUID(),token:'a'.repeat(64),info:{publicationId:'x'}}},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let release, saves=0, current
  const c=new Connector({config:f.config,state,save:()=>{saves++; return new Promise(r=>{release=r})},onStatus:s=>{current=s}})
  try {
    c.retry({status:401})
    await until(()=>saves===1)
    c.stop(); state.registrations={}
    release(); await sleep(300)
    assert.deepEqual(state.registrations,{}); assert.equal(current.state,'stopped'); assert.equal(saves,1)
  } finally {c.stop(); await f.close()}
})

test('offline reset honours the daemon lock, recovers stale locks and serializes concurrent resets', async () => {
  const dir=await mkdtemp(join(tmpdir(),'connector-lock-'))
  try {
    const initial={config:{relayOrigin:'https://relay.example'},registrations:{'https://relay.example':{registrationId:'r',token:'t'.repeat(64)}},desiredEnabled:false,revision:3,operationId:randomUUID(),cloudSyncPending:false}
    await writeFile(join(dir,'state.json'),JSON.stringify(initial))
    await writeFile(join(dir,'control.json'),JSON.stringify({token:'c'.repeat(64)}))
    // A live owner (daemon starting, socket not yet listening) blocks offline mutation.
    await writeFile(join(dir,'daemon.lock'),JSON.stringify({pid:process.pid,instanceId:'live'}))
    await assert.rejects(resetIdentity(dir),/稍后/)
    assert.deepEqual(JSON.parse(await readFile(join(dir,'state.json'),'utf8')),initial)
    // A dead owner's lock is recovered.
    await writeFile(join(dir,'daemon.lock'),JSON.stringify({pid:2147483646,instanceId:'dead'}))
    await resetIdentity(dir)
    assert.deepEqual(JSON.parse(await readFile(join(dir,'state.json'),'utf8')).registrations,{})
    // Concurrent resets: at least one wins, the rest refuse, state stays valid, no leftovers.
    const results=await Promise.allSettled([resetIdentity(dir),resetIdentity(dir),resetIdentity(dir)])
    assert.ok(results.some(r=>r.status==='fulfilled'))
    for (const r of results) if (r.status==='rejected') assert.match(r.reason.message,/稍后/)
    const saved=JSON.parse(await readFile(join(dir,'state.json'),'utf8'))
    assert.deepEqual(saved.registrations,{}); assert.ok(saved.config)
    assert.deepEqual((await readdir(dir)).sort(),['control.json','state.json'])
  } finally { await rm(dir,{recursive:true,force:true}) }
})

test('stop during a stale-revision replay never sends the replayed intent', async () => {
  const f=await fixture(), state={registrations:{},desiredEnabled:true,revision:1,operationId:randomUUID()}
  let current
  const one=new Connector({config:f.config,state,save:async()=>{},onStatus:s=>{current=s}})
  let two, release, saves=0
  try {
    void one.start(); await until(()=>current?.state==='online'); one.stop()
    f.relay.store.db.exec('UPDATE agents SET revision=10')
    state.revision=2; state.operationId=randomUUID(); state.cloudSyncPending=true
    two=new Connector({config:f.config,state,save:()=>{saves++; return new Promise(r=>{release=r})},onStatus:s=>{current=s}})
    void two.start(); await until(()=>saves===1)
    two.stop(); release(); await sleep(300)
    assert.equal(f.relay.store.db.prepare('SELECT revision FROM agents').get().revision,10)
    assert.equal(current.state,'stopped')
  } finally {one.stop(); two?.stop(); await f.close()}
})

test('reset of a never-published agent is a no-op and creates nothing', async () => {
  const root=await mkdtemp(join(tmpdir(),'connector-none-')), dir=join(root,'missing')
  try { assert.equal((await resetIdentity(dir)).state,'unregistered'); assert.deepEqual(await readdir(root),[]) }
  finally { await rm(root,{recursive:true,force:true}) }
})

test('explicit disable through the daemon survives a stale revision (409) and reaches the relay', async () => {
  const f=await fixture(), dir=await mkdtemp(join(tmpdir(),'connector-disable-'))
  try {
    await configure(dir,f.config); await setEnabled(dir,true)
    await until(async()=>(await status(dir)).state==='online')
    f.relay.store.db.exec('UPDATE agents SET revision=10')
    const s=await setEnabled(dir,false)
    assert.equal(s.cloudSyncPending,false)
    const row=f.relay.store.db.prepare('SELECT revision, enabled FROM agents').get()
    assert.equal(row.enabled,0); assert.equal(row.revision,11)
  } finally { await command(dir,'shutdown').catch(()=>{}); await until(async()=>!(await status(dir)).instanceId).catch(()=>{}); await f.close(); await rm(dir,{recursive:true,force:true}) }
})
