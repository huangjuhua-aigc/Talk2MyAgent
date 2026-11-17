import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DshLog } from '../src/dsh-log.ts'

test('startup diagnostics ignore previous attempts and redact credentials from file-backed output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-startup-log-')), file = join(root, 'agent.log')
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }) })
  const failure = 'a2a-server (dsh-a2a-server): Error: Links and nested mounts are not allowed in container data: C:\\资料\\linked.doc\n'
  await writeFile(file, failure)
  const log = new DshLog(file)
  assert.equal(log.failure(), undefined)
  log.begin()
  assert.equal(log.failure(), undefined)
  await appendFile(file, 'dsh web: http://127.0.0.1:3080/?token=PRIVATE_WEB_TOKEN\nAuthorization: Bearer PRIVATE_AUTH\n{"refresh_token":"PRIVATE_REFRESH"}\n')
  assert.equal(log.failure(), undefined)
  assert.doesNotMatch(log.lines().join('\n'), /PRIVATE_/)
  assert.match(log.lines().join('\n'), /redacted/)
  await appendFile(file, failure)
  assert.match(log.failure()!, /公共资料.*C:\\资料\\linked.doc/)
  log.begin()
  assert.equal(log.failure(), undefined)
  await appendFile(file, 'healthy\n'.repeat(20000))
  assert.equal(log.lines(5).length, 5)
  assert.equal(log.failure(), undefined)
})
