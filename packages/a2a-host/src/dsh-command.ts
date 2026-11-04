import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

/** npm's Windows .cmd shim concatenates arguments; invoke its Node entry directly. */
export function dshCommand(args: string[], options: { platform?: NodeJS.Platform; searchPath?: string } = {}): { command: string; args: string[] } {
  if ((options.platform ?? process.platform) !== 'win32') return { command: 'dsh', args }
  for (const dir of (options.searchPath ?? process.env['PATH'] ?? '').split(delimiter)) {
    for (const manifest of [join(dir, 'node_modules/@deepseek-ai/dsh/package.json'), join(dir, '../@deepseek-ai/dsh/package.json')]) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: string | { dsh?: string } }
        const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
        if (entry && existsSync(resolve(dirname(manifest), entry))) return { command: process.execPath, args: [resolve(dirname(manifest), entry), ...args] }
      } catch { /* Continue to the next installed CLI. */ }
    }
    if (existsSync(join(dir, 'dsh.exe'))) return { command: join(dir, 'dsh.exe'), args }
  }
  throw new Error('未找到 dsh 的启动文件，请重新安装 @deepseek-ai/dsh 后重试')
}
