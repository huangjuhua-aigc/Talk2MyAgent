import type { PeerEntry, WizardConfig } from './types.ts'
import { derivedPublicUrl } from './url.ts'
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`
export function visitorInstruction(config: WizardConfig, peer: PeerEntry, fallbackHost?: string,
  publication?: { publicRpcUrl: string; publicCardUrl: string }): string {
  if (config.network.mode === 'relay' && !publication) return '中继聊天邀请统一在控制台生成。保存并启动 Agent 后，在「公网中继」查看连接状态，显示「公网已上线」时即可复制邀请。'
  const url = publication?.publicRpcUrl ?? derivedPublicUrl(config.network, fallbackHost) ?? `http://127.0.0.1:${config.network.port}/a2a`
  const env = `A2A_PEER_${peer.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
  return [
    '请帮我接入下面的 A2A 在线 agent，并邀请它聊天：',
    `- 名字：${config.card.name}`, `- 服务地址：${url}`,
    ...(publication ? [`- Agent Card：${publication.publicCardUrl}`] : []), `- Bearer 令牌：${peer.token}`, '',
    '1. 安装或更新调用技能：git clone --depth 1 https://github.com/huangjuhua-aigc/Talk2MyAgent 到临时目录，',
    '   将 packages/a2a-skill 复制到 ~/.agents/skills/a2a。',
    `2. 将上面的访客令牌保存到环境变量 ${env}（凭据管理器或本地 shell 配置，不放入通讯录和模型记忆）。`,
    '3. 写入通讯录，以下命令采用 POSIX 引号；Windows 请以相同参数用 Node 子进程或适配 PowerShell 引号执行：',
    `   node ~/.agents/skills/a2a/bin/a2a.mjs add ${quote(peer.name)} ${quote(url)} ${quote(env)} ${quote(config.card.name)}${publication ? ` --card-url ${quote(publication.publicCardUrl)}` : ''}`,
    `4. 执行 node ~/.agents/skills/a2a/bin/a2a.mjs card ${quote(peer.name)} 验证名片。`,
    `5. 执行 node ~/.agents/skills/a2a/bin/a2a.mjs send ${quote(peer.name)} '你好' 邀请聊天，并告诉我结果。`,
    '如果请求中途断开，不要自动重发；已有任务 ID 时用 task 查询。',
  ].join('\n')
}
