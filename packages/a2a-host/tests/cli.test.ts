import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPortal } from './support/portal.ts'

test('host CLI status and monitor use the same private IPC as Portal', async () => {
  const portal = await startPortal(1)
  try {
    for (const command of ['status', 'monitor']) {
      const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/cli.ts', command, portal.agents[0]!.record.id], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, A2A_HOST_HOME: portal.host, DSH_HOME: join(portal.root, 'dsh') },
        windowsHide: true, timeout: 10_000,
      })
      const response = JSON.parse(result.stdout)
      assert.equal(response.ok, true, response.reason)
      assert.equal(response.snapshot.contexts[0].peer, 'alice')
      assert.equal(response.snapshot.contexts[0].tasks[0].output, 'Alpha Agent 的答复')
    }
  } finally { await portal.close() }
})
