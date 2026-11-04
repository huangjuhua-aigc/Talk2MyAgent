import { test as base, expect } from './fixtures.ts'
import { startPortal } from '../support/portal.ts'
import { startTestRelay } from '../support/relay.ts'
import { command, status } from '@talk2myagent/a2a-connector'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
const exec = promisify(execFile)
const test = base.extend({
  portal: async ({}, use) => {
    const relay = await startTestRelay(), portal = await startPortal(1, { relayOrigin: relay.origin, publicA2A: true })
    try { await use(portal) } finally {
      for (const agent of portal.agents) {
        const dir = join(portal.host, 'relay', agent.record.id)
        await command(dir, 'shutdown').catch(() => {})
        await expect.poll(async () => (await status(dir)).instanceId).toBeUndefined()
      }
      await portal.close(); await relay.close()
    }
  },
})
// Run with A2A_RELAY_SOURCE; regular UI runs retain a visible skipped integration test.
test.skip(!process.env['A2A_RELAY_SOURCE'], 'Independent Relay checkout required')
test.beforeEach(async ({ page }) => {
  await page.getByRole('region', { name:'公网中继' }).getByLabel('手机号（公开编号）').fill('13812345678')
})
test('an old stopped Relay address does not lock the number field for the selected new Relay', async ({ page, portal }) => {
  const id=portal.agents[0]!.record.id, record=await portal.readRecord(id)
  record.config.network={...record.config.network,mode:'relay',relay:{provider:'default',enabled:true}}
  await writeFile(join(portal.host,'agents',`${id}.json`),JSON.stringify(record))
  await page.route(`**/api/agents/${id}/publication/status`,route=>route.fulfill({json:{state:'stopped',desiredEnabled:false,cloudSyncPending:false,
    relayOrigin:'http://127.0.0.1:1',publicRpcUrl:'http://127.0.0.1:1/r/old-publication/a2a',contactId:'13800000000'}}))
  await page.reload()
  const card=page.getByRole('region',{name:'公网中继'}), number=card.getByLabel('手机号（公开编号）')
  await expect(number).toBeEditable()
  await number.fill('18612345678')
  await expect(card.getByRole('button',{name:'获取中继地址'})).toBeEnabled()
  await expect(card.getByTestId('relay-url')).toHaveCount(0)
})

test('mobile number validation, duplicate rejection and correction preserve the existing owner', async ({ page, portal }) => {
  const card = page.getByRole('region', { name:'公网中继' })
  const number = card.getByLabel('手机号（公开编号）'), button = card.getByRole('button', { name:'获取中继地址' })
  for (const value of ['', '123', '12812345678', '1861234567x']) { await number.fill(value); await expect(button).toBeDisabled() }
  const session = await (await fetch(`${portal.baseURL}/api/session`)).json() as { defaultRelayHost:string }
  const occupied = await fetch(`${session.defaultRelayHost}/v1/agents/register`, { method:'POST', body:JSON.stringify({
    registrationId:randomUUID(), deviceTokenHash:createHash('sha256').update(randomUUID()).digest('hex'), displayName:'Another owner', protocolVersion:'1.0', contactId:'18612345678',
  }) })
  expect(occupied.status).toBe(200)
  await number.fill('18612345678'); await button.click()
  await expect(card.getByRole('alert')).toContainText('已被占用')
  await expect(card.getByTestId('relay-url')).toHaveCount(0)
  await expect(number).toBeEditable()
  await number.fill('18512345678'); await button.click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout:15000 })
  await expect(card.getByTestId('relay-url')).toHaveText(`${session.defaultRelayHost}/r/18512345678/a2a`)
  await card.getByRole('button', { name:'关闭公网发布' }).click()
  await expect(number).toHaveValue('18512345678'); await expect(number).not.toBeEditable()
  await page.reload()
  await expect(number).toHaveValue('18512345678')
})

test('automatic publication, visitor invitation, real skill chat, closing and stable republish', async ({ page, portal }, testInfo) => {
  const card = page.getByRole('region', { name: '公网中继' })
  const visitors = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '获取中继地址' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  const url = await card.getByTestId('relay-url').innerText()
  expect(url).toMatch(/\/r\/13812345678\/a2a$/)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText(url)
  const invitation = await visitors.getByTestId('relay-invitation').innerText()
  expect(invitation).toContain('--card-url'); expect(invitation).not.toContain(portal.agents[0]!.record.config.adminToken)
  const contactId = await visitors.getByTestId('agent-contact-id').innerText()
  expect(contactId).toMatch(/^13[89]\d{8}$/)
  for (const cmd of ['add', 'card', 'send']) expect(invitation).toContain(`${cmd} '${contactId}'`)
  expect(invitation).toContain(`A2A_PEER_${contactId}`)
  expect(invitation).not.toContain("add 'alice'")
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replace(/\r\n/g, '\n')).toBe(invitation)
  const script = fileURLToPath(new URL('../../../a2a-skill/bin/a2a.mjs', import.meta.url))
  const env = { ...process.env, A2A_HOME: join(portal.root, 'visitor'), A2A_TEST_TOKEN: portal.agents[0]!.record.config.peers[0]!.token }
  const cardUrl = url.replace(/\/a2a$/, '/.well-known/agent-card.json')
  await exec(process.execPath, [script, 'add', contactId, url, 'A2A_TEST_TOKEN', 'Alpha Agent', '--card-url', cardUrl], { env })
  expect((await exec(process.execPath, [script, 'card', contactId], { env })).stdout).toContain('Alpha Agent')
  expect((await exec(process.execPath, [script, 'send', contactId, '你好'], { env })).stdout).toContain('公网联调成功')
  await page.screenshot({ path: testInfo.outputPath('relay-online.png'), fullPage: true })
  await page.reload()
  await expect(visitors.getByTestId('agent-contact-id')).toHaveText(contactId)
  await expect(card.getByRole('status')).toHaveText('公网已上线')
  await card.getByRole('button', { name: '关闭公网发布' }).click()
  await expect(card.getByRole('button', { name: '开启公网发布', exact: true })).toBeEnabled()
  await expect(card.getByRole('status')).toHaveCount(0)
  await expect(visitors.getByRole('button', { name: /复制聊天邀请|邀请已复制/ })).toBeEnabled()
  await expect(card.getByTestId('relay-url')).toHaveText(url)
  expect((await fetch(cardUrl)).status).toBe(503)
  await card.getByRole('button', { name: '开启公网发布' }).click()
  await expect(card.getByTestId('relay-url')).toHaveText(url, { timeout: 15000 })
})

test('custom host validation and clipboard fallback leave a usable complete invitation', async ({ page, portal }) => {
  const card = page.getByRole('region', { name: '公网中继' })
  const visitors = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByLabel('Relay 服务').selectOption('custom')
  await expect(card.getByRole('button', { name: '获取中继地址' })).toBeDisabled()
  await card.getByLabel('Relay host', { exact: true }).fill('https://relay.test/not-an-origin')
  await expect(card.getByRole('button', { name: '获取中继地址' })).toBeDisabled()
  await expect(card.getByRole('alert')).toContainText('不需要路径')
  const session = await (await fetch(`${portal.baseURL}/api/session`)).json() as { defaultRelayHost: string }
  await card.getByLabel('Relay host', { exact: true }).fill(session.defaultRelayHost)
  await card.getByRole('button', { name: '获取中继地址' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('denied') } }) })
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByRole('alert')).toContainText('手动复制')
  await expect(visitors.getByTestId('relay-invitation')).toContainText('--card-url')
  // Saved credentials can change before a running service has applied them.
  const record = await portal.readRecord(portal.agents[0]!.record.id)
  record.config.peers[0]!.token = 'not-yet-applied-token'
  await writeFile(join(portal.host, 'agents', `${record.id}.json`), JSON.stringify(record))
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText('尚未应用')
})

test('reset clears the old invitation and obtains a new Relay address and contact number', async ({ page, portal }) => {
  const card = page.getByRole('region', { name: '公网中继' })
  const visitors = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '获取中继地址' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  const previousUrl = await card.getByTestId('relay-url').innerText()
  await expect(visitors.getByTestId('agent-contact-id')).toHaveText(/^13[89]\d{8}$/)
  const previousId = await visitors.getByTestId('agent-contact-id').innerText()
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText(previousUrl)
  await card.getByRole('button', { name: '关闭公网发布' }).click()
  await expect(card.getByRole('button', { name: '开启公网发布', exact: true })).toBeEnabled()
  await expect(card.getByRole('status')).toHaveCount(0)
  page.once('dialog', dialog => { void dialog.dismiss() })
  await card.getByRole('button', { name: '重置 Relay 身份' }).click()
  await expect(card.getByTestId('relay-url')).toHaveText(previousUrl)
  page.once('dialog', dialog => { void dialog.accept() })
  await card.getByRole('button', { name: '重置 Relay 身份' }).click()
  await expect(card.getByRole('status')).toHaveText('尚未获取地址')
  await expect(card.getByTestId('relay-url')).toHaveCount(0)
  await expect(visitors.getByTestId('agent-contact-id')).toHaveCount(0)
  await expect(visitors.getByTestId('relay-invitation')).toHaveCount(0)
  await expect(visitors.getByRole('button', { name: '复制聊天邀请' })).toBeDisabled()
  await expect(card.getByRole('button', { name: '获取中继地址' })).toBeDisabled()
  await card.getByLabel('手机号（公开编号）').fill('13912345678')
  await card.getByRole('button', { name: '获取中继地址' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  await expect(card.getByTestId('relay-url')).not.toHaveText(previousUrl)
  await expect(visitors.getByTestId('agent-contact-id')).toHaveText(/^13[89]\d{8}$/)
  await expect(visitors.getByTestId('agent-contact-id')).not.toHaveText(previousId)
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText(await card.getByTestId('relay-url').innerText())
  await expect(visitors.getByTestId('relay-invitation')).not.toContainText(previousUrl)
  expect((await fetch(previousUrl.replace(/\/a2a$/, '/.well-known/agent-card.json'))).status).toBe(503)
  expect((await portal.readRecord(portal.agents[0]!.record.id)).config.peers).toHaveLength(1)
})

test('an unreachable Agent retains its address and can prepare an explicitly offline invitation', async ({ page, portal }) => {
  const applied = join(portal.host, 'relay', portal.agents[0]!.record.id, 'applied.json')
  const runtime = JSON.parse(await readFile(applied, 'utf8')) as { port: number }
  runtime.port = 1
  await writeFile(applied, JSON.stringify(runtime))
  const card = page.getByRole('region', { name: '公网中继' })
  const visitors = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '获取中继地址' }).click()
  await expect(card.getByRole('status')).toContainText('等待本地 agent', { timeout: 15000 })
  await expect(visitors.getByRole('button', { name: '复制聊天邀请' })).toBeEnabled()
  await expect(card.getByTestId('relay-url')).toBeVisible()
  await visitors.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText('当前未连接')
  await card.getByRole('button', { name: '关闭公网发布' }).click()
  await expect(card.getByRole('button', { name: '开启公网发布', exact: true })).toBeEnabled()
  await expect(card.getByRole('status')).toHaveCount(0)
  expect((await fetch(`http://127.0.0.1:${portal.agents[0]!.record.config.network.port}/.well-known/agent-card.json`)).status).toBe(200)
})

test('reserve before first startup, add a visitor and prepare the same offline invitation after refresh', async ({page,portal},testInfo)=>{
  const id=portal.agents[0]!.record.id
  await rm(join(portal.host,'agents',`${id}.pid`))
  await rm(join(portal.host,'relay',id,'applied.json'))
  const record=await portal.readRecord(id)
  record.config.network={...record.config.network,mode:'relay',relay:{provider:'default',enabled:false}}
  record.config.contactId='13998765432' // Legacy local ID must not enable an invitation before Relay registration.
  await writeFile(join(portal.host,'agents',`${id}.json`),JSON.stringify(record))
  await page.reload()
  const card=page.getByRole('region',{name:'公网中继'}), visitors=page.getByRole('region',{name:'邀请访客聊天'})
  await expect(visitors.getByTestId('agent-contact-id')).toHaveCount(0)
  await expect(visitors.getByRole('button',{name:'复制聊天邀请'})).toBeDisabled()
  await card.getByLabel('手机号（公开编号）').fill('13812345678')
  await card.getByRole('button',{name:'获取中继地址'}).click()
  await expect(card.getByRole('status')).toHaveText('地址已分配 · 待 Agent 启动')
  await expect(visitors.getByTestId('agent-contact-id')).toHaveText(/^13[89]\d{8}$/)
  const url=await card.getByTestId('relay-url').innerText()
  expect((await fetch(url.replace(/\/a2a$/,'/.well-known/agent-card.json'))).status).toBe(503)
  expect((await(await fetch(`${portal.baseURL}/api/agents/${id}/status`)).json()).running).toBe(false)
  await visitors.getByRole('button',{name:'添加新访客'}).click()
  await visitors.getByLabel('访客姓名').fill('小林')
  await visitors.getByRole('button',{name:'保存访客'}).click()
  await expect(visitors.getByText('已添加「小林」。下次启动 Agent 时生效。')).toBeVisible()
  await expect(visitors.getByRole('combobox',{name:'邀请访客'})).toHaveValue((await portal.readRecord(id)).config.peers[1]!.name)
  await visitors.getByRole('button',{name:'复制聊天邀请'}).click()
  await expect(visitors.getByTestId('relay-invitation')).toContainText(url)
  await expect(visitors.getByTestId('relay-invitation')).toContainText('当前未连接')
  await page.reload()
  await expect(card.getByTestId('relay-url')).toHaveText(url)
  await expect(visitors.getByRole('option',{name:'小林'})).toHaveCount(1)
  await page.screenshot({path:testInfo.outputPath('reserved-before-start.png'),fullPage:true})
})
