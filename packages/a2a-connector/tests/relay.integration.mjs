import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { Connector, control } from '../src/connector.mjs'
import { configure, setEnabled, status, command, ensureDaemon } from '../src/manager.mjs'
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
