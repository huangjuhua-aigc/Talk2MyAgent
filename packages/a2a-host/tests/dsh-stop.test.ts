import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DshRunner } from '../src/dsh.ts'

test('stopping an adopted resident process waits for exit and releases its listening port before reporting success', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-stop-process-'))
  const previous = process.env['A2A_HOST_HOME']; process.env['A2A_HOST_HOME'] = root
  const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const port = await new Promise<number>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not start')), 5000)
      child.once('error', e => { clearTimeout(timer); reject(e) })
      child.stdout!.once('data', data => { clearTimeout(timer); done(Number(String(data).trim())) })
    })
    assert.ok(child.pid && port)
    await mkdir(join(root, 'agents')); const pidFile = join(root, 'agents/test.pid')
    await writeFile(pidFile, String(child.pid))
    const runner = new DshRunner('test'); assert.equal(runner.running, true)
    assert.equal(await runner.stop(), true)
    assert.equal(runner.running, false)
    assert.throws(() => process.kill(child.pid!, 0))
    await assert.rejects(readFile(pidFile), { code: 'ENOENT' })
    const next = createServer()
    await new Promise<void>((done, reject) => { next.once('error', reject); next.listen(port, '127.0.0.1', done) })
    await new Promise<void>(done => next.close(() => done()))
    assert.equal(await runner.stop(), false)
  } finally {
    if (child.exitCode === null) child.kill()
    if (previous === undefined) delete process.env['A2A_HOST_HOME']; else process.env['A2A_HOST_HOME'] = previous
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
