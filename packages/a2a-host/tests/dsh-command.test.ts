import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dshCommand } from '../src/dsh-command.ts'

test('Windows CLI invocation preserves spaces and shell characters without a command shell', async () => {
  const base = await mkdtemp(join(tmpdir(), 'a2a cli args '))
  try {
    const packageRoot = join(base, 'node_modules/@deepseek-ai/dsh')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ bin: { dsh: './cli.cjs' } }))
    await writeFile(join(packageRoot, 'cli.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))')
    const args = ['plugin', '--profile', 'fixture', 'add', 'D:\\my files\\plugin & echo %PATH%']
    const call = dshCommand(args, { platform: 'win32', searchPath: base })
    assert.equal(call.command, process.execPath)
    const result = await promisify(execFile)(call.command, call.args)
    assert.deepEqual(JSON.parse(result.stdout), args)
  } finally {
    if (!resolve(base).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(base, { recursive: true, force: true })
  }
})
