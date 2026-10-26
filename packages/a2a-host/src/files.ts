/**
 * File generation and persistence, per saved agent: the overlay patch,
 * credentials, and the agent record under `~/.a2a/agents/`.
 *
 * Core principle: the console never touches a user-authored file beyond
 * `~/.dsh/.credentials.yaml`, and that one only with a `.bak` backup taken
 * before every write.
 *
 * @module a2a-host/files
 */

import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import type { HostState, WizardConfig } from './types.ts'
import { PROVIDERS, normalizeProvider } from './providers.ts'
import { derivedPublicUrl } from './url.ts'
import { briefingTaskPrompt } from './briefing.ts'
import {
  agentComposePath,
  agentConfigPath,
  agentPatchPath,
  agentBriefingPath,
  agentManagementPath,
  agentsHome,
  credentialsPath,
  hostHome,
  statePath,
} from './paths.ts'

/** One saved agent as it lives on disk. */
export interface AgentRecord {
  id: string
  /** The dsh profile this agent launches under. */
  profile: string
  config: WizardConfig
  createdAt: string
  updatedAt: string
}

/** The admin token's credential reference, unique per agent. */
export const adminRefFor = (id: string): string =>
  `A2A_ADMIN_TOKEN_${id.toUpperCase().replace(/-/g, '_')}`

/**
 * A visitor token's credential reference on the HOST side, unique per agent:
 * two agents can each have their own visitor "alice" without clobbering
 * each other's token. (The VISITOR side keeps its own naming — see the
 * wizard's instruction, which uses plain A2A_PEER_<NAME> on their machine.)
 */
export const refForPeer = (agentId: string, peer: string): string =>
  `A2A_PEER_${agentId.toUpperCase().replace(/-/g, '_')}_${peer.toUpperCase().replace(/-/g, '_')}`

/** A filesystem-safe id derived from the agent's display name. */
export function slugFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'agent'
}

/** The profile an agent id launches under. */
export const profileFor = (id: string): string => id === 'default' ? 'a2a' : `a2a-${id}`

/** The extra npm packages the configured models need beyond the protocol plugin. */
export function extraPackages(config: WizardConfig): string[] {
  const piAi = config.models.some(entry => PROVIDERS[entry.provider].piAi !== undefined)
  return piAi ? ['@deepseek-ai/dsh-llm-pi-ai'] : []
}

/** The plugin config rows a wizard result maps to. */
function patchRows(config: WizardConfig, adminRef: string, agentId: string): Record<string, unknown>[] {
  const peers: Record<string, { tokenEnv: string }> = {}
  for (const peer of config.peers) peers[peer.name] = { tokenEnv: refForPeer(agentId, peer.name) }
  const active = config.models[config.activeModelIndex] ?? config.models[0]
  if (active === undefined) throw new Error('the wizard config carries no model entry')
  const provider = PROVIDERS[active.provider]
  const publicUrl = derivedPublicUrl(config.network)
  const rows: Record<string, unknown>[] = [
    {
      id: 'a2a-server',
      name: 'dsh-a2a-server',
      config: {
        basePath: '/a2a',
        ...publicUrl === undefined ? {} : { publicUrl },
        provider: provider.route,
        model: active.model,
        card: {
          name: config.card.name,
          description: config.card.description,
          public: true,
          skills: [],
        },
        peers,
        // Admitted visitors may converse and read the configured data directory.
        // The plugin exposes only its scoped read_file; other tools stay denied.
        trustedPeers: config.peers.filter(peer => peer.trusted).map(peer => peer.name),
        isolation: {
          // The wizard always isolates per visitor; a shared workspace remains
          // a hand-written-config capability of the plugin.
          workspaceMode: 'per-peer',
          workspaceRoot: config.isolation.workspaceRoot,
          peerWorkspaces: config.isolation.peerWorkspaces,
        },
        // The opening briefing is always on — it is the product's premise,
        // not a deployment decision.
        preamble: { files: ['.hop/handoff.md'] },
        briefing: { settingsFile: agentBriefingPath(agentId), prompt: briefingTaskPrompt(config.isolation.workspaceRoot) },
        admin: { tokenEnv: adminRef, socketPath: agentManagementPath(agentId) },
        push: { enabled: false },
      },
    },
  ]
  // Every configured family that rides the pi-ai adapter gets its route —
  // the active one AND the standby ones, so switching the active model later
  // is a one-field change rather than a reconfiguration.
  const piAiRoutes: Record<string, Record<string, unknown>> = {}
  for (const entry of config.models) {
    const info = PROVIDERS[entry.provider]
    if (info.piAi !== undefined && piAiRoutes[info.route] === undefined) {
      piAiRoutes[info.route] = { ...info.piAi, apiKeyEnv: info.keyRef }
    }
  }
  if (Object.keys(piAiRoutes).length > 0) {
    rows.push({
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { providers: piAiRoutes },
    })
  }
  // Keep the sandbox as defense in depth. Visitor capabilities are independently
  // limited to the plugin's rooted reader; this setting cannot grant writes.
  rows.push({
    id: 'sandbox-policy',
    name: '@deepseek-ai/dsh-sandbox-policy',
    config: {
      mode: 'read-only',
      workspaceRoot: config.isolation.workspaceRoot,
    },
  })
  return rows
}

/** The overlay patch file's full content, as dsh's `--patch` layer expects it. */
export function buildPatchYaml(config: WizardConfig, adminRef: string, agentId: string): string {
  return stringify([{ insert: patchRows(config, adminRef, agentId) }])
}

/** Only the credentials entries the wizard owns, for one agent. */
export function buildCredentialEntries(config: WizardConfig, adminRef: string, agentId: string): Record<string, string> {
  const entries: Record<string, string> = { [adminRef]: config.adminToken }
  for (const peer of config.peers) entries[refForPeer(agentId, peer.name)] = peer.token
  // Every pasted key lands under its family's reference; same-family entries
  // beyond the first are ignored (they share one reference by design).
  for (const entry of config.models) {
    const key = entry.apiKey
    const ref = PROVIDERS[entry.provider].keyRef
    if (key !== undefined && key.length > 0 && entries[ref] === undefined) {
      entries[ref] = key
    }
  }
  return entries
}

/** Write one text file, creating parent directories. */
async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

/** Merge entries into `~/.dsh/.credentials.yaml`, backing it up first. */
export async function writeCredentials(entries: Record<string, string>): Promise<void> {
  const path = credentialsPath()
  let current: Record<string, unknown> = {}
  try {
    const parsed = parse(await readFile(path, 'utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null) current = parsed as Record<string, unknown>
  } catch {
    // Absent or unparseable: start fresh, but keep a copy of whatever was there.
    try {
      await copyFile(path, `${path}.corrupt.bak`)
    } catch {
      // Nothing to back up.
    }
  }
  try {
    await copyFile(path, `${path}.bak`)
  } catch {
    // No previous file: nothing to back up.
  }
  // The managed document keeps references under `refs:`; write there so the
  // harness actually resolves them, while leaving any legacy top-level keys
  // untouched.
  const refs = typeof current['refs'] === 'object' && current['refs'] !== null
    ? current['refs'] as Record<string, unknown>
    : {}
  await writeText(path, stringify({ ...current, refs: { ...refs, ...entries } }))
}

/** The launch command for the native (non-Docker) mode, for display and spawn. */
export function launchCommand(
  profile: string,
  firstTime: boolean,
  patchPath: string,
  bind: { host: string; port: number },
): { command: string; args: string[] } {
  return {
    command: 'dsh',
    args: [
      '--profile', profile,
      ...(firstTime ? ['--from-default-profile', 'web'] : []),
      // Launcher flags must precede app args: anything after the first app
      // arg is parsed by the app.
      '--patch', patchPath,
      // The web server binds one concrete address — a loopback-bound agent is
      // invisible to visitors. The port is the configured one; the host is the
      // configured IP, the detected LAN IP, or loopback as the last resort.
      '--host', bind.host,
      '--port', String(bind.port),
      // The online agent is a headless daemon: no Web UI window, ever — the
      // console is its only face.
      '--no-open',
    ],
  }
}

/**
 * Persist one agent: its record, its overlay patch, and its credentials
 * entries.
 */
export async function saveAgent(record: AgentRecord): Promise<string[]> {
  const adminRef = adminRefFor(record.id)
  const written: string[] = []
  await writeText(agentPatchPath(record.id), buildPatchYaml(record.config, adminRef, record.id))
  written.push(agentPatchPath(record.id))
  await writeCredentials(buildCredentialEntries(record.config, adminRef, record.id))
  written.push(credentialsPath())
  await writeText(agentConfigPath(record.id), JSON.stringify(record, null, 2))
  written.push(agentConfigPath(record.id))
  return written
}

/** Refresh generated runtime config without rewriting credentials or preferences. */
export async function refreshAgentPatch(record: AgentRecord): Promise<void> {
  await writeText(agentPatchPath(record.id), buildPatchYaml(record.config, adminRefFor(record.id), record.id))
}

/** Read one agent's record; undefined when it does not exist. */
export async function loadAgent(id: string): Promise<AgentRecord | undefined> {
  try {
    return JSON.parse(await readFile(agentConfigPath(id), 'utf8')) as AgentRecord
  } catch {
    return undefined
  }
}

/** Delete one agent's files (record, patch, compose). */
export async function deleteAgentFiles(id: string): Promise<void> {
  await Promise.allSettled([
    rm(agentConfigPath(id), { force: true }),
    rm(agentPatchPath(id), { force: true }),
    rm(agentComposePath(id), { force: true }),
    rm(agentBriefingPath(id), { force: true }),
  ])
}

/** Every saved agent's record, sorted by update time (newest first). */
export async function listAgents(): Promise<AgentRecord[]> {
  await migrateLegacyState()
  const { readdir } = await import('node:fs/promises')
  let names: string[] = []
  try {
    names = await readdir(agentsHome())
  } catch {
    return []
  }
  const records: AgentRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const record = await loadAgent(name.slice(0, -'.json'.length))
    if (record !== undefined) records.push(record)
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Migrate the legacy single-agent `state.json` into `agents/default.json`,
 * once: the old file is left in place untouched after the copy. Older wizard
 * shapes (single `model`, route-name providers, global `trustedAll`) are
 * normalized here, because generation depends on the current shape.
 */
async function migrateLegacyState(): Promise<void> {
  if (existsSync(agentConfigPath('default')) || !existsSync(statePath())) return
  try {
    const legacy = JSON.parse(await readFile(statePath(), 'utf8')) as {
      config?: Partial<WizardConfig> & { model?: WizardConfig['models'][number]; trustedAll?: boolean }
      createdAt?: string
      updatedAt?: string
    }
    if (legacy.config === undefined) return
    const raw = legacy.config
    const models = raw.models !== undefined
      ? raw.models.map(entry => ({ ...entry, provider: normalizeProvider(entry.provider) }))
      : raw.model !== undefined
        ? [{ ...raw.model, provider: normalizeProvider(raw.model.provider) }]
        : []
    if (models.length === 0) return
    const now = new Date().toISOString()
    await saveAgent({
      id: 'default',
      profile: profileFor('default'),
      config: {
        ...raw,
        models,
        activeModelIndex: raw.activeModelIndex ?? 0,
        peers: (raw.peers ?? []).map(peer => ({
          ...peer,
          trusted: peer.trusted ?? raw.trustedAll ?? true,
        })),
      } as WizardConfig,
      createdAt: legacy.createdAt ?? now,
      updatedAt: legacy.updatedAt ?? now,
    })
  } catch {
    // Unreadable legacy state: nothing to migrate.
  }
}

/** An unused agent id for a display name, appending a counter on collision. */
export async function freshIdFor(name: string): Promise<string> {
  const base = slugFor(name)
  let candidate = base
  let counter = 2
  while (existsSync(agentConfigPath(candidate))) {
    candidate = `${base}-${String(counter)}`
    counter += 1
  }
  return candidate
}
