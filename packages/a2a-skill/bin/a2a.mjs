#!/usr/bin/env node
/**
 * a2a — call other agents over A2A, from your contact book.
 *
 *   a2a list                     every configured agent (name, note, url)
 *   a2a add <name> <url> <tokenEnv> [note]   save one into ~/.a2a/contacts.json
 *   a2a card <name>              the remote agent's card (what it can do)
 *   a2a send <name> <text>       send a message, wait for the reply
 *   a2a send <name> <text> --nowait   send and print the task id instead
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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'a2a-version': '1.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  })
  if (response.status === 401) fail('rejected (401): the token is wrong or was rotated')
  if (!response.ok) fail(`the agent answered HTTP ${String(response.status)}`)
  const envelope = await response.json()
  if (envelope.error !== undefined) fail(`${envelope.error.message ?? 'remote error'} (code ${String(envelope.error.code)})`)
  return envelope.result
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

function renderTask(task) {
  const terminal = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']
  const done = terminal.includes(task.status.state)
  console.log(`[任务 ${task.id}] 状态: ${task.status.state}${done ? '' : '（未完成——稍后用 a2a task 查询）'}`)
  if (done && task.status.state !== 'TASK_STATE_COMPLETED') {
    console.log('（任务没有成功结束；可以把任务 id 和状态转告主人）')
  }
  const text = taskText(task)
  if (text.length > 0) console.log(text)
}

async function fetchCard(url, token) {
  // The card lives at the origin's well-known path, public by default.
  const origin = new URL(url).origin
  const response = await fetch(`${origin}/.well-known/agent-card.json`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) fail(`could not fetch the agent card (HTTP ${String(response.status)})`)
  return await response.json()
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
  const [name, url, tokenEnv, ...noteParts] = rest
  if (name === undefined || url === undefined || tokenEnv === undefined) {
    fail('usage: a2a add <name> <url> <tokenEnv> [note]')
  }
  const contacts = loadContacts()
  contacts.agents[name] = { url, token_env: tokenEnv, note: noteParts.join(' ') || undefined }
  saveContacts(contacts)
  console.log(`已保存联系人 ${name} → ${url}（令牌环境变量 ${tokenEnv}）。别忘了设置该环境变量。`)
} else if (command === 'card') {
  const [name] = rest
  if (name === undefined) fail('usage: a2a card <name>')
  const { contact, token } = resolveContact(name)
  const card = await fetchCard(contact.url, token)
  const skills = (card.skills ?? []).map(skill => `${skill.name}: ${skill.description ?? ''}`).join('; ')
  console.log(`${card.name ?? name}\n${card.description ?? ''}${skills.length > 0 ? `\n能力: ${skills}` : ''}`)
} else if (command === 'send') {
  const args = rest.filter(arg => arg !== '--nowait')
  const nowait = rest.includes('--nowait')
  const [name, ...textParts] = args
  const text = textParts.join(' ')
  if (name === undefined || text.length === 0) fail('usage: a2a send <name> <text> [--nowait]')
  const { contact, token } = resolveContact(name)
  const result = await rpc(contact.url, token, 'SendMessage', {
    message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text }] },
    ...(nowait ? { configuration: { returnImmediately: true } } : {}),
  })
  renderTask(result.task)
} else if (command === 'task') {
  const [name, taskId] = rest
  if (name === undefined || taskId === undefined) fail('usage: a2a task <name> <taskId>')
  const { contact, token } = resolveContact(name)
  const result = await rpc(contact.url, token, 'GetTask', { id: taskId })
  renderTask(result.task)
} else {
  console.error('a2a — call other agents over A2A, from your contact book.')
  console.error('usage: a2a list | add <name> <url> <tokenEnv> [note] | card <name> | send <name> <text> [--nowait] | task <name> <taskId>')
  process.exit(command === undefined ? 0 : 1)
}
