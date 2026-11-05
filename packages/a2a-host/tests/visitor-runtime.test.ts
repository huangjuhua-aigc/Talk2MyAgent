import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { requireVisitorRuntime, sandboxSupport } from '../src/visitor-runtime.ts'
import type { StartupProgress } from '../src/types.ts'

test('first start upgrades the plugin automatically, forwards progress, caches it, and retries failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-runtime-test-')), previous = process.env['DSH_HOME']
  process.env['DSH_HOME'] = root
  let installs = 0
  const events: StartupProgress[] = []
  const install = async (profile: string, source: string) => {
    installs++
    assert.equal(profile, 'fixture')
    assert.equal(source, process.env['A2A_PLUGIN_SOURCE'] || 'dsh-a2a-server@^0.4.1')
    const directory = join(root, 'profiles/fixture/node_modules/dsh-a2a-server')
    await mkdir(join(directory, 'lib'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'dsh-a2a-server', version: '0.4.1', type: 'module' }))
    await writeFile(join(directory, 'lib/public-visitors.js'), 'export {}')
    await writeFile(join(directory, 'lib/live-visitors.js'), 'export {}')
    await writeFile(join(directory, 'lib/microsandbox-runtime.js'), `export async function prepareMicrosandbox({onProgress}) {
      onProgress?.({phase:'image',message:'fixture image download'});
      onProgress?.({phase:'ready',message:'fixture ready'});
    }`)
    return { ok: true, output: 'installed' }
  }
  try {
    await assert.rejects(requireVisitorRuntime('../unsafe', { install }), /Invalid/)
    assert.equal(installs, 0)
    await assert.rejects(requireVisitorRuntime('fixture', { install: async () => ({ ok: false, output: 'offline' }) }), /offline/)
    for (const output of [
      '[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for dsh-a2a-server@^0.4.0',
      'npm error code ETARGET\nnpm error notarget No matching version found for dsh-a2a-server@^0.4.0',
    ]) {
      const failureEvents: StartupProgress[] = []
      await assert.rejects(requireVisitorRuntime('fixture', {
        install: async () => ({ ok: false, output }), onProgress: progress => failureEvents.push(progress),
      }), error => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /安装源尚未提供所需的沙箱插件版本/)
        assert.ok(error.message.includes(output), 'preserve the installer diagnostic')
        assert.doesNotMatch(error.message, /检查网络/)
        return true
      })
      assert.deepEqual(failureEvents.map(event => event.phase), ['checking', 'installing'])
    }
    await requireVisitorRuntime('fixture', { install, onProgress: progress => events.push(progress) })
    assert.equal(installs, 1)
    assert.deepEqual(events.map(e => e.phase), ['checking','installing','image','ready'])
    await requireVisitorRuntime('fixture', { install })
    assert.equal(installs, 1, 'cached runtime must not reinstall')
    await writeFile(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/package.json'), JSON.stringify({ name: 'dsh-a2a-server', version: '0.4.0', type: 'module' }))
    await requireVisitorRuntime('fixture', { publicVisitors: false, install })
    assert.equal(installs, 2, 'old profiles upgrade even with public access disabled, for live invited visitors')
    await requireVisitorRuntime('fixture', { publicVisitors: true, install })
    assert.equal(installs, 2, 'full visitor runtime is cached')
    await rm(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/lib/live-visitors.js'))
    await requireVisitorRuntime('fixture', { install })
    assert.equal(installs, 3, 'incomplete or stale development builds are repaired')
    assert.equal(sandboxSupport('darwin','arm64').supported, true)
    assert.equal(sandboxSupport('darwin','x64').supported, false)
    assert.equal(sandboxSupport('win32','x64').supported, true)
  } finally {
    if (previous === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = previous
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
