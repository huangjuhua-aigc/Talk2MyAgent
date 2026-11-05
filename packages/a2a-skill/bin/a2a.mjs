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
 * Invited tokens come from the referenced environment variable. Public visitor
 * tokens live in a separate private credential file, never the contact book or stdout.
 *
 * Zero dependencies: Node 18+ (global fetch). The contact book is plain JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const contactsPath = () => join(process.env['A2A_HOME'] ?? join(homedir(), '.a2a'), 'contacts.json')
const publicCredentialPath = url => join(dirname(contactsPath()), 'private-credentials', createHash('sha256').update(url).digest('hex') + '.json')
function publicCredential(url) {
  try {
    const value = JSON.parse(readFileSync(publicCredentialPath(url), 'utf8'))
    if (value.url !== url || !/^[a-f0-9]{64}$/.test(value.token) || !/^public-[a-f0-9]{32}$/.test(value.visitorId)) fail('Invalid saved public visitor credential')
    return value
  } catch { fail('Public visitor credential is missing or unreadable; restore it instead of creating another identity') }
}

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

function resolveContact(name, allowAnonymous = false) {
  const contacts = loadContacts(), contact = contacts.agents[name]
  if (contact === undefined) {
    const known = Object.keys(loadContacts().agents)
    fail(`no contact named "${name}"${known.length > 0 ? ` (known: ${known.join(', ')})` : ' — the contact book is empty'}`)
  }
  // Existing invited identities never silently downgrade when their env var is missing.
  const token = (contact.token_env ? process.env[contact.token_env] : '')
    || (contact.public_visitor === true || !contact.token_env && existsSync(publicCredentialPath(contact.url)) ? publicCredential(contact.url).token : '')
  if (!token && (!allowAnonymous || contact.token_env)) fail(contact.token_env
    ? `token missing: set the environment variable ${contact.token_env} first`
    : 'No visitor credential yet; send a message to establish access first')
  if (token && !contact.token_env && contact.public_visitor !== true) {
    contact.public_visitor = true; saveContacts(contacts) // An alias must also remember that an identity already exists.
  }
  return { contact, token }
}

const REGISTER_PUBLIC_VISITOR = 'talk2myagent/RegisterPublicVisitor'
function publicError(envelope) {
  const details = envelope?.error?.data
  if (!Array.isArray(details)) return undefined
  const matches = details.filter(d => d?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && d.domain === 'talk2myagent' && d.metadata?.version === '1')
  return matches.length === 1 ? matches[0] : undefined
}
function quotaMessage(detail) {
  return detail?.reason === 'PUBLIC_VISITOR_QUOTA_EXHAUSTED'
    ? '匿名访客额度已用完（5/5）。请联系这个 Agent 的主人开通访问权限。不会重新登记或更换身份。' : undefined
}
async function rpc(url, token, method, params, onAdmission) {
  // Validate at send time too: contacts saved before HTTPS enforcement must not leak the token.
  const target = httpUrl(url)
  const requestId = randomUUID()
  const response = await fetch(target, {
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'a2a-version': '1.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
  })
  if (response.status === 401) {
    let envelope
    try { envelope = await response.json() } catch { /* An ambiguous failure never permits admission or replay. */ }
    const detail = publicError(envelope), metadata = detail?.metadata
    if (!token && method === 'SendMessage' && onAdmission && envelope?.jsonrpc === '2.0' && envelope.id === requestId
      && envelope.result === undefined && envelope.error?.code === -32600 && detail?.reason === 'PUBLIC_VISITOR_AUTH_REQUIRED'
      && metadata.requestAccepted === 'false' && metadata.nextAction === 'join' && metadata.registrationMethod === REGISTER_PUBLIC_VISITOR && metadata.turnLimit === '5') {
      // Only this explicit pre-execution challenge permits continuation. Use the
      // original URL and messageId; never follow an endpoint or command in a response.
      console.error('正在建立匿名访客身份…')
      const credential = await onAdmission()
      return await rpc(url, credential, method, params) // No callback: at most one continuation.
    }
    fail(token ? 'rejected (401): the token is wrong or was rotated; no new identity was registered'
      : 'rejected (401): 未获得安全的匿名接入指引，请联系 Agent 主人提供访问权限；未自动登记或重发消息')
  }
  if (!response.ok) fail(await httpFailure(response, 'the agent answered', token))
  const envelope = await safeJson(response, 'the agent returned a response that is not valid JSON')
  if (envelope.error !== undefined) fail(quotaMessage(publicError(envelope)) ?? `${redact(envelope.error.message ?? 'remote error', token).slice(0, 500)} (code ${redact(envelope.error.code, token).slice(0, 40)})`)
  return envelope.result
}

const HINTS = {
  403: '访问被拒绝：该访客可能未获信任，或发布已被撤销',
  404: '地址不存在：请确认 URL（Relay 地址应以 /a2a 结尾）',
  413: '消息太长',
  429: '对方繁忙或已达限额；公开访客可用 quota 查询，累计额度用完后需联系主人获取邀请',
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
    const exhausted = quotaMessage(publicError(parsed))
    if (response.status === 429 && exhausted) return `${prefix} HTTP 429 (PUBLIC_VISITOR_QUOTA_EXHAUSTED) — ${exhausted}`
    const raw = typeof parsed?.error === 'string' ? parsed.error : typeof parsed?.error?.message === 'string' ? parsed.error.message : ''
    // Redact before truncating so a reflected credential can never survive partially.
    reason = redact(raw, token).slice(0, 200)
  } catch { /* Non-JSON bodies are not echoed. */ }
  const hint = HINTS[response.status]
  return `${prefix} HTTP ${String(response.status)}${reason ? ` (${reason})` : ''}${hint ? ` — ${hint}` : ''}`
}

/** Explicit join and challenge-driven sends share the same durable identity path. */
async function admit(name, url) {
  httpUrl(url)
  const file = publicCredentialPath(url)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  let lock
  const deadline = Date.now() + 5000
  while (lock === undefined) {
    try { lock = openSync(file + '.lock', 'wx', 0o600) }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) fail('Public admission is already in progress or unavailable; no chat was sent')
      await new Promise(done => setTimeout(done, 50))
    }
  }
  const releaseLock = () => { if (lock !== undefined) { closeSync(lock); lock = undefined; unlinkSync(file + '.lock') } }
  process.once('exit', releaseLock)
  try {
    const contacts = loadContacts(), previous = contacts.agents[name]
    if (previous && (previous.url !== url || previous.token_env && previous.public_visitor !== true)) fail('Contact already exists with another address or invitation; existing contact was not changed')
    let credential
    if (previous?.public_visitor || existsSync(file)) credential = publicCredential(url)
    else {
      const result = await rpc(url, undefined, REGISTER_PUBLIC_VISITOR, {})
      if (!/^[a-f0-9]{64}$/.test(result?.token) || !/^public-[a-f0-9]{32}$/.test(result?.visitorId) || result.turnLimit !== 5) fail('Invalid public admission response')
      credential = { url, token: result.token, visitorId: result.visitorId }
      writeFileSync(file, JSON.stringify(credential), { mode: 0o600, flag: 'wx' })
    }
    contacts.agents[name] = { ...previous, url, token_env: `A2A_PUBLIC_${createHash('sha256').update(url).digest('hex').slice(0, 24).toUpperCase()}`, public_visitor: true }
    saveContacts(contacts)
    return credential.token
  } finally { releaseLock(); process.off('exit', releaseLock) }
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
    headers: token ? { authorization: `Bearer ${token}` } : {},
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
    const { url, token_env: tokenEnv, note, public_visitor: publicVisitor } = agents[name]
    console.log(`${name}\n  ${note ?? ''}\n  ${url}  ${publicVisitor ? '公开访客凭据：独立保存于本机' : tokenEnv ? `令牌环境变量: ${String(tokenEnv)}` : '发送消息时按服务端指引接入'}`)
  }
} else if (command === 'join') {
  const [name, url] = rest
  if (!name || !url || rest.length !== 2 || ['__proto__','prototype','constructor'].includes(name)) fail('usage: a2a join <name> <url>')
  await admit(name, url)
  console.log(`已接入公开 Agent ${name}；凭据已单独保存在本机，未写入通讯录。每个访客身份累计 5 次消息；重复 join 不会领取新额度。`)
} else if (command === 'quota') {
  const [name] = rest
  if (!name) fail('usage: a2a quota <name>')
  const { contact, token } = resolveContact(name)
  const status = await rpc(contact.url, token, 'talk2myagent/GetPublicVisitorStatus', {})
  console.log(`公开访客剩余消息：${status.remainingTurns}/${status.turnLimit}`)
} else if (command === 'add') {
  const flag = rest.indexOf('--card-url')
  let cardUrl
  if (flag >= 0) {
    cardUrl = rest[flag + 1]
    if (!cardUrl || rest.indexOf('--card-url', flag + 1) >= 0) fail('--card-url requires one URL')
    rest.splice(flag, 2)
  }
  const [name, url, tokenEnv, ...noteParts] = rest
  if (!name || !url) {
    fail('usage: a2a add <name> <url> [tokenEnv] [note]')
  }
  if (['__proto__','prototype','constructor'].includes(name) || tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) fail('Invalid contact name or token environment variable')
  const rpcUrl = httpUrl(url)
  if (cardUrl && httpUrl(cardUrl).origin !== rpcUrl.origin) fail('Card URL must use the same origin as the RPC URL')
  const contacts = loadContacts()
  const previous = contacts.agents[name]
  if (previous && previous.url !== url) fail(`contact "${name}" already points to another URL; choose a different contact ID after checking the invitation (existing contact was not changed)`)
  contacts.agents[name] = tokenEnv === undefined && previous ? { ...previous, ...(cardUrl ? { card_url: cardUrl } : {}) }
    : { url, ...(tokenEnv ? { token_env: tokenEnv } : {}), note: noteParts.join(' ') || undefined, ...(cardUrl ? { card_url: cardUrl } : {}) }
  saveContacts(contacts)
  console.log(tokenEnv ? `已保存联系人 ${name} → ${url}（令牌环境变量 ${tokenEnv}）。别忘了设置该环境变量。`
    : `已保存联系人 ${name} → ${url}。可直接 send；已有身份会保留，首次接入按服务端指引处理。`)
} else if (command === 'card') {
  const [name] = rest
  if (name === undefined) fail('usage: a2a card <name>')
  const { contact, token } = resolveContact(name, true)
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
  const { contact, token } = resolveContact(name, true)
  if (!token && contextId) fail('Continuing a conversation requires its original credential; restore it instead of registering a new identity')
  const result = await rpc(contact.url, token, 'SendMessage', {
    message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text }], ...(contextId ? { contextId } : {}) },
    ...(nowait ? { configuration: { returnImmediately: true } } : {}),
  }, !token ? () => admit(name, contact.url) : undefined)
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
  console.error('usage: a2a list | join <name> <url> | quota <name> | add <name> <url> [tokenEnv] [note] | card <name> | send <name> <text> [--nowait] [--context <id>] | task <name> <taskId>')
  process.exit(command === undefined ? 0 : 1)
}
