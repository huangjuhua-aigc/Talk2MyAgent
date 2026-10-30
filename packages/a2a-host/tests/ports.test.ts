import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { assertPortAvailable } from '../src/ports.ts'

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}
const close = async (server: Server): Promise<void> => await new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve())
})

test('Port preflight reports an occupied Agent port without stopping its existing service', async () => {
  const existing = createServer()
  const port = await listen(existing)
  try {
    await assert.rejects(assertPortAvailable({ host: '127.0.0.1', port }), error => {
      assert.match(String(error), new RegExp(`端口 ${port} 已被占用`))
      assert.match(String(error), /Relay 服务地址中的端口无需改动/)
      return true
    })
    assert.equal(existing.listening, true)
  } finally { await close(existing) }
})

test('Port preflight releases an available port so the Agent can bind it immediately', async () => {
  const allocation = createServer()
  const port = await listen(allocation)
  await close(allocation)
  await assertPortAvailable({ host: '127.0.0.1', port })
  const agent = createServer()
  try { assert.equal(await listen(agent, port), port) }
  finally { if (agent.listening) await close(agent) }
})

test('Port preflight rejects invalid values before listening', async () => {
  for (const port of [0, -1, 65536, 3080.5, NaN]) {
    await assert.rejects(assertPortAvailable({ host: '127.0.0.1', port }), /1 到 65535/)
  }
})
