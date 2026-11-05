import { test, expect } from './fixtures.ts'

test('public visitor switch defaults off, persists through reload, and copies an invitation without a shared token', async ({ page, portal }, testInfo) => {
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  const toggle = card.getByRole('switch', { name: '允许公开访客' })
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
  await expect(card.getByRole('button', { name: '复制公开邀请' })).toHaveCount(0)
  await toggle.click(); await expect(card.getByText('设置已保存，下次启动 Agent 时生效。')).toBeVisible()
  await page.reload(); await expect(toggle).toBeChecked()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await card.getByRole('button', { name: '复制公开邀请' }).click()
  await expect(card.getByRole('button', { name: '公开邀请已复制', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '复制聊天邀请', exact: true })).toBeVisible()
  await expect(card.getByTestId('relay-invitation')).toContainText('a2a.mjs send')
  await expect(card.getByTestId('relay-invitation')).not.toContainText('a2a.mjs join')
  const text = await card.getByTestId('relay-invitation').innerText()
  for (const p of portal.agents[0]!.record.config.peers) expect(text).not.toContain(p.token)
  const button = await card.getByRole('button', { name: '公开邀请已复制', exact: true }).boundingBox()
  const preview = await card.getByLabel('公开邀请指令', { exact: true }).boundingBox()
  const selectedVisitor = await card.getByRole('combobox', { name: '邀请访客', exact: true }).boundingBox()
  expect(preview!.y).toBeGreaterThanOrEqual(button!.y + button!.height)
  expect(preview!.y + preview!.height).toBeLessThan(selectedVisitor!.y)
  await card.screenshot({ path: testInfo.outputPath('public-invitation-under-button.png') })
  await card.getByRole('button', { name: '复制聊天邀请', exact: true }).click()
  await expect(card.getByLabel('公开邀请指令', { exact: true })).toHaveCount(0)
  await expect(card.getByLabel('访客邀请指令', { exact: true })).toContainText(portal.agents[0]!.record.config.peers[0]!.token)
  await expect(card.getByRole('button', { name: '复制公开邀请', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '邀请已复制', exact: true })).toBeVisible()
  await toggle.click(); await expect(toggle).not.toBeChecked()
  await expect(card.getByTestId('relay-invitation')).toHaveCount(0)
  await page.reload(); await expect(toggle).not.toBeChecked()
  await expect(card.getByRole('button', { name: '复制公开邀请' })).toHaveCount(0)
})

test('failed public access save retains the old state and can be retried', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: '允许公开访客' })
  await expect(toggle).toBeEnabled()
  await page.route('**/public-visitors', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'fixture save failed' } })
    else await route.continue()
  })
  await toggle.click(); await expect(page.getByRole('alert')).toContainText('fixture save failed')
  await expect(toggle).not.toBeChecked()
  await page.unroute('**/public-visitors'); await toggle.click(); await expect(toggle).toBeChecked()
})

test('public access settings remain independent when switching between agents', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: '允许公开访客' })
  await expect(toggle).toBeEnabled(); await toggle.click(); await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: 'Beta Agent', exact: true }).click()
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
  await expect(page.getByRole('button', { name: '复制公开邀请' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Alpha Agent', exact: true }).click()
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('button', { name: '复制公开邀请' })).toBeEnabled()
})

test('a stale running plugin warns about restart and cannot copy a misleading public invitation', async ({ page }) => {
  await page.route('**/public-visitors', route => route.fulfill({ json: { enabled: true, turnLimit: 5, requiresRestart: true } }))
  await page.reload()
  await expect(page.getByRole('switch', { name: '允许公开访客' })).toBeChecked()
  await expect(page.getByText('当前 Agent 需要升级插件并重启，才能应用此开关。')).toBeVisible()
  await expect(page.getByRole('button', { name: '复制公开邀请' })).toBeDisabled()
  // Existing invited visitors retain their separate invitation path.
  await expect(page.getByRole('button', { name: '复制聊天邀请', exact: true })).toBeEnabled()
})

test('stopped agent recovers visitor controls after an initial settings read failure without starting', async ({ page, portal }) => {
  let unavailable = true
  await page.route('**/public-visitors', async route => {
    if (route.request().method() === 'GET' && unavailable) {
      await route.fulfill({ status: 503, json: { error: 'Temporary settings read failure' } })
    } else await route.continue()
  })
  await page.reload()
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  await expect(page.getByRole('region', { name: 'Agent 概览' }).getByText('未运行', { exact: true })).toBeVisible()
  await expect(card.getByRole('alert')).toContainText('无法读取公开访客设置')
  await expect(card.getByRole('button', { name: '添加新访客' })).toBeEnabled()
  unavailable = false
  const toggle = card.getByRole('switch', { name: '允许公开访客' })
  // A transient GET failure must recover without a reload or runtime-state change.
  await expect(toggle).toBeEnabled()
  await expect(card.getByRole('alert')).toHaveCount(0)
  await toggle.click()
  await expect(card.getByText('设置已保存，下次启动 Agent 时生效。')).toBeVisible()
  expect((await (await page.request.get(`${portal.baseURL}/api/agents/${portal.agents[0]!.record.id}/status`)).json()).running).toBe(false)
})

test('waiting for clipboard permission does not lock a stopped agents visitor settings', async ({ page, portal }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => new Promise<void>(() => {}) })
  })
  await page.reload()
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  await card.getByRole('button', { name: '复制聊天邀请', exact: true }).click()
  await expect(card.getByLabel('访客邀请指令', { exact: true })).toBeVisible()
  const toggle = card.getByRole('switch', { name: '允许公开访客' })
  await expect(toggle).toBeEnabled({ timeout: 1000 })
  await toggle.click()
  await expect(card.getByText('设置已保存，下次启动 Agent 时生效。')).toBeVisible()
  await card.getByRole('button', { name: '添加新访客' }).click()
  await card.getByLabel('访客姓名').fill('离线访客')
  await card.getByRole('button', { name: '保存访客', exact: true }).click()
  await expect(card.getByText('已添加「离线访客」。下次启动 Agent 时生效。')).toBeVisible()
  expect((await portal.readRecord(portal.agents[0]!.record.id)).config.peers).toHaveLength(2)
})

test('hung settings read times out and can be retried without starting the agent', async ({ page }) => {
  await page.clock.install()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let unavailable = true
  await page.route('**/public-visitors', async route => {
    if (route.request().method() === 'GET' && unavailable) {
      await pending
      await route.abort().catch(() => {})
    } else await route.continue()
  })
  try {
    await page.reload()
    const card = page.getByRole('region', { name: '邀请访客聊天' })
    await expect(card.getByText('正在读取公开访客设置…')).toBeVisible()
    await expect(card.getByRole('button', { name: '添加新访客' })).toBeEnabled()
    await page.clock.runFor(10050)
    await expect(card.getByRole('alert')).toContainText('无法读取公开访客设置')
    unavailable = false; release()
    await card.getByRole('button', { name: '重新读取访客设置' }).click()
    await expect(card.getByRole('switch', { name: '允许公开访客' })).toBeEnabled()
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '启动', exact: true })).toBeEnabled()
  } finally { release() }
})

test('clipboard timeout offers manual copying and late completion cannot restore a closed public invitation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => new Promise<void>(resolve => {
      Object.assign(window, { finishClipboard: resolve })
    }) })
  })
  await page.reload()
  const card = page.getByRole('region', { name: '邀请访客聊天' })
  const toggle = card.getByRole('switch', { name: '允许公开访客' })
  await toggle.click()
  await card.getByRole('button', { name: '复制公开邀请', exact: true }).click()
  await expect(card.getByLabel('公开邀请指令', { exact: true })).toBeVisible()
  await expect(card.getByRole('alert')).toContainText('剪贴板不可用或等待超时')
  await expect(card.getByRole('button', { name: '复制公开邀请', exact: true })).toBeEnabled()
  await card.getByRole('button', { name: '复制公开邀请', exact: true }).click()
  await expect(card.getByLabel('公开邀请指令', { exact: true })).toBeVisible()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(card.getByTestId('relay-invitation')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { finishClipboard: () => void }).finishClipboard())
  await expect(card.getByTestId('relay-invitation')).toHaveCount(0)
  await expect(card.getByRole('button', { name: '添加新访客' })).toBeEnabled()
})
