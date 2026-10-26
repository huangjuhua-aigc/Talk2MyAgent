/**
 * One briefing update executed by the online agent's automatic maintenance loop.
 *
 * The distilled task carries the scope fence (only this workspace's sessions
 * across known agent stores) and the disclosure discipline. In the open-source
 * console it updates the live briefing directly when the task finishes.
 *
 * @module a2a-host/briefing
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentBriefingPath } from './paths.ts'

export async function automaticBriefingEnabled(id: string): Promise<boolean> {
  try {
    const setting = JSON.parse(await readFile(agentBriefingPath(id), 'utf8')) as { enabled: unknown }
    if (typeof setting.enabled !== 'boolean') throw new Error('invalid automatic briefing setting')
    return setting.enabled
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

export async function setAutomaticBriefing(id: string, enabled: boolean): Promise<void> {
  const file = agentBriefingPath(id)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ enabled }), { mode: 0o600 })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

/** Where the known local agents keep their session data, per family. */
function storeHints(root: string): string {
  const escaped = root.replace(/[\\/:]/g, '-')
  return [
    `- Claude Code: ~/.claude/projects/${escaped}/*.jsonl（该项目目录下的会话记录）`,
    `- Codex: ~/.codex/sessions/ 下按日期存放的 rollout-*.jsonl，只采用文件内 cwd 字段指向 <root> 或其子目录的`,
    `- ZCode: ~/.zcode/cli/db/db.sqlite（若 sqlite3 命令可用则查询其中会话表，取最近会话；不可用则跳过这家）`,
    `- Kimi Code: ~/.kimi-code/ 下的会话/历史 JSON 文件（按文件内项目路径过滤出 <root>）`,
    `- WorkBuddy/CodeBuddy: ~/.codebuddy/sessions/ 与 ~/.codebuddy/history.jsonl（按项目路径过滤）`,
    `- 其他 agent：探索主目录下 ~/.<名字>* 形态目录中的 *.jsonl 会话文件，同样只取 <root> 相关`,
  ].join('\n')
}

/** The recurring instruction the scheduled task will run on every wake-up. */
export function briefingTaskPrompt(root: string): string {
  return [
    '【简报维护任务】受信任的项目范围只有一个：',
    `  ${root}`,
    '与该目录无关的任何项目、任何内容，一律不读、不写进简报。',
    '这是一次自动更新，不要创建或修改定时任务，也不要等待人工确认。',
    '',
    '步骤：',
    '1. 只收集与上述目录相关的本地各 agent 会话（只看最近 48 小时内有修改的文件，读最近几段会话即可，不必全量）：',
    storeHints(root),
    '2. 把收集到的内容蒸馏成一份 Markdown 简报，恰好四节：',
    '   ## 最近在做什么',
    '   ## 改了哪些文件',
    '   ## 关键决定',
    '   ## 未完事项',
    '   总长不超过 40 行；每条尽量一句话。',
    '3. 披露纪律（硬性）：只写与该项目相关的工作内容；密钥、token、凭据、',
    '   私人通信、他人隐私、与项目无关的个人信息一律不得写入；',
    '   不确定能否对外披露的内容，一律不写。',
    '4. 完整生成并检查上述内容后，直接覆盖写入当前工作目录的 handoff.md。',
    '   这是正式公开简报，无需人工确认或采纳；不要写 handoff.draft.md。',
    '   没有新的有效资料或生成失败时，保留原有 handoff.md，不要清空或写入半成品。',
    '5. 写入完成后结束本次任务；Portal 会自动展示 handoff.md 的最新内容。',
  ].join('\n')
}
