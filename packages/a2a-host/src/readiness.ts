/** A spawned process is not an online Agent. Wait for its actual A2A surface. */
export async function waitForAgentReady(bind: { host: string; port: number }, options: {
  isRunning: () => boolean; timeoutMs?: number; intervalMs?: number
}): Promise<void> {
  const host = bind.host === '0.0.0.0' ? '127.0.0.1' : bind.host === '::' ? '::1' : bind.host
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${bind.port}/.well-known/agent-card.json`
  const deadline = Date.now() + (options.timeoutMs ?? 120_000)
  while (Date.now() < deadline) {
    if (!options.isRunning()) throw new Error('Agent 启动失败，进程已退出；请查看启动日志')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))), redirect: 'error' })
      if (response.ok) {
        const card = await response.json() as { name?: unknown; supportedInterfaces?: unknown }
        if (typeof card.name === 'string' && Array.isArray(card.supportedInterfaces)) return
      } else await response.body?.cancel()
    } catch { /* The local listener is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 250))
  }
  throw new Error('Agent 启动超时，A2A 服务尚未就绪；请查看启动日志后重试')
}
