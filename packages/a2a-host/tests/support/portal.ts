/** Real Portal HTTP/filesystem, isolated homes, and a deterministic owner IPC. */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentRecord } from '../../src/files.ts'

export interface FixtureAgent {
  record: AgentRecord
  briefing: string
  taskState: string
  taskCalls: number
}

export async function startPortal(agentCount = 2) {
  const root = await mkdtemp(join(tmpdir(), 'a2a-ui-'))
  const host = join(root, 'console')
  const agents: FixtureAgent[] = []
  const owners: Server[] = []
  let child: ChildProcess | undefined
  const close = async (): Promise<void> => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
    await Promise.all(owners.map(async owner => {
      owner.closeAllConnections()
      if (owner.listening) await new Promise<void>(done => owner.close(() => done()))
    }))
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
  try {
    await mkdir(join(host, 'agents'), { recursive: true })
    await mkdir(join(host, 'run'), { recursive: true })
    for (let i = 0; i < agentCount; i++) {
      const id = `ui-${randomUUID()}`
      const name = i === 0 ? 'Alpha Agent' : 'Beta Agent'
      const workspace = join(root, `workspace-${i}`)
      await mkdir(join(workspace, '.hop'), { recursive: true })
      const agent: FixtureAgent = {
        record: { id, profile: `fixture-${id}`, createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - i * 1000).toISOString(),
          config: {
            card: { name, description: 'Automated test fixture' }, models: [{ provider: 'deepseek', model: 'fixture' }], activeModelIndex: 0,
            peers: [{ name: 'alice', token: 'fixture-visitor-token-1234567890', trusted: true }], adminToken: `fixture-owner-${id}`,
            isolation: { workspaceRoot: workspace, peerWorkspaces: {} }, network: { mode: 'custom', port: 9935 + i, host: '127.0.0.1' },
          } },
        briefing: join(workspace, '.hop', 'handoff.md'), taskState: 'TASK_STATE_COMPLETED', taskCalls: 0,
      }
      agents.push(agent)
      await writeFile(join(host, 'agents', `${id}.json`), JSON.stringify(agent.record))
      await writeFile(agent.briefing, `## 最近在做什么\n${name} 的第一版简报`)
      const owner = createServer((req, res) => {
        void (async () => {
          res.setHeader('content-type', 'application/json')
          if (req.headers.authorization !== `Bearer ${agent.record.config.adminToken}`) {
            res.writeHead(401); res.end('{}'); return
          }
          if (req.method === 'GET') {
            res.end(JSON.stringify({ generatedAt: new Date().toISOString(), contexts: [{ contextId: `${id}-context`, peer: 'alice',
              cwd: workspace, lastTouchedAt: Date.now(), active: 0, tasks: [{ taskId: `${id}-task`, state: 'TASK_STATE_COMPLETED',
                input: `${name} 的访客问题`, output: `${name} 的答复`, updatedAt: new Date().toISOString() }] },
              { contextId: `${id}-owner`, peer: 'owner', cwd: join(workspace, '.hop'), lastTouchedAt: Date.now(), active: 0,
                tasks: [{ taskId: `${id}-briefing`, state: 'TASK_STATE_COMPLETED', input: 'AUTOMATIC_BRIEFING_PRIVATE_TASK',
                  output: 'OWNER_BRIEFING_UPDATE', updatedAt: new Date().toISOString() }] }] }))
            return
          }
          let body = ''
          for await (const chunk of req) body += chunk
          if (JSON.parse(body).method !== 'SendMessage') throw new Error('Unexpected owner RPC')
          agent.taskCalls++
          if (agent.taskState === 'TASK_STATE_COMPLETED') await writeFile(agent.briefing, `${name} 自动生成的正式简报`)
          res.end(JSON.stringify({ result: { task: { status: { state: agent.taskState }, artifacts: [{ parts: [{ text:
            agent.taskState === 'TASK_STATE_COMPLETED' ? '已建立，正式简报已更新' : '测试任务未完成' }] }] } } }))
        })().catch(error => { res.writeHead(500); res.end(JSON.stringify({ error: { message: String(error) } })) })
      })
      owners.push(owner)
      const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\talk2myagent-${id}` : join(host, 'run', `${id}.sock`)
      await new Promise<void>((done, reject) => { owner.once('error', reject); owner.listen(socketPath, done) })
    }
    child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import { serve } from './src/server.ts'; console.log('PORT=' + await serve());"], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, A2A_HOST_HOME: host, DSH_HOME: join(root, 'dsh'), A2A_HOST_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    const processUnderTest = child
    const port = await new Promise<number>((done, reject) => {
      let output = '', errors = ''
      const timer = setTimeout(() => reject(new Error(`Portal startup timed out: ${errors}`)), 15_000)
      processUnderTest.stderr!.on('data', chunk => { errors = (errors + String(chunk)).slice(-2000) })
      processUnderTest.stdout!.on('data', chunk => {
        output += String(chunk)
        const match = /PORT=(\d+)/.exec(output)
        if (match) { clearTimeout(timer); done(Number(match[1])) }
      })
      processUnderTest.once('error', error => { clearTimeout(timer); reject(error) })
      processUnderTest.once('exit', code => { clearTimeout(timer); reject(new Error(`Portal exited ${code}: ${errors}`)) })
    })
    return { root, host, agents, baseURL: `http://127.0.0.1:${port}`, close,
      readRecord: async (id: string): Promise<AgentRecord> => JSON.parse(await readFile(join(host, 'agents', `${id}.json`), 'utf8')) as AgentRecord }
  } catch (error) { await close(); throw error }
}

export type TestPortal = Awaited<ReturnType<typeof startPortal>>
