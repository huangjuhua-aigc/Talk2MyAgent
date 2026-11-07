import type { PeerEntry, WizardConfig } from './types.ts'
import { derivedPublicUrl } from './url.ts'
import { isContactId } from './contact-id.ts'
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`
export function publicVisitorInstruction(config: WizardConfig, publication?: { publicRpcUrl: string; contactId: string }): string {
  const url = publication?.publicRpcUrl ?? derivedPublicUrl(config.network)
  if (!url) throw new Error('请先配置访客可访问的地址')
  const id = publication?.contactId ?? `local-${config.card.name}`
  return [
    `请帮我接入 A2A Agent「${config.card.name}」并邀请它聊天：`, `服务地址：${url}`,
    '安装或更新调用技能：git clone --depth 1 https://github.com/huangjuhua-aigc/Talk2MyAgent 到临时目录，将 packages/a2a-skill 复制到 ~/.agents/skills/a2a。',
    '以下命令使用 POSIX 引号；Windows 请使用相同参数通过 Node 子进程或适配 PowerShell 执行。',
    `node ~/.agents/skills/a2a/bin/a2a.mjs add ${quote(id)} ${quote(url)}`,
    `node ~/.agents/skills/a2a/bin/a2a.mjs send ${quote(id)} '你好'`,
    '直接发送消息即可；仅在服务端明确要求匿名登录、确认消息未执行时，技能会自动登记并保存专属 Token，再继续发送。身份编号由服务端签发。',
    '不要把凭据写入通讯录、聊天或模型记忆。匿名身份累计可发送 5 次消息；额度用完请联系 Agent 主人开通权限，不要重新登记或清除凭据绕过额度。',
    '已有身份会复用；无效 Token、超时或断线不能触发自动登记或重发。已有任务 ID 时用 task 查询。',
  ].join('\n')
}
export function visitorInstruction(config: WizardConfig, peer: PeerEntry, fallbackHost?: string,
  publication?: { publicRpcUrl: string; publicCardUrl: string; contactId?: string }): string {
  if (config.network.mode === 'relay' && !publication) return '保存 Agent 后，在控制台「公网中继」获取固定地址，再到「邀请访客聊天」复制邀请。可以先获取地址，稍后启动 Agent。'
  const relay = config.network.mode === 'relay'
  if (relay && !isContactId(publication?.contactId)) return 'Relay 尚未分配有效编号，请升级中继服务并同步编号后再复制邀请。'
  const contactId = relay ? publication!.contactId! : `local-${config.card.name}`
  const url = publication?.publicRpcUrl ?? derivedPublicUrl(config.network, fallbackHost) ?? `http://127.0.0.1:${config.network.port}/a2a`
  // Unregistered LAN agents use a local alias, never a made-up Relay number.
  const env = relay ? `A2A_PEER_${contactId}` : `A2A_LAN_${Array.from(new TextEncoder().encode(url), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  return [
    '请帮我接入下面的 A2A 在线 agent，并邀请它聊天：',
    relay ? `- 通讯录 ID：${contactId}（Relay 已登记的公开编号，不代表手机号归属已验证）` : `- 通讯录本地别名：${contactId}（尚未注册 Relay 编号）`,
    `- 名字：${config.card.name}`, `- 服务地址：${url}`,
    ...(publication ? [`- Agent Card：${publication.publicCardUrl}`] : []), `- Bearer 令牌：${peer.token}`, '',
    '1. 安装或更新调用技能：git clone --depth 1 https://github.com/huangjuhua-aigc/Talk2MyAgent 到临时目录，',
    '   将 packages/a2a-skill 复制到 ~/.agents/skills/a2a。',
    `2. 先执行 node ~/.agents/skills/a2a/bin/a2a.mjs list 检查通讯录。若 ID ${contactId} 已存在但服务地址不同，停止接入并告知我；不要覆盖联系人或令牌。`,
    `3. 将上面的访客令牌保存到环境变量 ${env}（凭据管理器或本地 shell 配置，不放入通讯录和模型记忆）。`,
    '4. 写入通讯录，以下命令采用 POSIX 引号；Windows 请以相同参数用 Node 子进程或适配 PowerShell 引号执行：',
    `   node ~/.agents/skills/a2a/bin/a2a.mjs add ${quote(contactId)} ${quote(url)} ${quote(env)} ${quote(config.card.name)}${publication ? ` --card-url ${quote(publication.publicCardUrl)}` : ''}`,
    `5. 执行 node ~/.agents/skills/a2a/bin/a2a.mjs card ${quote(contactId)} 验证名片。`,
    `6. 执行 node ~/.agents/skills/a2a/bin/a2a.mjs send ${quote(contactId)} '你好' 邀请聊天，并告诉我结果。`,
    '如果请求中途断开，不要自动重发；已有任务 ID 时用 task 查询。',
  ].join('\n')
}
