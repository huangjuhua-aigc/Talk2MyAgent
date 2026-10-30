import { createServer } from 'node:net'

/** Fail before installing plugins or launching DSH when its listener cannot bind. */
export async function assertPortAvailable(bind: { host: string; port: number }): Promise<void> {
  if (!Number.isInteger(bind.port) || bind.port < 1 || bind.port > 65535) {
    throw new Error('本地 Agent 端口必须是 1 到 65535 之间的整数')
  }
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`本地 Agent 端口 ${bind.port} 已被占用。请在“编辑配置 → 网络 → 高级网络设置”中更换空闲端口；Relay 服务地址中的端口无需改动。`))
      } else {
        reject(new Error(`无法监听本地 Agent 地址 ${bind.host}:${bind.port}（${error.code ?? error.message}）`))
      }
    })
    probe.once('listening', () => { probe.close(error => error ? reject(error) : resolve()) })
    probe.listen({ ...bind, exclusive: true })
  })
}
