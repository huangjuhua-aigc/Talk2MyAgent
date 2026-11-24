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
    assert.equal(source, process.env['A2A_PLUGIN_SOURCE'] || 'dsh-a2a-server@^0.6.0')
    const directory = join(root, 'profiles/fixture/node_modules/dsh-a2a-server')
    await mkdir(join(directory, 'lib'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'dsh-a2a-server', version: '0.6.0', type: 'module' }))
    await writeFile(join(directory, 'lib/public-visitors.js'), 'export {}')
    await writeFile(join(directory, 'lib/live-visitors.js'), 'export {}')
    for (const file of ['visitor-present.js', 'present-files.js', 'present-worker.py']) {
      await writeFile(join(directory, 'lib', file), '')
    }
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
    for (const version of ['0.4.1', '0.5.0']) {
      const before: number = installs
      await writeFile(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/package.json'), JSON.stringify({ name: 'dsh-a2a-server', version, type: 'module' }))
      await requireVisitorRuntime('fixture', { publicVisitors: false, install })
      assert.equal(installs, before + 1, `${version} profiles upgrade even with public access disabled`)
    }
    await requireVisitorRuntime('fixture', { publicVisitors: true, install })
    assert.equal(installs, 3, 'full visitor runtime is cached')
    for (const file of ['live-visitors.js', 'visitor-present.js', 'present-files.js', 'present-worker.py']) {
      const before: number = installs
      await rm(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/lib', file))
      await requireVisitorRuntime('fixture', { install })
      assert.equal(installs, before + 1, `missing ${file} is repaired`)
    }
    await assert.rejects(requireVisitorRuntime('fixture', { calendar: true, install }), /尚不支持日历预约/)
    assert.equal(installs, 8, 'calendar authorization checks the calendar feature, not just the version')
    await requireVisitorRuntime('fixture', { calendar: true, install: async (profile, source) => {
      const result = await install(profile, source)
      await writeFile(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/lib/calendar.js'), 'export {}')
      await mkdir(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/calendar'), { recursive: true })
      await writeFile(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/calendar/auth.mjs'), 'export {}')
      await writeFile(join(root, 'profiles/fixture/node_modules/dsh-a2a-server/calendar/google-client.mjs'), 'export {}')
      return result
    } })
    await requireVisitorRuntime('fixture', { calendar: true, install })
    assert.equal(installs, 9, 'calendar-capable builds are cached')
    assert.equal(sandboxSupport('darwin','arm64').supported, true)
    assert.equal(sandboxSupport('darwin','x64').supported, false)
    assert.equal(sandboxSupport('win32','x64').supported, true)
  } finally {
    if (previous === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = previous
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

test('read-only startup upgrades the visitor plugin without loading Microsandbox', async t => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-read-only-upgrade-'))
  const restore = ['DSH_HOME', 'A2A_VISITOR_EXECUTION'].map(key => [key, process.env[key]] as const)
  t.after(async () => {
    for (const [key, value] of restore) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  process.env['DSH_HOME'] = root
  process.env['A2A_VISITOR_EXECUTION'] = 'read-only'
  const directory = join(root, 'profiles/fixture/node_modules/dsh-a2a-server')
  const manifest = join(directory, 'package.json')
  const writeVersion = (version: string) => writeFile(manifest, JSON.stringify({ name: 'dsh-a2a-server', version, type: 'module' }))
  await mkdir(join(directory, 'lib'), { recursive: true })
  await writeVersion('0.4.1')
  await writeFile(join(directory, 'lib/microsandbox-runtime.js'), "throw new Error('VM module loaded in read-only mode')")
  const install = t.mock.fn(async () => {
    await writeVersion('0.6.0')
    for (const name of ['public-visitors', 'live-visitors']) await writeFile(join(directory, 'lib', name + '.js'), 'export {}')
    for (const file of ['visitor-present.js', 'present-files.js', 'present-worker.py']) await writeFile(join(directory, 'lib', file), '')
    return { ok: true, output: '' }
  })
  await assert.rejects(requireVisitorRuntime('fixture', { install: async () => ({ ok: false, output: 'fixture offline' }) }), /fixture offline/)
  await requireVisitorRuntime('fixture', { install, publicVisitors: false })
  await requireVisitorRuntime('fixture', { install, publicVisitors: true })
  assert.equal(install.mock.callCount(), 1)
})
