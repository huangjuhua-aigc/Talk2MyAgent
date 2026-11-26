import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test as base, expect } from './fixtures.ts'
import { startPortal } from '../support/portal.ts'

const test = base.extend({
  portal: async ({}, use) => {
    const portal = await startPortal(1, { relayOrigin: null })
    try { await use(portal) } finally { await portal.close() }
  },
})

test('built-in Relay appears in the console and new-agent wizard without registering on page load', async ({ page, portal }) => {
  const session = await (await fetch(`${portal.baseURL}/api/session`)).json()
  expect(session.defaultRelayHost).toBe('https://relay.huangjuhua.cn')
  const card = page.getByRole('region', { name: '公网中继' })
  await expect(card.getByLabel('Relay 服务').locator('option:checked')).toHaveText('默认 Relay · https://relay.huangjuhua.cn')
  await expect(card.getByTestId('relay-url')).toHaveCount(0)
  await expect(card.getByRole('button', { name: '获取中继地址' })).toBeDisabled()
  await card.getByLabel('手机号（公开编号）').fill('13812345678')
  await expect(card.getByRole('button', { name: '获取中继地址' })).toBeEnabled()

  await page.getByRole('button', { name: '+ 新建 Agent', exact: true }).click()
  await page.getByRole('button', { name: '继续 →', exact: true }).click()
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await page.getByRole('radio', { name: /公网中继/ }).check()
  await expect(page.getByLabel('Relay 服务').locator('option:checked')).toHaveText('默认 Relay · https://relay.huangjuhua.cn')
  await page.getByLabel('手机号（公开编号）').fill('13812345678')
  await expect(page.getByRole('button', { name: '下一步 →', exact: true })).toBeEnabled()
  const status = await (await fetch(`${portal.baseURL}/api/agents/${portal.agents[0]!.record.id}/publication/status`)).json()
  expect(status.state).toBe('unregistered')
})

test('updating the built-in Relay preserves an explicitly saved custom host', async ({ page, portal }) => {
  const record = await portal.readRecord(portal.agents[0]!.record.id)
  record.config.network = { ...record.config.network, mode: 'relay', relay: {
    provider: 'custom', host: 'https://relay.creez.cn', enabled: false, contactId: '13812345678',
  } }
  await writeFile(join(portal.host, 'agents', `${record.id}.json`), JSON.stringify(record))
  await page.reload()
  const card = page.getByRole('region', { name: '公网中继' })
  await expect(card.getByLabel('Relay 服务')).toHaveValue('custom')
  await expect(card.getByLabel('Relay host', { exact: true })).toHaveValue('https://relay.creez.cn')
  await expect(card.getByLabel('Relay 服务').locator('option[value="default"]')).toHaveText('默认 Relay · https://relay.huangjuhua.cn')
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await page.getByRole('button', { name: '4. 网络', exact: true }).click()
  await expect(page.getByLabel('Relay host', { exact: true })).toHaveValue('https://relay.creez.cn')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存 ✓', exact: true })).toBeVisible()
  expect((await portal.readRecord(record.id)).config.network.relay?.host).toBe('https://relay.creez.cn')
})
