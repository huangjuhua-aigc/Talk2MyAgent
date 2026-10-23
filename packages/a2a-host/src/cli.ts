#!/usr/bin/env node
/**
 * a2a-host — the Talk2MyAgent console.
 *
 *   a2a-host            open the console (wizard on first run, monitoring after)
 *   a2a-host start      start the resident dsh agent headlessly
 *   a2a-host stop       stop it
 *   a2a-host status     running state + recent logs
 *   a2a-host monitor    print one monitoring snapshot as JSON
 *
 * @module a2a-host/cli
 */

import { serve, openBrowser } from './server.ts'
import { DshRunner } from './dsh.ts'
import { listAgents } from './files.ts'
import { agentPatchPath } from './paths.ts'
import { detect } from './detect.ts'
import { fetchSnapshot } from './monitor.ts'

const command = process.argv[2] ?? 'ui'
/** Optional agent id argument; defaults to the newest saved agent. */
const wantedId = process.argv[3]

async function target() {
  const agents = await listAgents()
  if (agents.length === 0) {
    console.error('no saved agents yet — run `a2a-host` and use the wizard first')
    process.exit(1)
  }
  const agent = wantedId !== undefined ? agents.find(record => record.id === wantedId) : agents[0]
  if (agent === undefined) {
    console.error(`no saved agent "${wantedId ?? ''}" (have: ${agents.map(record => record.id).join(', ')})`)
    process.exit(1)
  }
  return agent
}

/** Explain a busy port instead of dumping a stack trace. */
function explainBusyPort(port: number): string {
  const win = process.platform === 'win32'
  return [
    `端口 ${port} 已被占用——可能是上一次的控制台进程没退干净。`,
    win
      ? `  查占用：netstat -ano | findstr :${port}\n  结束它：taskkill /T /PID <上面查到的PID>`
      : `  查占用：lsof -i :${port}\n  结束它：kill <上面查到的PID>`,
    `或者换个端口启动：A2A_HOST_PORT=${port + 1} 重新运行`,
  ].join('\n')
}

if (command === 'ui' || command === 'wizard') {
  let port: number
  try {
    port = await serve()
  } catch (error) {
    if ((error as { code?: string })?.code === 'EADDRINUSE') {
      console.error(explainBusyPort(Number(process.env['A2A_HOST_PORT'] ?? 17890)))
      process.exit(1)
    }
    throw error
  }
  const url = `http://127.0.0.1:${port}`
  console.log(`Talk2MyAgent console: ${url}`)
  console.log('  (local only — it manages tokens, keep it on this machine)')
  await openBrowser(url)
} else if (command === 'start' || command === 'stop' || command === 'status' || command === 'monitor') {
  const agent = await target()
  const runner = new DshRunner(agent.id)
  if (command === 'start') {
    const detected = await detect(agent.profile)
    const firstTime = !detected.profile.exists
    const configuredHost = agent.config.network.host
    const bindHost = configuredHost !== undefined && /^\d{1,3}(\.\d{1,3}){3}$/.test(configuredHost)
      ? configuredHost
      : detected.lanIps[0] ?? '127.0.0.1'
    const bind = { host: bindHost, port: agent.config.network.port }
    runner.start(agent.profile, firstTime, agentPatchPath(agent.id), bind)
    console.log(runner.manualCommand(agent.profile, firstTime, agentPatchPath(agent.id), bind))
    console.log('started (closing this console does NOT stop the online agent; use: a2a-host stop)')
  } else if (command === 'stop') {
    const stopped = runner.stop()
    console.log(stopped ? 'online agent stopped' : 'no running online agent found')
  } else {
    const result = await fetchSnapshot(`http://127.0.0.1:${String(agent.config.network.port)}`, agent.config.adminToken)
    console.log(JSON.stringify(result, null, 2))
  }
} else {
  console.error(`unknown command: ${command}`)
  console.error('usage: a2a-host [ui|start|stop|status|monitor] [agentId]')
  process.exit(1)
}
