/**
 * The console's local HTTP surface: the static UI plus the /api the UI talks
 * to. Binds 127.0.0.1 only — it manages tokens, so it never leaves the machine.
 *
 * Agents are first-class: every operation below is per saved agent, and the
 * resident dsh processes are tracked one per agent.
 *
 * @module a2a-host/server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { existsSync } from 'node:fs'
import { detect } from './detect.ts'
import {
  adminRefFor,
  deleteAgentFiles,
  freshIdFor,
  listAgents,
  loadAgent,
  profileFor,
  saveAgent,
  refreshAgentPatch,
  type AgentRecord,
} from './files.ts'
import { DshRunner, installPlugin } from './dsh.ts'
import { fetchSnapshot } from './monitor.ts'
import { automaticBriefingEnabled, setAutomaticBriefing } from './briefing.ts'
import { resolveBindHost } from './url.ts'
import { pickDirectory } from './pick.ts'
import { agentPatchPath, agentManagementPath } from './paths.ts'
import type { WizardConfig } from './types.ts'

/** Fixed by design: the vite dev proxy expects this port. */
const PORT = Number(process.env['A2A_HOST_PORT'] ?? 17890)

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const webDist = join(import.meta.dirname, '..', 'web', 'dist')

/** One resident runner per agent id, lazily created. */
const runners = new Map<string, DshRunner>()
const runnerFor = (id: string): DshRunner => {
  let runner = runners.get(id)
  if (runner === undefined) {
    runner = new DshRunner(id)
    runners.set(id, runner)
  }
  return runner
}

/** Read one JSON request body. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Serve the built UI, with the SPA fallback to index.html. */
async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const relative = normalize(path).replace(/^([/\\])+/, '')
  const candidate = join(webDist, relative)
  const file = candidate.startsWith(webDist) && existsSync(candidate) && extname(candidate) !== ''
    ? candidate
    : join(webDist, 'index.html')
  try {
    const content = await readFile(file)
    // index.html must never be cached (it names the hashed bundle), or every
    // console update would require a hard refresh; hashed assets cache freely.
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
    })
    res.end(content)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('UI not built yet — run: pnpm build:web')
  }
}

/** `[/api/agents/<id>](/sub...)` → [id, subresource]. */
function parseAgentPath(pathname: string): { id: string; sub: string } | undefined {
  const match = /^\/api\/agents\/([^/]+)(?:\/([\w-]+))?/.exec(pathname)
  if (match === null) return undefined
  return { id: decodeURIComponent(match[1] ?? ''), sub: match[2] ?? '' }
}

/** The /api routing table. */
async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method ?? 'GET'} ${url.pathname}`

  if (route === 'GET /api/detect') {
    json(res, 200, await detect('a2a'))
    return
  }

  if (route === 'POST /api/pick-directory') {
    json(res, 200, await pickDirectory())
    return
  }

  if (route === 'POST /api/ensure-plugin') {
    // The detection screen installs the protocol plugin proactively; a
    // nonexistent profile is created by `dsh plugin add` itself.
    const result = await installPlugin('a2a', 'dsh-a2a-server')
    json(res, 200, result)
    return
  }

  if (route === 'GET /api/agents') {
    const agents = await listAgents()
    json(res, 200, agents.map(record => ({
      id: record.id,
      profile: record.profile,
      name: record.config.card.name,
      running: runnerFor(record.id).running,
      port: record.config.network.port,
    })))
    return
  }

  if (route === 'POST /api/agents') {
    const config = await readBody(req) as WizardConfig
    if (config.adminToken === undefined || config.adminToken.length === 0) {
      json(res, 400, { error: 'adminToken is required' })
      return
    }
    const now = new Date().toISOString()
    const id = await freshIdFor(config.card.name)
    const record: AgentRecord = { id, profile: profileFor(id), config, createdAt: now, updatedAt: now }
    const written = await saveAgent(record)
    json(res, 200, { record, written })
    return
  }

  const agentPath = parseAgentPath(url.pathname)
  if (agentPath === undefined) {
    json(res, 404, { error: `no such route: ${route}` })
    return
  }
  const { id, sub } = agentPath
  const record = await loadAgent(id)
  if (record === undefined) {
    json(res, 404, { error: `no saved agent "${id}"` })
    return
  }
  const runner = runnerFor(id)

  if (sub === '' && req.method === 'GET') {
    json(res, 200, { ...record, running: runner.running })
    return
  }

  if (sub === '' && (req.method === 'PUT' || req.method === 'POST')) {
    const config = await readBody(req) as WizardConfig
    if (config.adminToken === undefined || config.adminToken.length === 0) {
      json(res, 400, { error: 'adminToken is required' })
      return
    }
    const updated: AgentRecord = {
      ...record,
      config,
      updatedAt: new Date().toISOString(),
    }
    const written = await saveAgent(updated)
    json(res, 200, { record: updated, written, note: `admin token stored under ${adminRefFor(id)} in ~/.dsh/.credentials.yaml` })
    return
  }

  if (sub === '' && req.method === 'DELETE') {
    await runner.stop()
    await deleteAgentFiles(id)
    runners.delete(id)
    json(res, 200, { deleted: id })
    return
  }

  if (sub === 'preview' && req.method === 'POST') {
    const { buildCredentialEntries, buildPatchYaml } = await import('./files.ts')
    const config = await readBody(req) as WizardConfig
    json(res, 200, {
      patchYaml: buildPatchYaml(config, adminRefFor(id), id),
      credentials: buildCredentialEntries(config, adminRefFor(id), id),
      launch: runner.manualCommand(record.profile, false, agentPatchPath(id), {
        host: record.config.network.host ?? '127.0.0.1',
        port: record.config.network.port,
      }),
    })
    return
  }

  if (sub === 'install' && req.method === 'POST') {
    const { extraPackages } = await import('./files.ts')
    const body = await readBody(req) as { sources?: string[] }
    const sources = body.sources ?? ['dsh-a2a-server', ...extraPackages(record.config)]
    const results: { source: string; ok: boolean; output: string }[] = []
    for (const source of sources) {
      results.push({ source, ...await installPlugin(record.profile, source) })
    }
    json(res, 200, { results })
    return
  }

  if (sub === 'start' && req.method === 'POST') {
    // Belt and braces: if the plugin is missing (a fresh profile, or a
    // family beyond the detection screen's default profile), install it
    // before the process starts so the overlay patch finds its package.
    const { extraPackages } = await import('./files.ts')
    const detected = await detect(record.profile)
    if (!detected.profile.pluginInstalled) {
      await installPlugin(record.profile, 'dsh-a2a-server')
    }
    for (const pkg of extraPackages(record.config)) {
      await installPlugin(record.profile, pkg)
    }
    const bindHost = resolveBindHost(record.config.network, detected.lanIps)
    const bind = { host: bindHost, port: record.config.network.port }
    const firstTime = !detected.profile.exists
    await refreshAgentPatch(record)
    const started = runner.start(record.profile, firstTime, agentPatchPath(id), bind)
    json(res, 200, { started, manual: runner.manualCommand(record.profile, firstTime, agentPatchPath(id), bind) })
    return
  }

  if (sub === 'stop' && req.method === 'POST') {
    json(res, 200, { stopped: runner.stop() })
    return
  }

  if (sub === 'status' && req.method === 'GET') {
    json(res, 200, { running: runner.running, logs: runner.tail() })
    return
  }

  if (sub === 'briefing-auto' && req.method === 'PUT') {
    const body = await readBody(req) as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: 'enabled must be a boolean' })
      return
    }
    await setAutomaticBriefing(id, body.enabled)
    json(res, 200, { enabled: body.enabled })
    return
  }
  if (sub === 'handoff' && req.method === 'GET') {
    const autoUpdateEnabled = await automaticBriefingEnabled(id)
    // The briefing is agent-level data at the workspace root, shared by every
    // visitor; the console edits it directly so no hooks are required.
    const { open } = await import('node:fs/promises')
    const { join } = await import('node:path')
    res.setHeader('cache-control', 'no-store')
    try {
      const file = await open(join(record.config.isolation.workspaceRoot, '.hop', 'handoff.md'), 'r')
      try {
        const text = await file.readFile('utf8')
        const { mtime } = await file.stat()
        json(res, 200, { text, updatedAt: mtime.toISOString(), autoUpdateEnabled })
      } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      json(res, 200, { text: '', updatedAt: null, autoUpdateEnabled })
    }
    return
  }

  if (sub === 'handoff' && req.method === 'PUT') {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join, dirname } = await import('node:path')
    const body = await readBody(req) as { text?: string }
    const path = join(record.config.isolation.workspaceRoot, '.hop', 'handoff.md')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body.text ?? '', 'utf8')
    json(res, 200, { saved: true, note: '每个新访客会话开启时自动注入；已在进行中的会话不受影响' })
    return
  }

  if (sub === 'monitor' && req.method === 'GET') {
    const result = await fetchSnapshot(agentManagementPath(id), record.config.adminToken)
    json(res, 200, result)
    return
  }

  json(res, 404, { error: `no such route: ${route}` })
}

/**
 * Start the console server and return once it is listening.
 * @returns the bound port.
 */
export async function serve(): Promise<number> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      void api(req, res, url).catch((error: unknown) => {
        json(res, 500, { error: String(error) })
      })
      return
    }
    void serveStatic(url.pathname, res)
  })
  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => {
      const address = server.address()
      resolve(address !== null && typeof address === 'object' ? address.port : PORT)
    })
  })
}

/** Open the default browser at a URL, per platform. */
export async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process')
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(command, () => { /* the browser is best-effort; the URL is printed */ })
}
