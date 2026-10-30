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
import { listAgents, refreshAgentPatch, saveAgent } from './files.ts'
import { agentManagementPath, agentPatchPath } from './paths.ts'
import { detect } from './detect.ts'
import { fetchSnapshot } from './monitor.ts'
import { resolveBindHost } from './url.ts'
import { publish, stopPublication, recordRuntime, validateSharedRoots, publicationStatus } from './publication.ts'

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
} else if (['start', 'stop', 'status', 'monitor', 'publish', 'unpublish', 'publication'].includes(command)) {
  const agent = await target()
  const runner = new DshRunner(agent.id)
  if (command === 'start') {
    await validateSharedRoots(agent.config)
    const detected = await detect(agent.profile)
    const firstTime = !detected.profile.exists
    const bindHost = resolveBindHost(agent.config.network, detected.lanIps)
    const bind = { host: bindHost, port: agent.config.network.port }
    await refreshAgentPatch(agent)
    const started = runner.start(agent.profile, firstTime, agentPatchPath(agent.id), bind)
    if (started) await recordRuntime(agent, bind)
    if (agent.config.network.mode === 'relay' && agent.config.network.relay?.enabled !== false) await publish(agent)
    console.log(runner.manualCommand(agent.profile, firstTime, agentPatchPath(agent.id), bind))
    console.log('started (closing this console does NOT stop the online agent; use: a2a-host stop)')
  } else if (command === 'stop') {
    await stopPublication(agent.id)
    const stopped = runner.stop()
    console.log(stopped ? 'online agent stopped' : 'no running online agent found')
  } else if (command === 'publish') {
    agent.config.network.mode = 'relay'
    agent.config.network.relay = { ...agent.config.network.relay, provider: agent.config.network.relay?.provider ?? 'default', enabled: true }
    await saveAgent(agent)
    console.log(JSON.stringify(await publish(agent), null, 2))
  } else if (command === 'unpublish') {
    await stopPublication(agent.id)
    if (agent.config.network.relay) { agent.config.network.relay.enabled = false; await saveAgent(agent) }
    console.log('publication stopped')
  } else if (command === 'publication') {
    console.log(JSON.stringify(await publicationStatus(agent.id), null, 2))
  } else {
    const result = await fetchSnapshot(agentManagementPath(agent.id), agent.config.adminToken)
    console.log(JSON.stringify(result, null, 2))
  }
} else {
  console.error(`unknown command: ${command}`)
  console.error('usage: a2a-host [ui|start|stop|status|monitor|publish|unpublish|publication] [agentId]')
  process.exit(1)
}
