import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { waitForAgentReady } from '../src/readiness.ts'

test('Agent readiness waits for the A2A card rather than process spawn or an unrelated HTML server', async () => {
  let requests = 0
  const server = createServer((_,res) => {
    requests++
    res.end(requests < 3 ? '<html>not an Agent</html>' : JSON.stringify({ name: 'real-ready', supportedInterfaces: [] }))
  })
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r))
  try {
    const port = (server.address() as {port:number}).port
    await waitForAgentReady({host:'127.0.0.1',port}, {isRunning:()=>true,intervalMs:5,timeoutMs:2000})
    assert.equal(requests,3)
    await assert.rejects(waitForAgentReady({host:'127.0.0.1',port}, {isRunning:()=>false}), /进程已退出/)
    await assert.rejects(waitForAgentReady({host:'127.0.0.1',port}, {isRunning:()=>true,timeoutMs:0}), /超时/)
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())) }
})
