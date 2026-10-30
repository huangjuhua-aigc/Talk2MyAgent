import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures.ts'

async function expectNoPageOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  )
}

async function expectComfortableInput(input: Locator): Promise<void> {
  const size = await input.boundingBox()
  expect(size?.height).toBeGreaterThanOrEqual(48)
  expect(size?.width).toBeGreaterThan(200)
  expect(await input.evaluate(element => element.clientWidth / element.parentElement!.clientWidth)).toBeGreaterThan(.95)
}

for (const width of [1280, 820, 390]) {
  test(`Relay forms remain readable and usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    const overview = page.getByRole('region', { name: 'Agent 概览' })
    await expect(overview.getByRole('button', { name: '启动', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '公开简报', exact: true })).toBeVisible()
    const publication = page.getByRole('region', { name: '公网中继' })
    await publication.getByLabel('Relay 服务').selectOption('custom')
    const consoleHost = publication.getByLabel('Relay host', { exact: true })
    await consoleHost.fill('https://my-team-relay.example.com')
    await expectComfortableInput(consoleHost)
    await expectNoPageOverflow(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`console-${width}.png`), fullPage: true })

    await overview.getByRole('button', { name: '编辑配置', exact: true }).click()
    await page.getByRole('button', { name: '4. 网络', exact: true }).click()
    const network = page.getByRole('region', { name: '网络设置' })
    await network.getByRole('radio', { name: /公网中继/ }).check()
    await network.getByLabel('Relay 服务').selectOption('custom')
    const host = network.getByLabel('Relay host', { exact: true })
    await host.fill('https://a-team-with-a-long-name.relay.example.com')
    await expectComfortableInput(host)
    await expect(page.getByRole('button', { name: '4. 网络', exact: true })).toHaveAttribute('aria-current', 'step')
    await expectNoPageOverflow(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`network-${width}.png`), fullPage: true })

    // Switching modes exposes only the applicable fields, and preserves work.
    await network.getByRole('radio', { name: /局域网地址/ }).check()
    await expect(host).toHaveCount(0)
    await network.getByRole('radio', { name: /公网中继/ }).check()
    await expect(host).toHaveValue('https://a-team-with-a-long-name.relay.example.com')
  })
}

test('Relay host has a keyboard focus indicator and validates before advancing', async ({ page }) => {
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await page.getByRole('button', { name: '4. 网络', exact: true }).click()
  const network = page.getByRole('region', { name: '网络设置' })
  await network.getByRole('radio', { name: /公网中继/ }).check()
  const service = network.getByLabel('Relay 服务')
  await service.selectOption('custom')
  await service.focus()
  await page.keyboard.press('Tab')
  const host = network.getByLabel('Relay host', { exact: true })
  await expect(host).toBeFocused()
  expect(await host.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await host.fill('https://relay.example.com/path')
  await expect(host).toHaveAttribute('aria-invalid', 'true')
  await expect(network.getByRole('button', { name: '下一步 →' })).toBeDisabled()
  await host.fill('https://relay.example.com')
  await expect(network.getByRole('button', { name: '下一步 →' })).toBeEnabled()
  await network.getByRole('button', { name: '下一步 →' }).click()
  await expect(page.getByRole('heading', { name: '访客', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '复制配置指令' })).toHaveCount(0)
  await expect(page.getByText('Relay 服务可访问后，还需保存并启动 Agent。请在控制台「公网中继」查看连接状态，显示「公网已上线」时即可复制聊天邀请。')).toBeVisible()
})

test('Visitor settings use labelled fields and disclose long instructions on demand', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await page.getByRole('button', { name: '5. 访客', exact: true }).click()
  await expect(page.getByLabel('访客名', { exact: true })).toBeVisible()
  await expect(page.getByLabel('访客令牌', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '复制配置指令' })).toBeHidden()
  await page.getByText('查看与复制访客配置指令', { exact: true }).click()
  await expect(page.getByRole('button', { name: '复制配置指令' })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('visitors-mobile.png'), fullPage: true })
})

test.describe('First use', () => {
  test.use({ agentCount: 0 })
  test('Empty state leads into setup and allows returning without creating an agent', async ({ page }) => {
    await page.getByRole('button', { name: '创建第一个 Agent →' }).click()
    await expect(page.getByRole('heading', { name: '创建你的 Agent' })).toBeVisible()
    await page.getByRole('button', { name: '暂不配置，返回首页' }).click()
    await expect(page.getByRole('button', { name: '创建第一个 Agent →' })).toBeVisible()
    await expect(page.locator('.sidebar-list button')).toHaveCount(0)
  })
})
