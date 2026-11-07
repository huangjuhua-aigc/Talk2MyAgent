import { test as base, expect } from './fixtures.ts'
import { startPortal } from '../support/portal.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const test = base.extend({ portal: async ({}, use) => {
  const portal = await startPortal(1, { liveVisitors: true })
  try { await use(portal) } finally { await portal.close() }
} })

test('an online Agent applies a saved visitor immediately without stop or start requests', async ({ page, portal }) => {
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  const before = await portal.readRecord(portal.agents[0]!.record.id)
  let stopped = false
  await page.route('**/stop', async route => { stopped = true; await route.fulfill({ status: 500, json: {} }) })
  await card.getByRole('button', { name: '添加新访客' }).click()
  await card.getByLabel('访客姓名').fill('即时访客')
  await card.getByRole('button', { name: '保存访客', exact: true }).click()
  await expect(card.getByText('已添加「即时访客」。已立即生效，无需重启。')).toBeVisible()
  await expect(card.getByRole('combobox', { name: '邀请访客', exact: true })).toContainText('即时访客')
  await expect(card.getByRole('button', { name: '重启并应用' })).toHaveCount(0)
  const record = await portal.readRecord(before.id)
  expect(record.config.peers[0]).toEqual(before.config.peers[0])
  expect(record.config.isolation).toEqual(before.config.isolation)
  const detail = await (await page.request.get(`${portal.baseURL}/api/agents/${before.id}`)).json()
  expect(detail.appliedPeers).toEqual(record.config.peers.map(peer => peer.name))
  await page.reload()
  await card.getByRole('combobox', { name: '邀请访客', exact: true }).selectOption(record.config.peers[1]!.name)
  await expect(card.getByRole('button', { name: '重启并应用' })).toHaveCount(0)
  expect(portal.agents[0]!.liveVisitorCalls).toBe(1)
  expect(stopped).toBe(false)
})

for (const mode of ['unsupported', 'unconfirmed'] as const) test(`a ${mode} runtime keeps the visitor saved and never falsely claims it applied`, async ({ page, portal }) => {
  portal.agents[0]!.liveVisitorMode = mode
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '添加新访客' }).click()
  await card.getByLabel('访客姓名').fill('待应用访客')
  await card.getByRole('button', { name: '保存访客', exact: true }).click()
  await expect(card.getByText(/已添加「待应用访客」。配置已保存，当前 Agent 未确认应用/)).toBeVisible()
  await expect(card.getByRole('button', { name: '重启并应用' })).toBeVisible()
  const detail = await (await page.request.get(`${portal.baseURL}/api/agents/${portal.agents[0]!.record.id}`)).json()
  expect(detail.appliedPeers).toEqual(['alice'])
  expect(detail.config.peers).toHaveLength(2)
  expect(portal.agents[0]!.liveVisitorCalls).toBe(1)
})

test('a pending removal cannot be marked applied by adding another visitor', async ({ page, portal }) => {
  const record = await portal.readRecord(portal.agents[0]!.record.id)
  record.config.peers = []
  await writeFile(join(portal.host, 'agents', `${record.id}.json`), JSON.stringify(record))
  await page.reload()
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '添加新访客' }).click()
  await card.getByLabel('访客姓名').fill('后续访客')
  await card.getByRole('button', { name: '保存访客', exact: true }).click()
  await expect(card.getByRole('button', { name: '重启并应用' })).toBeVisible()
  const detail = await (await page.request.get(`${portal.baseURL}/api/agents/${record.id}`)).json()
  expect(detail.appliedPeers).toEqual([])
  expect(portal.agents[0]!.liveVisitorCalls).toBe(0)
})
