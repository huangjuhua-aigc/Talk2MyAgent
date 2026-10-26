/**
 * Where the console keeps its files.
 *
 * @module a2a-host/paths
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

/** The console's own home: `~/.a2a` (overridable for tests via A2A_HOST_HOME). */
export const hostHome = (): string => process.env['A2A_HOST_HOME'] ?? join(homedir(), '.a2a')

/** The harness home: `$DSH_HOME` or `~/.dsh`. */
export const dshHome = (): string => process.env['DSH_HOME'] ?? join(homedir(), '.dsh')

/** `~/.a2a/state.json` — the legacy single-agent state (migrated on first run). */
export const statePath = (): string => join(hostHome(), 'state.json')

/** `~/.a2a/agents/` — one saved agent per file. */
export const agentsHome = (): string => join(hostHome(), 'agents')

/** One agent's saved record. */
export const agentConfigPath = (id: string): string => join(agentsHome(), `${id}.json`)

/** One agent's overlay patch, passed to dsh via `--patch` at launch. */
export const agentPatchPath = (id: string): string => join(agentsHome(), `${id}.patch.yml`)

/** A small preference file shared with the running plugin; absent means enabled. */
export const agentBriefingPath = (id: string): string => join(hostHome(), 'briefings', `${id}.json`)

/** One agent's compose file (Docker guard only). */
export const agentComposePath = (id: string): string => join(agentsHome(), `${id}.compose.yaml`)

/** One agent's resident-process PID memory, so a restarted console can stop it. */
export const agentPidPath = (id: string): string => join(agentsHome(), `${id}.pid`)

/** Private owner/monitoring transport, independent of the public TCP listener. */
export const agentManagementPath = (id: string): string => process.platform === 'win32'
  ? `\\\\.\\pipe\\talk2myagent-${id}` : join(hostHome(), 'run', `${id}.sock`)

/** `~/.dsh/.credentials.yaml` — where visitor and admin tokens live. */
export const credentialsPath = (): string => join(dshHome(), '.credentials.yaml')
