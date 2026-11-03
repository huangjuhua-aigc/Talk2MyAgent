#!/usr/bin/env node
/**
 * a2a — call other agents over A2A, from your contact book.
 *
 *   a2a list                     every configured agent (name, note, url)
 *   a2a add <name> <url> <tokenEnv> [note]   save one into ~/.a2a/contacts.json
 *   a2a card <name>              the remote agent's card (what it can do)
 *   a2a send <name> <text>       send a message, wait for the reply
 *   a2a send <name> <text> --nowait   send and print the task id instead
 *   a2a send <name> <text> --context <id>   continue an earlier conversation
 *   a2a task <name> <taskId>     poll a task's state / fetch its reply
 *
 * Tokens come from the environment variable each contact names — they never
 * live in the contact book, a chat, or a file a model might read.
 *
 * Zero dependencies: Node 18+ (global fetch). The contact book is plain JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const contactsPath = () => join(process.env['A2A_HOME'] ?? join(homedir(), '.a2a'), 'contacts.json')

function loadContacts() {
  try {
    const parsed = JSON.parse(readFileSync(contactsPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.agents && typeof parsed.agents === 'object'
      ? parsed
      : { agents: {} }
  } catch {
    return { agents: {} }
  }
}

function saveContacts(contacts) {
  const path = contactsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(contacts, null, 2) + '\n', 'utf8')
}

function fail(message) {
  console.error(`a2a: ${message}`)
  process.exit(1)
}

function resolveContact(name) {
  const contact = loadContacts().agents[name]
  if (contact === undefined) {
    const known = Object.keys(loadContacts().agents)
    fail(`no contact named "${name}"${known.length > 0 ? ` (known: ${known.join(', ')})` : ' — the contact book is empty'}`)
  }
  const token = process.env[contact.token_env] ?? ''
  if (token.length === 0) fail(`token missing: set the environment variable ${contact.token_env} first`)
  return { contact, token }
}

async function rpc(url, token, method, params) {
  // Validate at send time too: contacts saved before HTTPS enforcement must not leak the token.
  const target = httpUrl(url)
  const response = await fetch(target, {
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'a2a-version': '1.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  })
  if (response.status === 401) fail('rejected (401): the token is wrong or was rotated')
  if (!response.ok) fail(await httpFailure(response, 'the agent answered', token))
  const envelope = await safeJson(response, 'the agent returned a response that is not valid JSON')
  if (envelope.error !== undefined) fail(`${redact(envelope.error.message ?? 'remote error', token).slice(0, 500)} (code ${redact(envelope.error.code, token).slice(0, 40)})`)
  return envelope.result
}

const HINTS = {
  403: '访问被拒绝：该访客可能未获信任，或发布已被撤销',
  404: '地址不存在：请确认 URL（Relay 地址应以 /a2a 结尾）',
  413: '消息太长',
  429: '对方繁忙或已达限额，请稍后再试',
  502: 'Relay 与对方 agent 的连接中断，消息可能未送达',
  503: '对方 agent 当前不在线（电脑或本地 agent 未运行，或已关闭公网发布）',
  504: '对方 agent 响应超时，消息可能未送达',
}
/** Parse JSON without letting a parser excerpt (which may echo a reflected token) reach stderr. */
async function safeJson(response, message) {
  try { return JSON.parse(await response.text()) } catch { fail(message) }
}
/** Strip control characters and any credential a server reflected back before printing. */
function redact(text, token) {
  let safe = String(text).replace(/[\u0000-\u001f]/g, ' ')
  if (token) safe = safe.split(token).join('[REDACTED]')
  return safe.replace(/\b(Bearer|Basic)\s+[^\s"',;)]+/gi, '$1 [REDACTED]')
}
/** Turn an HTTP failure into a readable line, quoting a short server reason when present. */
async function httpFailure(response, prefix, token) {
  let reason = ''
  try {
    const body = await response.text()
    const parsed = JSON.parse(body)
    const raw = typeof parsed?.error === 'string' ? parsed.error : typeof parsed?.error?.message === 'string' ? parsed.error.message : ''
    // Redact before truncating so a reflected credential can never survive partially.
    reason = redact(raw, token).slice(0, 200)
  } catch { /* Non-JSON bodies are not echoed. */ }
  const hint = HINTS[response.status]
  return `${prefix} HTTP ${String(response.status)}${reason ? ` (${reason})` : ''}${hint ? ` — ${hint}` : ''}`
}

const taskText = task => {
  const parts = []
  for (const artifact of task.artifacts ?? []) {
    for (const part of artifact.parts ?? []) {
      if (typeof part.text === 'string') parts.push(part.text)
    }
  }
  return parts.join('\n')
}

const partsText = parts => (parts ?? []).filter(p => typeof p?.text === 'string').map(p => p.text).join('\n')

/** Render a SendMessage result: either `{ task }` or a direct `{ message }` reply. */
function renderResult(result) {
  if (result?.task) { renderTask(result.task); return }
  const message = result?.message ?? (result?.kind === 'message' || result?.messageId ? result : undefined)
  if (message) {
    if (message.contextId) console.log(`[对话 ${message.contextId}]（继续这段对话：加上 --context ${message.contextId}）`)
    const text = partsText(message.parts)
    if (text.length > 0) console.log(text)
    return
  }
  if (result?.id && result?.status) { renderTask(result); return }
  fail('the agent returned neither a task nor a message')
}

function renderTask(task) {
  if (!task?.status) fail('the agent returned a malformed task')
  const terminal = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']
  const done = terminal.includes(task.status.state)
  console.log(`[任务 ${task.id}] 状态: ${task.status.state}${done ? '' : '（未完成——稍后用 a2a task 查询）'}`)
  if (task.contextId) console.log(`[对话 ${task.contextId}]（继续这段对话：加上 --context ${task.contextId}）`)
  if (done && task.status.state !== 'TASK_STATE_COMPLETED') {
    console.log('（任务没有成功结束；可以把任务 id 和状态转告主人）')
  }
  let text = taskText(task)
  if (text.length === 0 && done) text = partsText(task.status.message?.parts)
  if (text.length > 0) console.log(text)
}

function isLoopback(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host)
}

function httpUrl(value) {
  const u = new URL(value)
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) fail('URL must be HTTP(S) without credentials, query or fragment')
  // Bearer tokens must not cross the internet in cleartext: plain http is loopback-only.
  if (u.protocol === 'http:' && !isLoopback(u.hostname)) fail('remote agents must use https:// (plain http is only allowed for localhost / 127.0.0.1 / ::1)')
  return u
}
async function fetchCard(url, token, explicitCardUrl) {
  const rpcUrl = httpUrl(url)
  const inferred = new URL(rpcUrl.pathname.endsWith('/a2a') ? rpcUrl.pathname.slice(0, -4) + '/.well-known/agent-card.json' : '/.well-known/agent-card.json', rpcUrl.origin)
  const cardUrl = explicitCardUrl ? httpUrl(explicitCardUrl) : inferred
  if (cardUrl.origin !== rpcUrl.origin) fail('Card URL must use the same origin as the RPC URL')
  const response = await fetch(cardUrl, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) fail(await httpFailure(response, 'could not fetch the agent card:', token))
  return await safeJson(response, 'the agent card is not valid JSON')
}

const [command, ...rest] = process.argv.slice(2)

if (command === 'list') {
  const agents = loadContacts().agents
  const names = Object.keys(agents)
  if (names.length === 0) {
    console.log('通讯录是空的。用 a2a add <name> <url> <tokenEnv> [note] 添加，或让主人发来接入指令。')
    process.exit(0)
  }
  for (const name of names) {
    const { url, token_env: tokenEnv, note } = agents[name]
    console.log(`${name}\n  ${note ?? ''}\n  ${url}  令牌环境变量: ${String(tokenEnv)}`)
  }
} else if (command === 'add') {
  const flag = rest.indexOf('--card-url')
  let cardUrl
  if (flag >= 0) {
    cardUrl = rest[flag + 1]
    if (!cardUrl || rest.indexOf('--card-url', flag + 1) >= 0) fail('--card-url requires one URL')
    rest.splice(flag, 2)
  }
  const [name, url, tokenEnv, ...noteParts] = rest
  if (name === undefined || url === undefined || tokenEnv === undefined) {
    fail('usage: a2a add <name> <url> <tokenEnv> [note]')
  }
  if (['__proto__','prototype','constructor'].includes(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) fail('Invalid contact name or token environment variable')
  const rpcUrl = httpUrl(url)
  if (cardUrl && httpUrl(cardUrl).origin !== rpcUrl.origin) fail('Card URL must use the same origin as the RPC URL')
  const contacts = loadContacts()
  contacts.agents[name] = { url, token_env: tokenEnv, note: noteParts.join(' ') || undefined, ...(cardUrl ? { card_url: cardUrl } : {}) }
  saveContacts(contacts)
  console.log(`已保存联系人 ${name} → ${url}（令牌环境变量 ${tokenEnv}）。别忘了设置该环境变量。`)
} else if (command === 'card') {
  const [name] = rest
  if (name === undefined) fail('usage: a2a card <name>')
  const { contact, token } = resolveContact(name)
  const card = await fetchCard(contact.url, token, contact.card_url)
  const skills = (card.skills ?? []).map(skill => `${skill.name}: ${skill.description ?? ''}`).join('; ')
  console.log(`${card.name ?? name}\n${card.description ?? ''}${skills.length > 0 ? `\n能力: ${skills}` : ''}`)
} else if (command === 'send') {
  const args = [], nowait = rest.includes('--nowait')
  let contextId
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--nowait') continue
    if (arg === '--context') {
      contextId = rest[++i]
      if (!contextId || contextId.startsWith('-') || contextId.length > 256) fail('--context requires a conversation id')
      continue
    }
    if (arg.startsWith('--context=')) { contextId = arg.slice(10); if (!contextId) fail('--context requires a conversation id'); continue }
    args.push(arg)
  }
  const [name, ...textParts] = args
  const text = textParts.join(' ')
  if (name === undefined || text.length === 0) fail('usage: a2a send <name> <text> [--nowait] [--context <id>]')
  const { contact, token } = resolveContact(name)
  const result = await rpc(contact.url, token, 'SendMessage', {
    message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text }], ...(contextId ? { contextId } : {}) },
    ...(nowait ? { configuration: { returnImmediately: true } } : {}),
  })
  renderResult(result)
} else if (command === 'task') {
  const [name, taskId] = rest
  if (name === undefined || taskId === undefined) fail('usage: a2a task <name> <taskId>')
  const { contact, token } = resolveContact(name)
  const result = await rpc(contact.url, token, 'GetTask', { id: taskId })
  // GetTask returns a Task directly; accept older servers that wrap it too.
  renderTask(result.task ?? result)
} else {
  console.error('a2a — call other agents over A2A, from your contact book.')
  console.error('usage: a2a list | add <name> <url> <tokenEnv> [note] | card <name> | send <name> <text> [--nowait] [--context <id>] | task <name> <taskId>')
  process.exit(command === undefined ? 0 : 1)
}
