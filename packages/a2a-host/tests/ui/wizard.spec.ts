import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures.ts'

async function newAgentAtNetwork(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新建 Agent', exact: true }).click()
  await page.getByRole('button', { name: '继续 →', exact: true }).click()
  await page.getByLabel('名字', { exact: true }).fill('Created Agent')
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('Created by UI regression test')
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await page.getByRole('radio', { name: /自定义地址/ }).check()
}

test('U11 wizard rejects invalid network addresses before advancing', async ({ page }) => {
  await newAgentAtNetwork(page)
  const address = page.getByPlaceholder('100.101.102.103 或 a2a.example.com 或 https://a2a.example.com')
  const next = page.getByRole('button', { name: '下一步 →', exact: true })
  for (const value of ['https://', 'https://user:secret@agent.example', 'https://agent.example/?token=x']) {
    await address.fill(value)
    await expect(next).toBeDisabled()
  }
  await address.fill('https://agent.example')
  await expect(page.getByText('https://agent.example/a2a', { exact: true })).toBeVisible()
  await page.getByText('高级网络设置 · 本地端口 3080', { exact: true }).click()
  await page.getByLabel('端口（dsh web 服务监听端口）').fill('70000')
  await expect(next).toBeDisabled()
  await page.getByLabel('端口（dsh web 服务监听端口）').fill('3080')
  await expect(next).toBeEnabled()
})

test('U12 full wizard saves real files and enters the created agent console', async ({ page, portal }) => {
  await newAgentAtNetwork(page)
  await page.getByPlaceholder('100.101.102.103 或 a2a.example.com 或 https://a2a.example.com').fill('https://agent.example')
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: /允许对话和读取指定工作目录/ })).toBeChecked()
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await expect(page.getByRole('button', { name: '下一步 →', exact: true })).toBeDisabled()
  const workspace = join(portal.root, 'created-project')
  await mkdir(workspace)
  await page.getByPlaceholder('点击右侧在资源管理器中选择，或直接输入').fill(workspace)
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存 ✓', exact: true })).toBeVisible()
  const record = await portal.readRecord('created-agent')
  expect(record.config.isolation.workspaceRoot).toBe(workspace)
  expect(record.config.network.host).toBe('https://agent.example')
  expect(record.config.peers[0]!.trusted).toBe(true)
  // Starting the real paid-model harness is outside an isolated browser test.
  await page.route('**/api/agents/created-agent/start', route => route.fulfill({ json: { started: true, manual: 'fixture start' } }))
  await page.getByRole('button', { name: '启动', exact: true }).click()
  await page.getByRole('button', { name: '进入控制台 →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Created Agent', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '公开简报', exact: true })).toBeVisible()
})

test('U13 creating an agent from an open edit form resets the old configuration', async ({ page }) => {
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await page.getByRole('button', { name: /2\. 名片/ }).click()
  await page.getByLabel('名字', { exact: true }).fill('Unsaved Alpha edits')
  await page.getByRole('button', { name: '+ 新建 Agent', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续 →', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继续 →', exact: true }).click()
  await expect(page.getByLabel('名字', { exact: true })).toHaveValue('my-agent')
})

test('U14 failed configuration save displays an error and can be retried', async ({ page, portal }) => {
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await page.getByRole('button', { name: /2\. 名片/ }).click()
  await page.getByLabel('名字', { exact: true }).fill('Renamed Alpha')
  const url = `**/api/agents/${portal.agents[0]!.record.id}`
  await page.route(url, route => route.fulfill({ status: 500, json: { error: 'fixture save failure' } }), { times: 1 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存失败')
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存 ✓', exact: true })).toBeVisible()
  expect((await portal.readRecord(portal.agents[0]!.record.id)).config.card.name).toBe('Renamed Alpha')
})

test('U15 start failure does not leave the console permanently busy', async ({ page, portal }) => {
  await page.route(`**/api/agents/${portal.agents[0]!.record.id}/start`, route => route.fulfill({ status: 500, json: { error: 'fixture start failure' } }))
  await page.getByRole('button', { name: '启动', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('启动失败')
  await expect(page.getByRole('button', { name: '启动', exact: true })).toBeEnabled()
  await expect(page.getByText('处理中…', { exact: true })).toHaveCount(0)
})

test('U16 every new agent receives a fresh default visitor token', async ({ page }) => {
  await newAgentAtNetwork(page)
  await page.getByPlaceholder('100.101.102.103 或 a2a.example.com 或 https://a2a.example.com').fill('https://agent.example')
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  const first = await page.locator('.visitor input[type="text"]').nth(1).inputValue()
  await newAgentAtNetwork(page)
  await page.getByPlaceholder('100.101.102.103 或 a2a.example.com 或 https://a2a.example.com').fill('https://agent.example')
  await page.getByRole('button', { name: '下一步 →', exact: true }).click()
  const second = await page.locator('.visitor input[type="text"]').nth(1).inputValue()
  expect(first).toHaveLength(64)
  expect(second).toHaveLength(64)
  expect(second).not.toBe(first)
})

test('U17 deleting one agent selects the remaining agent without deleting its data', async ({ page, portal }) => {
  await expect(page.getByRole('heading', { name: 'Alpha Agent', exact: true })).toBeVisible()
  page.once('dialog', dialog => { void dialog.accept() })
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alpha Agent', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Beta Agent', exact: true })).toBeVisible()
  await expect(page.locator('pre').filter({ hasText: 'Beta Agent 的第一版简报' })).toBeVisible()
  await expect(portal.readRecord(portal.agents[0]!.record.id)).rejects.toThrow()
  expect((await portal.readRecord(portal.agents[1]!.record.id)).config.card.name).toBe('Beta Agent')
})

test('U18 canceling deletion keeps the saved agent', async ({ page, portal }) => {
  await expect(page.getByRole('heading', { name: 'Alpha Agent', exact: true })).toBeVisible()
  page.once('dialog', dialog => { void dialog.dismiss() })
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alpha Agent', exact: true })).toBeVisible()
  expect((await portal.readRecord(portal.agents[0]!.record.id)).config.card.name).toBe('Alpha Agent')
})
