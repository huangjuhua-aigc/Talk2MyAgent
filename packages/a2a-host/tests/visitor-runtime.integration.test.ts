import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { requireVisitorRuntime } from '../src/visitor-runtime.ts'
import { initializeWebProfile } from '../src/dsh.ts'

test('real first-start preparation installs the plugin in an isolated DSH profile and reuses its runtime', {
  skip: process.env['A2A_HOST_RUNTIME_TEST'] !== '1', timeout: 900_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-first-start-'))
  const oldDsh = process.env['DSH_HOME'], oldHost = process.env['A2A_HOST_HOME']
  process.env['DSH_HOME'] = join(root, 'dsh')
  process.env['A2A_HOST_HOME'] = join(root, 'host')
  const phases: string[] = []
  try {
    await requireVisitorRuntime('fixture', { onProgress: progress => { phases.push(progress.phase); console.log(progress.message) } })
    assert.ok(phases.includes('installing'))
    assert.equal(phases.at(-1), 'ready')
    const manifestPath = join(root, 'dsh', 'profiles', 'fixture', 'package.json')
    const manifest = await readFile(manifestPath, 'utf8')
    const pkg = JSON.parse(manifest)
    assert(pkg.dsh.profile.bundles.includes('@deepseek-ai/dsh-web-app'))
    assert(pkg.dsh.profile.bundles.includes('dsh-a2a-server'))
    await initializeWebProfile('fixture')
    assert.equal(await readFile(manifestPath, 'utf8'), manifest, 'Initialization must not erase installed plugins')
    await requireVisitorRuntime('fixture', { install: async () => { throw new Error('Cached plugin should not reinstall') } })
  } finally {
    if (oldDsh === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = oldDsh
    if (oldHost === undefined) delete process.env['A2A_HOST_HOME']; else process.env['A2A_HOST_HOME'] = oldHost
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
