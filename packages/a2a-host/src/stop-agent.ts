import type { AgentRecord } from './files.ts'
import type { DshRunner } from './dsh.ts'
import { agentManagementPath } from './paths.ts'
import { managementRequest } from './monitor.ts'

/** Windows tree termination must happen only after guest files have been flushed. */
export async function stopAgent(record: AgentRecord, runner: Pick<DshRunner, 'running' | 'stop'>): Promise<boolean> {
  if (!runner.running) return false
  const reply = await managementRequest(agentManagementPath(record.id), record.config.adminToken,
    '/a2a/admin/prepare-stop', {}, 60_000)
  if (!reply.ok || !(reply.json as {readyToStop?: boolean}).readyToStop) {
    throw new Error('Agent 未确认沙箱已安全停止，已保留进程；请更新插件并检查日志后重试')
  }
  return runner.stop()
}
