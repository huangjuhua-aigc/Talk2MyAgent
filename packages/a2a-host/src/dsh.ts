/**
 * Managing the resident dsh process the console starts.
 *
 * The child belongs to this CLI process; its stdout/stderr feed a bounded
 * ring buffer the UI polls, so closing the browser never orphans the log.
 *
 * @module a2a-host/dsh
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { launchCommand } from './files.ts'
import { agentPidPath } from './paths.ts'

/** Kill one PID and its children; the tree matters on Windows. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/PID', String(pid), '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

/** Whether a PID is alive (signal 0 probes without sending anything). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Bounded log ring buffer. */
class LogRing {
  private readonly lines: string[] = []
  constructor(private readonly limit = 500) {}
  push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit)
  }
  tail(count = 80): string[] {
    return this.lines.slice(-count)
  }
}

/** The one resident dsh process ONE agent runs under. */
export class DshRunner {
  private child: ChildProcess | undefined
  private readonly logs = new LogRing()

  constructor(private readonly agentId: string) {}

  private pidFile(): string {
    return agentPidPath(this.agentId)
  }

  /** The PID a previous console session recorded, when it is still alive. */
  private adoptedPid(): number | undefined {
    try {
      const pid = Number(readFileSync(this.pidFile(), 'utf8').trim())
      return Number.isInteger(pid) && pid > 0 && pidAlive(pid) ? pid : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Whether a resident dsh is running — ours, or one a previous console
   * session left behind (closing the console never stops the online agent;
   * that is the product's intent, so the PID is remembered and adopted).
   */
  get running(): boolean {
    if (this.child !== undefined && this.child.exitCode === null) return true
    return this.adoptedPid() !== undefined
  }

  /**
   * Start dsh with the overlay patch; `firstTime` adds the web template.
   * @returns whether a NEW process was started (false = already running).
   */
  start(profile: string, firstTime: boolean, patchPath: string, bind: { host: string; port: number }): boolean {
    if (this.running) return false
    const { command, args } = launchCommand(profile, firstTime, patchPath, bind)
    this.logs.push(`$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, { shell: process.platform === 'win32' })
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.length > 0) this.logs.push(line)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.length > 0) this.logs.push(line)
    })
    child.on('close', (code) => {
      this.logs.push(`(dsh exited with code ${code ?? 'unknown'})`)
      this.child = undefined
      try {
        unlinkSync(this.pidFile())
      } catch {
        // Nothing recorded, or already cleared.
      }
    })
    this.child = child
    if (child.pid !== undefined) {
      try {
        writeFileSync(this.pidFile(), String(child.pid), 'utf8')
      } catch {
        // Best effort: without the file, only this session can stop the child.
      }
    }
    return true
  }

  /** Stop the resident process — ours, or the one adopted from the PID file. */
  stop(): boolean {
    const child = this.child
    if (child !== undefined && child.exitCode === null) {
      killTree(child.pid ?? 0)
      return true
    }
    const pid = this.adoptedPid()
    if (pid === undefined) return false
    killTree(pid)
    try {
      unlinkSync(this.pidFile())
    } catch {
      // Already cleared.
    }
    return true
  }

  /** The manual command the user can run themselves, for display. */
  manualCommand(profile: string, firstTime: boolean, patchPath: string, bind: { host: string; port: number }): string {
    const { command, args } = launchCommand(profile, firstTime, patchPath, bind)
    return `${command} ${args.join(' ')}`
  }

  /** Recent log lines for the UI. */
  tail(count?: number): string[] {
    return this.logs.tail(count)
  }
}

/** Install the protocol plugin into the profile; resolves with the output. */
export async function installPlugin(profile: string, source: string): Promise<{ ok: boolean; output: string }> {
  const child = spawn('dsh', ['plugin', '--profile', profile, 'add', source], {
    shell: process.platform === 'win32',
  })
  let output = ''
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, output: `${output}\n(timed out)` })
    }, 120_000)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: `${output}\n${String(error)}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // The CLI exits 0 even when the compatibility gate refused the install
      // ("nothing was installed"), so the output is the real verdict.
      const installed = code === 0 && !output.includes('nothing was installed')
      resolve({ ok: installed, output })
    })
  })
}
