/** Opt-in real-model local integration environment. Never prints credentials. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import YAML from 'yaml'

const out = process.env['A2A_REAL_REPORT'] ?? 'D:/code/dsh-a2a/qa-artifacts/2026-10-31-real-chain'
await mkdir(out, { recursive: true })
const root = process.env['A2A_REAL_ROOT'] || await mkdtemp(join(tmpdir(), 'a2a-real-chain-'))
const port = Number(process.env['A2A_REAL_PORT'] || 17891)
const credentials = YAML.parse(await readFile(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8'))
const key = process.env['DEEPSEEK_API_KEY'] || credentials.refs?.DEEPSEEK_API_KEY
if (typeof key !== 'string' || !key) throw new Error('DeepSeek credential is not configured')
Object.assign(process.env, {
  DEEPSEEK_API_KEY: key, DSH_HOME: join(root, 'dsh'), A2A_HOST_HOME: join(root, 'host'),
  A2A_HOST_PORT: String(port), A2A_RELAY_DEFAULT_HOST: 'http://127.0.0.1:8787',
  A2A_RELAY_ALLOW_LOOPBACK_HTTP: '1', A2A_PLUGIN_SOURCE: 'D:/code/dsh-a2a',
})
if (!process.env['A2A_SANDBOX_HOME']) throw new Error('Set A2A_SANDBOX_HOME to the prepared native runtime cache')
const publicRoot = join(root, 'public')
await mkdir(publicRoot, { recursive: true })
const { serve } = await import('../src/server.ts')
await serve()
const info = { root, publicRoot, host: process.env['A2A_HOST_HOME'], dsh: process.env['DSH_HOME'],
  baseURL: `http://127.0.0.1:${port}`, relay: 'http://127.0.0.1:8787',
  model: 'deepseek-flash', pid: process.pid, sandboxHome: process.env['A2A_SANDBOX_HOME'] }
const previous = await readFile(join(out, 'info.json'), 'utf8').then(JSON.parse).catch(() => ({}))
await writeFile(join(out, 'info.json'), JSON.stringify({ ...(previous.root === root ? previous : {}), ...info }, null, 2))
console.log(JSON.stringify(info))
