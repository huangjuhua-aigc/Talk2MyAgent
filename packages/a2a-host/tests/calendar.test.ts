import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startPortal } from './support/portal.ts'

const source = process.env['A2A_PLUGIN_SOURCE']
for (const provider of ['google', 'feishu']) {
  test(`Portal local ${provider}: stopped Agent authorization, CSRF, encrypted credentials, startup patch, disconnect`, { skip: !source && 'Set A2A_PLUGIN_SOURCE to the dsh-a2a checkout' }, async t => {
    const { startProviderFixture } = await import(pathToFileURL(join(source!, 'tests/support/calendar-provider.mjs')).href)
    const remote = await startProviderFixture(); t.after(remote.close)
    const portal = await startPortal(2, { calendarFixture: remote.origin, googleClientId: '' }); t.after(portal.close)
    const id = portal.agents[0]!.record.id
    let path = `${portal.baseURL}/api/agents/${id}/calendar`
    let { csrfToken } = await (await fetch(`${portal.baseURL}/api/session`)).json() as { csrfToken: string }
    let headers = { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }
    const client = { installed: { client_id: '1234-import.apps.googleusercontent.com', client_secret: 'USER_CLIENT_SECRET' } }
    const imported = () => JSON.stringify({ document: client })
    if (provider === 'google') {
      assert.equal((await (await fetch(path)).json() as { googleConfigured: boolean }).googleConfigured, false)
      assert.equal((await fetch(`${path}/google-client`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: imported() })).status, 403)
      assert.equal((await fetch(`${path}/google-client`, { method: 'POST', headers, body: JSON.stringify({ document: { web: client.installed } }) })).status, 400)
      assert.equal((await fetch(`${path}/google-client`, { method: 'POST', headers, body: imported() })).status, 200)
      assert.equal((await (await fetch(`${portal.baseURL}/api/agents/${portal.agents[1]!.record.id}/calendar`)).json() as { googleConfigured: boolean }).googleConfigured, false)
      await portal.restartServer()
      path = `${portal.baseURL}/api/agents/${id}/calendar`
      ;({ csrfToken } = await (await fetch(`${portal.baseURL}/api/session`)).json() as { csrfToken: string })
      headers = { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }
      assert.equal((await (await fetch(path)).json() as { googleConfigured: boolean }).googleConfigured, true)
    }
    assert.equal((await fetch(`${path}/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }) })).status, 403)
    const start = await (await fetch(`${path}/connect`, { method: 'POST', headers, body: JSON.stringify({ provider }) })).json() as { authorizationUrl: string }
    const auth = new URL(start.authorizationUrl)
    if (provider === 'google') {
      assert.equal(auth.searchParams.get('client_id'), client.installed.client_id)
      assert.equal((await fetch(`${path}/google-client`, { method: 'POST', headers, body: imported() })).status, 400)
      const callback = new URL(auth.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'test' }).toString()
      assert.equal((await fetch(callback)).status, 200)
    } else { assert.equal(auth.hostname, 'open.feishu.cn'); remote.approveApp(); remote.approveUser() }
    let poll: { status: string } = { status: 'pending' }
    for (let n = 0; n < 100 && poll.status === 'pending'; n++) {
      await new Promise(r => setTimeout(r, 100))
      poll = await (await fetch(`${path}/poll`, { method: 'POST', headers, body: '{}' })).json() as { status: string }
    }
    assert.equal(poll.status, 'connected')
    const status = await (await fetch(path)).json() as { connected: boolean; provider: string }
    assert.equal(status.connected, true); assert.equal(status.provider, provider)
    assert.doesNotMatch(JSON.stringify(status), /TOKEN_SECRET|CLIENT_SECRET|1234-import/)
    assert.equal((await fetch(`${path}/google-client`, { method: 'POST', headers, body: imported() })).status, 400)
    const file = join(portal.host, 'calendar', `${id}.connection.json`), connection = await readFile(file, 'utf8')
    assert.equal(JSON.parse(connection).version, 2); assert.doesNotMatch(connection, /TOKEN_SECRET|CLIENT_SECRET|owner@example/)
    const patch = await readFile(join(portal.host, 'agents', `${id}.patch.yml`), 'utf8')
    assert.match(patch, /calendar:/); assert.match(patch, /mode: auto/); assert.doesNotMatch(patch, /TOKEN_SECRET|CLIENT_SECRET/)
    assert.equal((await fetch(`${path}/connect`, { method: 'POST', headers, body: JSON.stringify({ provider }) })).status, 500)
    assert.equal((await fetch(path, { method: 'DELETE', headers })).status, 200)
    await assert.rejects(readFile(file))
    if (provider === 'google') assert.equal((await (await fetch(path)).json() as { googleConfigured: boolean }).googleConfigured, true)
  })
}
test('missing Google client enables setup; direct authorization and removed provider fail without installing', async t => {
  const portal = await startPortal(1); t.after(portal.close)
  const path = `${portal.baseURL}/api/agents/${portal.agents[0]!.record.id}/calendar`
  const status = await (await fetch(path)).json() as { googleConfigured: boolean; providers: { id: string; available: boolean }[] }
  assert.equal(status.googleConfigured, false)
  assert.deepEqual(status.providers, [{ id: 'google', available: true }, { id: 'feishu', available: true }])
  const { csrfToken } = await (await fetch(`${portal.baseURL}/api/session`)).json() as { csrfToken: string }
  const headers = { 'content-type': 'application/json', 'x-a2a-csrf': csrfToken }
  for (const provider of ['google', 'wecom']) assert.equal((await fetch(`${path}/connect`, { method: 'POST', headers, body: JSON.stringify({ provider }) })).status, 500)
})
