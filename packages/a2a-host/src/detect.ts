/**
 * Environment detection for the wizard's first screen.
 *
 * @module a2a-host/detect
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { DetectResult, HostState, KeyStatus } from './types.ts'
import { credentialsPath, statePath } from './paths.ts'
import { PROVIDERS } from './providers.ts'

/** Run a command briefly and report whether it answered, plus its output. */
async function run(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  const { spawn } = await import('node:child_process')
  return await new Promise((resolve) => {
    const child = spawn(command, args, { shell: process.platform === 'win32' })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, output })
    }, 8000)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, output })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output })
    })
  })
}

/** Whether `~/.a2a/state.json` exists and parses. */
export async function readState(): Promise<HostState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(), 'utf8')) as HostState
  } catch {
    return undefined
  }
}

/** `sk-3f2a…9bK1` style: enough to recognize, never enough to use. */
function maskKey(value: string): string {
  if (value.length <= 8) return '…'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

/**
 * Status of every provider family's key: environment first, then the managed
 * credentials document. A hit carries its source and a masked preview.
 */
async function scanKeys(): Promise<Record<string, KeyStatus>> {
  let document: Record<string, unknown> = {}
  try {
    const parsed = (await import('yaml')).parse(await readFile(credentialsPath(), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) document = parsed as Record<string, unknown>
  } catch {
    // Absent or unparseable: environment is the only layer left.
  }
  // The managed document nests references under `refs:`; accept both shapes.
  const nested = typeof document['refs'] === 'object' && document['refs'] !== null
    ? document['refs'] as Record<string, unknown>
    : {}
  const keys: Record<string, KeyStatus> = {}
  for (const info of Object.values(PROVIDERS)) {
    const ref = info.keyRef
    const fromEnv = process.env[ref] ?? ''
    if (fromEnv.length > 0) {
      keys[ref] = { configured: true, source: `环境变量 ${ref}`, masked: maskKey(fromEnv), value: fromEnv }
      continue
    }
    const fromDoc = nested[ref] ?? document[ref]
    if (typeof fromDoc === 'string' && fromDoc.length > 0) {
      keys[ref] = { configured: true, source: '~/.dsh/.credentials.yaml', masked: maskKey(fromDoc), value: fromDoc }
      continue
    }
    keys[ref] = { configured: false }
  }
  return keys
}

/** Interface names that mean "not a real network" — usable but never first. */
const VIRTUAL_INTERFACE = /vEthernet|WSL|Hyper-V|Loopback|VMware|Virtual|Mihomo|TUN|Docker/i

/**
 * This machine's LAN IPv4 addresses, real interfaces first. A UDP-route probe
 * runs first (often polluted by proxies/VMs), then the interface scan, then —
 * on Windows — the system address table, which also sees public unicast
 * addresses a campus/hotspot WLAN may carry.
 */
async function detectLanIps(): Promise<string[]> {
  const found: { address: string; virtual: boolean }[] = []
  const add = (address: string, alias: string): void => {
    if (found.some(entry => entry.address === address)) return
    found.push({ address, virtual: VIRTUAL_INTERFACE.test(alias) })
  }
  try {
    const { createSocket } = await import('node:dgram')
    await new Promise<void>((resolve) => {
      const socket = createSocket('udp4')
      socket.once('connect', () => {
        const address = socket.address()
        if (typeof address === 'object') add(address.address, 'probe')
        socket.close()
        resolve()
      })
      socket.once('error', () => { resolve() })
      socket.connect(0, '8.8.8.8')
    })
  } catch {
    // Offline or blocked: fall back to the interface scan below.
  }
  const { networkInterfaces } = await import('node:os')
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal
        && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(net.address)) {
        add(net.address, name)
      }
    }
  }
  if (process.platform === 'win32') {
    try {
      const { spawn } = await import('node:child_process')
      const output = await new Promise<string>((resolve) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-Command',
          "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\\.|169\\.254\\.|198\\.1[89]\\.)' } | ForEach-Object { \"$($_.IPAddress)`t$($_.InterfaceAlias)\" }"])
        let text = ''
        child.stdout?.on('data', (chunk: Buffer) => { text += chunk.toString() })
        child.on('close', () => { resolve(text) })
        child.on('error', () => { resolve('') })
        setTimeout(() => { child.kill(); resolve(text) }, 5000)
      })
      for (const line of output.split('\n')) {
        const [address, alias] = line.trim().split('\t')
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address ?? '')) add(address as string, alias ?? '')
      }
    } catch {
      // The interface scan above already gave its best.
    }
  }
  return found
    .sort((a, b) => Number(a.virtual) - Number(b.virtual))
    .map(entry => entry.address)
}

/**
 * Detect everything the first screen shows.
 *
 * `dsh --profile a2a --dump-config` doubles as the profile probe: exit 0 means
 * the profile exists, and its output naming `dsh-a2a-server` means the plugin
 * is installed in it.
 */
export async function detect(profile: string): Promise<DetectResult> {
  const nodeVersion = process.versions.node ?? ''
  const nodeMajor = Number(nodeVersion.split('.')[0] ?? '0')
  const dsh = await run('dsh', ['--version'])
  const docker = await run('docker', ['--version'])
  const dump = await run('dsh', ['--profile', profile, '--dump-config'])
  return {
    node: { version: nodeVersion, ok: nodeMajor >= 22 },
    dsh: dsh.ok
      ? { installed: true, version: dsh.output.trim().split('\n')[0]?.slice(0, 80) }
      : { installed: false },
    docker: docker.ok
      ? { installed: true, version: docker.output.trim().split('\n')[0]?.slice(0, 80) }
      : { installed: false },
    keys: await scanKeys(),
    lanIps: await detectLanIps(),
    profile: {
      exists: dump.ok,
      pluginInstalled: dump.ok && dump.output.includes('dsh-a2a-server'),
    },
    configured: existsSync(statePath()),
  }
}
