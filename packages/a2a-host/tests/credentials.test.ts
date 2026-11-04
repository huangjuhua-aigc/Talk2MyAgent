import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { writeCredentials } from '../src/files.ts'

test('fresh credentials use the versioned DSH document and preserve existing refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2a-credentials-'))
  const previous = process.env['DSH_HOME']
  process.env['DSH_HOME'] = root
  try {
    await writeCredentials({ TEST_FIRST: 'test-value' })
    assert.deepEqual(parse(await readFile(join(root, '.credentials.yaml'), 'utf8')), {
      version: 1, refs: { TEST_FIRST: 'test-value' },
    })
    await writeCredentials({ TEST_SECOND: 'another-test-value' })
    assert.deepEqual(parse(await readFile(join(root, '.credentials.yaml'), 'utf8')), {
      version: 1, refs: { TEST_FIRST: 'test-value', TEST_SECOND: 'another-test-value' },
    })
  } finally {
    if (previous === undefined) delete process.env['DSH_HOME']; else process.env['DSH_HOME'] = previous
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
