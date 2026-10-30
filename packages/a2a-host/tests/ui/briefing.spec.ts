import { readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from './fixtures.ts'

test('U01 shows the published briefing, timestamp and visitor history', async ({ page }, testInfo) => {
  await expect(page.getByRole('heading', { name: '公开简报', exact: true })).toBeVisible()
  await expect(page.locator('pre').filter({ hasText: 'Alpha Agent 的第一版简报' })).toBeVisible()
  await expect(page.getByText(/最近更新：/)).toBeVisible()
  await expect(page.getByText('Alpha Agent 的访客问题', { exact: true })).toBeVisible()
  await expect(page.getByText('Alpha Agent 的答复', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳为正式简报' })).toHaveCount(0)
  await expect(page.getByText('AUTOMATIC_BRIEFING_PRIVATE_TASK', { exact: true })).toHaveCount(0)
  await expect(page.getByText('OWNER_BRIEFING_UPDATE', { exact: true })).toHaveCount(0)
  await testInfo.attach('portal-published-briefing', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('U02 refreshes external updates without losing manual edits, then saves', async ({ page, portal }) => {
  await page.getByRole('button', { name: '编辑简报', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '编辑公开简报' })
  await editor.fill('人工编辑的内容')
  await writeFile(portal.agents[0]!.briefing, '定时任务刚刚更新的正式内容')
  await expect(page.locator('pre').filter({ hasText: '定时任务刚刚更新的正式内容' })).toBeVisible()
  await expect(editor).toHaveValue('人工编辑的内容')
  await page.getByRole('button', { name: '保存简报', exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: '人工编辑的内容' })).toBeVisible()
  expect(await readFile(portal.agents[0]!.briefing, 'utf8')).toBe('人工编辑的内容')
  expect(await readFile(portal.agents[1]!.briefing, 'utf8')).toContain('Beta Agent 的第一版简报')
})

test('U03 canceling an edit preserves the current public file', async ({ page, portal }) => {
  await page.getByRole('button', { name: '编辑简报', exact: true }).click()
  await page.getByRole('textbox', { name: '编辑公开简报' }).fill('不应保存的改动')
  await page.getByRole('button', { name: '取消编辑' }).click()
  await expect(page.getByRole('textbox', { name: '编辑公开简报' })).toHaveCount(0)
  expect(await readFile(portal.agents[0]!.briefing, 'utf8')).not.toContain('不应保存')
})

test('U04 handles a missing briefing and creates it through manual save', async ({ page, portal }) => {
  await rm(portal.agents[0]!.briefing)
  await expect(page.getByText('暂无简报。自动更新默认开启，agent 在线后会整理；也可以手动填写。')).toBeVisible()
  await page.getByRole('button', { name: '编辑简报', exact: true }).click()
  await page.getByRole('textbox', { name: '编辑公开简报' }).fill('第一份正式简报')
  await page.getByRole('button', { name: '保存简报', exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: '第一份正式简报' })).toBeVisible()
  expect(await readFile(portal.agents[0]!.briefing, 'utf8')).toBe('第一份正式简报')
})

test('U05 reports read errors and recovers on the next refresh', async ({ page, portal }) => {
  const url = `**/api/agents/${portal.agents[0]!.record.id}/handoff`
  await page.route(url, route => route.fulfill({ status: 500, json: { error: 'fixture read failure' } }), { times: 1 })
  await expect(page.getByRole('alert')).toContainText('简报读取失败')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('pre').filter({ hasText: 'Alpha Agent 的第一版简报' })).toBeVisible()
})

test('U06 failed save keeps edits and allows retry', async ({ page, portal }) => {
  const url = `**/api/agents/${portal.agents[0]!.record.id}/handoff`
  await page.route(url, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'fixture disk failure' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: '编辑简报', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '编辑公开简报' })
  await editor.fill('失败后保留的编辑')
  await page.getByRole('button', { name: '保存简报', exact: true }).click()
  await expect(page.getByRole('region', { name: '公开简报' }).getByRole('status')).toContainText('保存失败')
  await expect(editor).toHaveValue('失败后保留的编辑')
  await expect(page.getByRole('button', { name: '保存简报', exact: true })).toBeEnabled()
  await page.unroute(url)
  await page.getByRole('button', { name: '保存简报', exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: '失败后保留的编辑' })).toBeVisible()
})

test('U07 automatic briefing defaults on and its switch persists after reload', async ({ page, portal }) => {
  const toggle = page.getByRole('switch', { name: '自动更新简报' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(page.getByRole('region', { name: '公开简报' }).getByRole('status')).toContainText('自动更新已关闭')
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await expect(page.locator('pre').filter({ hasText: 'Alpha Agent 的第一版简报' })).toBeVisible()
  await toggle.click()
  await expect(page.getByRole('region', { name: '公开简报' }).getByRole('status')).toContainText('自动更新已开启')
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('button', { name: '开启定时简报' })).toHaveCount(0)
  expect(portal.agents[0]!.taskCalls).toBe(0)
})

for (const status of [400, 500]) {
  test(`U08 failed switch update (${status}) preserves its previous setting`, async ({ page, portal }) => {
    await page.route(`**/api/agents/${portal.agents[0]!.record.id}/briefing-auto`, route => route.fulfill({ status, json: { error: 'fixture settings failure' } }))
    const toggle = page.getByRole('switch', { name: '自动更新简报' })
    await toggle.click()
    await expect(page.getByRole('region', { name: '公开简报' }).getByRole('status')).toContainText('设置失败')
    await expect(toggle).toBeEnabled()
    await expect(toggle).toBeChecked()
    expect(await readFile(portal.agents[0]!.briefing, 'utf8')).toContain('第一版简报')
  })
}

test('U09 switching agents does not carry manual edits to another workspace', async ({ page, portal }) => {
  await page.getByRole('button', { name: '编辑简报', exact: true }).click()
  await page.getByRole('textbox', { name: '编辑公开简报' }).fill('Alpha 未保存内容')
  await page.getByRole('button', { name: 'Beta Agent', exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: 'Beta Agent 的第一版简报' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '编辑公开简报' })).toHaveCount(0)
  expect(await readFile(portal.agents[1]!.briefing, 'utf8')).not.toContain('Alpha')
})

test('U10 a delayed previous-agent response cannot replace current visitor history', async ({ page, portal }) => {
  const alpha = portal.agents[0]!
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  let entered!: () => void
  const waiting = new Promise<void>(done => { entered = done })
  await page.route(`**/api/agents/${alpha.record.id}/monitor`, async route => {
    entered()
    await gate
    await route.fulfill({ json: { ok: true, snapshot: { generatedAt: new Date().toISOString(), contexts: [{
      contextId: 'old-alpha', peer: 'OLD_ALPHA_RESPONSE', cwd: '', lastTouchedAt: Date.now(), active: 0, tasks: [],
    }] } } })
  }, { times: 1 })
  try {
    await waiting
    await page.getByRole('button', { name: 'Beta Agent', exact: true }).click()
    await expect(page.getByText('Beta Agent 的答复', { exact: true })).toBeVisible()
    const delivered = page.waitForResponse(response => response.url().includes(`${alpha.record.id}/monitor`))
    release()
    await delivered
    // Let React process the stale completion; no wall-clock sleep is needed.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    expect(await page.getByText('OLD_ALPHA_RESPONSE', { exact: true }).count()).toBe(0)
    expect(await page.getByText('Beta Agent 的答复', { exact: true }).isVisible()).toBe(true)
  } finally { release() }
})
