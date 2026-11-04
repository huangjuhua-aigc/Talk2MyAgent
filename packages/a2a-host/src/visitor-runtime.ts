import { createRequire } from 'node:module'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshHome } from './paths.ts'
import { installPlugin } from './dsh.ts'
import type { StartupProgress } from './types.ts'

/** Override only for local development until the matching plugin is published. */
export const visitorPluginSource = (): string => process.env['A2A_PLUGIN_SOURCE'] || 'dsh-a2a-server@^0.4.0'

export function sandboxSupport(platform = process.platform, architecture = process.arch): { supported: boolean; reason?: string } {
  if (platform === 'darwin' && architecture !== 'arm64') return { supported: false, reason: '需要 Apple Silicon 和 ARM64 版 Node.js，暂不支持 Intel Mac' }
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(architecture)) return { supported: false, reason: '当前系统或处理器暂不支持本地沙箱' }
  return { supported: true }
}

async function installedRuntime(profile: string): Promise<string | undefined> {
  try {
    const manifest = createRequire(join(dshHome(), 'profiles', profile, 'package.json')).resolve('dsh-a2a-server/package.json')
    const version = JSON.parse(await readFile(manifest, 'utf8')).version as string
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    if (!match || Number(match[1]) === 0 && Number(match[2]) < 4) return undefined
    const runtime = join(dirname(manifest), 'lib', 'microsandbox-runtime.js')
    await access(runtime)
    return runtime
  } catch { return undefined }
}

export type VisitorExecution = 'microsandbox' | 'read-only'

/**
 * Visitor tool execution mode. Defaults to Microsandbox; hosts without working
 * nested virtualization may opt out with A2A_VISITOR_EXECUTION=read-only, which
 * drops VM isolation and leaves only the scoped read-only workspace boundary.
 */
export function visitorExecution(env: NodeJS.ProcessEnv = process.env): VisitorExecution {
  const value = env['A2A_VISITOR_EXECUTION']?.trim()
  if (!value || value === 'microsandbox') return 'microsandbox'
  if (value === 'read-only') return 'read-only'
  throw new Error(`Invalid A2A_VISITOR_EXECUTION: ${JSON.stringify(value)} (expected "microsandbox" or "read-only")`)
}

/** Prepare the visitor runtime unless the host opted out of Microsandbox. */
export async function prepareVisitorRuntime(profile: string, options: Parameters<typeof requireVisitorRuntime>[1] & { env?: NodeJS.ProcessEnv; require?: typeof requireVisitorRuntime } = {}): Promise<VisitorExecution> {
  const { env, require, ...rest } = options
  const mode = visitorExecution(env)
  if (mode === 'microsandbox') await (require ?? requireVisitorRuntime)(profile, rest)
  return mode
}

/** Upgrade a fresh/old profile and prepare the pinned local runtime automatically. */
export async function requireVisitorRuntime(profile: string, options: {
  onProgress?: (progress: StartupProgress) => void
  install?: typeof installPlugin
} = {}): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) throw new Error('Invalid profile')
  const support = sandboxSupport()
  if (!support.supported) throw new Error(support.reason)
  options.onProgress?.({ phase: 'checking', message: '正在检查访客沙箱…' })
  let file = await installedRuntime(profile)
  if (!file) {
    options.onProgress?.({ phase: 'installing', message: '正在自动更新 Agent 的沙箱插件…' })
    const source = visitorPluginSource()
    const result = await (options.install ?? installPlugin)(profile, source)
    if (!result.ok) {
      const detail = result.output.trim().slice(-2000)
      if (/ERR_PNPM_NO_MATCHING_VERSION|\bETARGET\b|No matching version found/i.test(result.output)) {
        throw new Error(`当前安装源尚未提供所需的沙箱插件版本（${source}）。请等待版本发布或镜像同步后重试。\n${detail}`)
      }
      throw new Error(`沙箱插件安装失败。\n${detail}`)
    }
    file = await installedRuntime(profile)
    if (!file) throw new Error('当前插件不包含 Microsandbox 支持，需要 dsh-a2a-server 0.4.0 或更高版本')
  }
  const url = pathToFileURL(file)
  url.searchParams.set('version', String((await stat(file)).mtimeMs))
  const runtime = await import(url.href) as { prepareMicrosandbox: (options: { onProgress?: (progress: StartupProgress) => void }) => Promise<unknown> }
  await runtime.prepareMicrosandbox(options.onProgress ? { onProgress: options.onProgress } : {})
}
