/**
 * The briefing-maintenance bootstrap: the message the console sends to its
 * own agent (as the owner identity) to set up the recurring handoff task.
 *
 * The distilled task carries the scope fence (only this workspace's sessions
 * across known agent stores), the disclosure discipline, and the draft-only
 * landing spot — the owner adopts a draft in the console before it ever
 * reaches a visitor.
 *
 * @module a2a-host/briefing
 */

import type { AgentRecord } from './files.ts'

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
    '4. 把简报写入当前工作目录的 handoff.draft.md（覆盖旧草稿）。',
    '   禁止写 handoff.md —— 那是主人审核采纳后才生效的正式简报。',
  ].join('\n')
}

/** The one-shot bootstrap the console sends as the owner identity. */
export function briefingBootstrapPrompt(root: string): string {
  return [
    '你是这台机器主人的管家，你的工作目录就是简报目录。',
    '请现在调用 schedule_create 工具，创建一个定时任务，参数：',
    '- title: 简报维护',
    '- cron: { "expression": "0 * * * *", "time_zone": "Asia/Shanghai" }（每小时整点）',
    '- prompt: 以下任务全文（原样使用，不要改写）：',
    '---8<---',
    briefingTaskPrompt(root),
    '--->8---',
    '创建成功后，立即按该 prompt 执行一次（产出第一份草稿），然后回复「已建立，草稿已生成」。',
  ].join('\n')
}
