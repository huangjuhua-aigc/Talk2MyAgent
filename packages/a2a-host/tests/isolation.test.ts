import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareAgentWorkspaces } from '../src/isolation.ts'
import { agentWorkspacesPath } from '../src/paths.ts'
import { requireVisitorRuntime } from '../src/visitor-runtime.ts'
import type { AgentRecord } from '../src/files.ts'

test('migration preserves visitor files outside public data and stops on unsafe conflicts', async () => {
  const base = await mkdtemp(join(tmpdir(), 'a2a-migration-'))
  const oldHome = process.env['A2A_HOST_HOME'], oldDsh = process.env['DSH_HOME']
  process.env['A2A_HOST_HOME'] = join(base, 'host'); process.env['DSH_HOME'] = join(base, 'dsh')
  const publicRoot = join(base, 'public')
  const record = { id: 'test', profile: 'test', config: { peers: [{ name: 'alice' }, { name: 'bob' }], isolation: { workspaceRoot: publicRoot, peerWorkspaces: {} } } } as AgentRecord
  try {
    await mkdir(join(publicRoot, 'alice', 'nested'), { recursive: true })
    await writeFile(join(publicRoot, 'alice', 'nested', 'private.txt'), 'preserve me')
    await writeFile(join(publicRoot, 'info.txt'), 'shared')
    assert.deepEqual(await prepareAgentWorkspaces(record), ['alice'])
    assert.equal(await readFile(join(agentWorkspacesPath('test'), 'alice', 'nested', 'private.txt'), 'utf8'), 'preserve me')
    await assert.rejects(readFile(join(publicRoot, 'alice', 'nested', 'private.txt')), { code: 'ENOENT' })
    assert.equal(await readFile(join(publicRoot, 'info.txt'), 'utf8'), 'shared')
    assert.deepEqual(await prepareAgentWorkspaces(record), [])
    await mkdir(join(publicRoot, 'alice')); await writeFile(join(publicRoot, 'alice', 'new.txt'), 'do not overwrite')
    await assert.rejects(prepareAgentWorkspaces(record), /同时存在/)
    assert.equal(await readFile(join(publicRoot, 'alice', 'new.txt'), 'utf8'), 'do not overwrite')
    await rm(join(publicRoot, 'alice'), { recursive: true })
    await symlink(join(base, 'host'), join(publicRoot, 'alice'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(prepareAgentWorkspaces(record), /不是普通目录/)
    await rm(join(publicRoot, 'alice'))
    record.config.isolation.workspaceRoot = base
    await assert.rejects(prepareAgentWorkspaces(record))
    await assert.rejects(requireVisitorRuntime('test', { install: async () => ({ ok: false, output: 'fixture network error' }) }), /沙箱插件安装失败/)
  } finally {
    if (oldHome === undefined) delete process.env['A2A_HOST_HOME']; else process.env['A2A_HOST_HOME'] = oldHome
    if (oldDsh === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = oldDsh
    if (!resolve(base).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(base, { recursive: true, force: true })
  }
})
