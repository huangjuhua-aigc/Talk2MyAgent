import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
/** The Relay is a separate repository; opt in to cross-repository integration. */
export async function startTestRelay() {
  const source = process.env['A2A_RELAY_SOURCE']
  if (!source) throw new Error('Set A2A_RELAY_SOURCE to the independent Relay repository')
  const { createRelay } = await import(pathToFileURL(join(source, 'src/server.mjs')).href)
  const reservation = createServer()
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>(done => reservation.close(() => done()))
  const origin = `http://127.0.0.1:${address.port}`
  const relay = createRelay({ origin, allowHttp: true, requestsPerMinute: 1000 })
  await new Promise<void>(done => relay.server.listen(address.port, '127.0.0.1', done))
  return { origin, close: () => relay.close() as Promise<void> }
}
