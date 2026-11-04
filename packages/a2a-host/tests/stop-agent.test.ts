import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AgentRecord } from '../src/files.ts'
import { agentManagementPath } from '../src/paths.ts'
import { stopAgent } from '../src/stop-agent.ts'

test('host never kills the Agent before its private IPC confirms disks are stopped', async () => {
  const record = { id: `safe-stop-${randomUUID()}`, config: { adminToken: 'test-owner-only' } } as AgentRecord
  let acknowledge = false, kills = 0
  const server = createServer((req,res) => {
    assert.equal(req.url,'/a2a/admin/prepare-stop')
    assert.equal(req.method,'POST')
    assert.equal(req.headers.authorization,'Bearer test-owner-only')
    res.writeHead(acknowledge ? 200 : 500, {'content-type':'application/json'})
    res.end(JSON.stringify({readyToStop:acknowledge}))
  })
  await new Promise<void>(r=>server.listen(agentManagementPath(record.id),r))
  try {
    const runner = {running:true,stop:()=>{kills++;return true}}
    await assert.rejects(stopAgent(record,runner),/已保留进程/)
    assert.equal(kills,0)
    acknowledge=true
    assert.equal(await stopAgent(record,runner),true)
    assert.equal(kills,1)
    assert.equal(await stopAgent(record,{...runner,running:false}),false)
    assert.equal(kills,1)
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
})
