import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'

/** Never expose the web login URL or authorization credentials in Portal diagnostics. */
function redact(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/([?&](?:token|access_token|refresh_token|code)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)\S+/gi, '$1[redacted]')
    .replace(/("(?:token|access_token|refresh_token|client_secret)"\s*:\s*")[^"]*/gi, '$1[redacted]')
}

/** File-backed child output survives a Portal restart; errors belong to one launch only. */
export class DshLog {
  private attemptOffset: number | undefined
  constructor(private readonly path: string) {}
  begin(): void {
    try { this.attemptOffset = statSync(this.path).size } catch { this.attemptOffset = 0 }
  }
  lines(count = 80, currentAttempt = false): string[] {
    let fd: number | undefined
    try {
      fd = openSync(this.path, 'r')
      const size = fstatSync(fd).size
      const floor = currentAttempt ? Math.min(this.attemptOffset ?? size, size) : 0
      const start = Math.max(floor, size - 64 * 1024), buffer = Buffer.alloc(size - start)
      const read = readSync(fd, buffer, 0, buffer.length, start)
      const text = buffer.subarray(0, read).toString('utf8').split(/\r?\n/)
      if (start > floor) text.shift() // Discard a partial line at the bounded read's edge.
      return text.filter(Boolean).slice(-count).map(redact)
    } catch { return [] }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  failure(): string | undefined {
    if (this.attemptOffset === undefined) return
    for (const line of this.lines(500, true).reverse()) {
      const match = /^a2a-server \(dsh-a2a-server\): (?:\w*Error: )?(.+)$/.exec(line)
      if (!match) continue
      return match[1]!.slice(0, 2000).replace('Links and nested mounts are not allowed in container data:', '公共资料或访客工作区含不允许的链接或嵌套挂载：')
    }
  }
}
