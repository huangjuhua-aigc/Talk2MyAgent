/**
 * Shared types across the console: what the wizard collects, what lands in
 * `~/.a2a/state.json`, and what the API exchanges with the UI.
 *
 * @module a2a-host/types
 */

/** One visitor's identity, credential, and conversation admission. */
export interface PeerEntry {
  name: string
  token: string
  /** Whether this visitor may converse and use the rooted read_file capability. */
  trusted: boolean
}

/** The LLM families the wizard knows how to wire. */
export type ProviderKind =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'doubao'
  | 'zhipu'
  | 'kimi'
  | 'stepfun'

/** One configured model; several may exist while exactly one is active. */
export interface ModelEntry {
  provider: ProviderKind
  model: string
  /** Pasted at setup; stored under the family's credential reference. */
  apiKey?: string | undefined
}

/** Everything the wizard collects in its seven screens. */
export interface WizardConfig {
  card: { name: string; description: string }
  models: ModelEntry[]
  /** Which entry the online agent actually runs on. */
  activeModelIndex: number
  peers: PeerEntry[]
  /** The monitoring token (credential reference A2A_ADMIN_TOKEN). */
  adminToken: string
  isolation: {
    /** Owner-selected shared read-only data root. Per-visitor runtime cwd
     *  directories remain separate beneath it. */
    workspaceRoot: string
    /** Optional per-visitor cwd and authorized read-root overrides. */
    peerWorkspaces: Record<string, string>
  }
  network: {
    mode: 'lan' | 'custom' | 'relay'
    relay?: { provider: 'default' | 'custom'; host?: string; enabled: boolean }
    /** Explicit local listener; custom public URLs default to loopback. */
    bindHost?: string
    /** The address visitors reach: a LAN IP, a tailscale IP, or a domain. */
    host?: string | undefined
    /** Legacy full URL; superseded by `host` but still honored when read. */
    publicUrl?: string | undefined
    /** The port dsh's web server listens on (web profile default: 3080). */
    port: number
  }
}

/** The persisted console state. */
export interface HostState {
  version: 1
  profile: string
  config: WizardConfig
  createdAt: string
  updatedAt: string
}

/** What detection learned about one API key reference. */
export interface KeyStatus {
  configured: boolean
  /** Where it was found: an environment variable name, or the credentials file. */
  source?: string
  /** A masked preview, e.g. `sk-3f…9a2K`; never the whole key. */
  masked?: string
  /** The full value, shown only inside the local console when requested. */
  value?: string
}

/** What the detection screen reports. */
export interface DetectResult {
  node: { version: string; ok: boolean }
  dsh: { installed: boolean; version?: string | undefined }
  docker: { installed: boolean; version?: string | undefined }
  /** Status of every provider family's key reference. */
  keys: Record<string, KeyStatus>
  /** This machine's LAN IPv4 addresses, best-route one first. */
  lanIps: string[]
  profile: { exists: boolean; pluginInstalled: boolean }
  configured: boolean
}

/** A monitoring snapshot row as the plugin's admin surface returns it. */
export interface MonitorTask {
  taskId: string
  state: string
  input?: string
  output?: string
  updatedAt: string
}

export interface MonitorContext {
  contextId: string
  peer: string
  cwd: string
  lastTouchedAt: number
  active: number
  tasks: MonitorTask[]
}

export interface MonitorSnapshot {
  generatedAt: string
  contexts: MonitorContext[]
}

/** The currently published briefing, as read from the workspace. */
export interface HandoffSnapshot {
  text: string
  updatedAt: string | null
  autoUpdateEnabled: boolean
}
