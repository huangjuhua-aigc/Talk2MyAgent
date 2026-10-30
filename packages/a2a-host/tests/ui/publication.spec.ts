import { test as base, expect } from './fixtures.ts'
import { startPortal } from '../support/portal.ts'
import { startTestRelay } from '../support/relay.ts'
import { command, status } from '@talk2myagent/a2a-connector'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
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
test('automatic publication, visitor invitation, real skill chat, closing and stable republish', async ({ page, portal }, testInfo) => {
  const card = page.getByRole('region', { name: '公网中继' })
  await expect(card.getByRole('button', { name: '复制聊天邀请' })).toBeDisabled()
  await card.getByRole('button', { name: '开启公网发布' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  const url = await card.getByTestId('relay-url').innerText()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await card.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(card.getByTestId('relay-invitation')).toContainText(url)
  const invitation = await card.getByTestId('relay-invitation').innerText()
  expect(invitation).toContain('--card-url'); expect(invitation).not.toContain(portal.agents[0]!.record.config.adminToken)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replace(/\r\n/g, '\n')).toBe(invitation)
  const script = fileURLToPath(new URL('../../../a2a-skill/bin/a2a.mjs', import.meta.url))
  const env = { ...process.env, A2A_HOME: join(portal.root, 'visitor'), A2A_TEST_TOKEN: portal.agents[0]!.record.config.peers[0]!.token }
  const cardUrl = url.replace(/\/a2a$/, '/.well-known/agent-card.json')
  await exec(process.execPath, [script, 'add', 'relay', url, 'A2A_TEST_TOKEN', 'UI test', '--card-url', cardUrl], { env })
  expect((await exec(process.execPath, [script, 'card', 'relay'], { env })).stdout).toContain('Alpha Agent')
  expect((await exec(process.execPath, [script, 'send', 'relay', '你好'], { env })).stdout).toContain('公网联调成功')
  await page.screenshot({ path: testInfo.outputPath('relay-online.png'), fullPage: true })
  await page.reload()
  await expect(card.getByRole('status')).toHaveText('公网已上线')
  await card.getByRole('button', { name: '关闭公网发布' }).click()
  await expect(card.getByRole('status')).toHaveText('已关闭')
  await expect(card.getByRole('button', { name: '复制聊天邀请' })).toBeDisabled()
  expect((await fetch(cardUrl)).status).toBe(503)
  await card.getByRole('button', { name: '开启公网发布' }).click()
  await expect(card.getByTestId('relay-url')).toHaveText(url, { timeout: 15000 })
})

test('custom host validation and clipboard fallback leave a usable complete invitation', async ({ page, portal }) => {
  const card = page.getByRole('region', { name: '公网中继' })
  await card.getByLabel('Relay 服务').selectOption('custom')
  await expect(card.getByRole('button', { name: '开启公网发布' })).toBeDisabled()
  await card.getByLabel('Relay host', { exact: true }).fill('https://relay.test/not-an-origin')
  await expect(card.getByRole('button', { name: '开启公网发布' })).toBeDisabled()
  await expect(card.getByRole('alert')).toContainText('不需要路径')
  await expect(card.getByRole('button', { name: '复制聊天邀请' })).toBeDisabled()
  const session = await (await fetch(`${portal.baseURL}/api/session`)).json() as { defaultRelayHost: string }
  await card.getByLabel('Relay host', { exact: true }).fill(session.defaultRelayHost)
  await card.getByRole('button', { name: '开启公网发布' }).click()
  await expect(card.getByRole('status')).toHaveText('公网已上线', { timeout: 15000 })
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('denied') } }) })
  await card.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(card.getByRole('alert')).toContainText('手动复制')
  await expect(card.getByTestId('relay-invitation')).toContainText('--card-url')
  // Saved credentials can change before a running service has applied them.
  const record = await portal.readRecord(portal.agents[0]!.record.id)
  record.config.peers[0]!.token = 'not-yet-applied-token'
  await writeFile(join(portal.host, 'agents', `${record.id}.json`), JSON.stringify(record))
  await card.getByRole('button', { name: '复制聊天邀请' }).click()
  await expect(card.getByRole('alert')).toContainText('尚未应用')
  await expect(card.getByTestId('relay-invitation')).toHaveCount(0)
})

test('unreachable local agent cannot produce an invitation and publication can still be closed', async ({ page, portal }) => {
  const applied = join(portal.host, 'relay', portal.agents[0]!.record.id, 'applied.json')
  const runtime = JSON.parse(await readFile(applied, 'utf8')) as { port: number }
  runtime.port = 1
  await writeFile(applied, JSON.stringify(runtime))
  const card = page.getByRole('region', { name: '公网中继' })
  await card.getByRole('button', { name: '开启公网发布' }).click()
  await expect(card.getByRole('status')).toContainText('等待本地 agent', { timeout: 15000 })
  await expect(card.getByRole('button', { name: '复制聊天邀请' })).toBeDisabled()
  await expect(card.getByTestId('relay-url')).toHaveCount(0)
  await card.getByRole('button', { name: '关闭公网发布' }).click()
  await expect(card.getByRole('status')).toHaveText('已关闭')
  expect((await fetch(`http://127.0.0.1:${portal.agents[0]!.record.config.network.port}/.well-known/agent-card.json`)).status).toBe(200)
})
