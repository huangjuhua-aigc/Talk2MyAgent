import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { originOf, bytesOf, headersOf, adaptCard } from '@talk2myagent/a2a-relay-protocol'
import { localTarget, Connector } from '../src/connector.mjs'
import { assertPrivateDirectory } from '../src/manager.mjs'
test('origins, targets and header/frame validation reject confused-deputy inputs', () => {
  assert.equal(originOf('relay.example.com'),'https://relay.example.com')
  for(const url of ['http://remote.test','https://x/path','https://user:pass@x','https://x?secret=yes']) assert.throws(()=>originOf(url))
  for(const url of ['http://remote.test/a2a','http://169.254.169.254/a2a','http://127.0.0.1/a2a?x=1']) assert.throws(()=>localTarget(url))
  assert.throws(()=>bytesOf({data:'%%%'})); assert.throws(()=>headersOf({authorization:'Bearer x\r\nHost: evil'}))
  assert.deepEqual(headersOf({host:'evil',authorization:'Bearer visitor'}),{authorization:'Bearer visitor'})
  assert.throws(()=>adaptCard({signatures:[],supportedInterfaces:[]},'https://x'))
  assert.throws(()=>new Connector({config:{relayOrigin:'https://relay.test',localRpcUrl:'http://127.0.0.1:17890/api/agents',
    localCardUrl:'http://127.0.0.1:3080/.well-known/agent-card.json'}}),/same origin/)
})
test('private storage cannot be inside any visitor root, including not-yet-created paths', async()=>{
  const root=await mkdtemp(join(tmpdir(),'relay-roots-'))
  try { await mkdir(join(root,'shared')); await assertPrivateDirectory(join(root,'private'),[join(root,'shared')])
    await assert.rejects(assertPrivateDirectory(join(root,'private'),[root]),/重叠/)
    await assert.rejects(assertPrivateDirectory(join(root,'private'),[join(root,'private','nested')]),/重叠/)
  } finally {await rm(root,{recursive:true,force:true})}
})
