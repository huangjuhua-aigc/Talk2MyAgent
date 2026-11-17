import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startPortal } from '../support/portal.ts'

for (const provider of ['google', 'feishu']) {
  test(`local calendar authorization UI: ${provider}`, async ({ page, context }, testInfo) => {
    const source = process.env['A2A_PLUGIN_SOURCE']; test.skip(!source, 'Set A2A_PLUGIN_SOURCE to the dsh-a2a checkout')
    const { startProviderFixture } = await import(pathToFileURL(join(source!, 'tests/support/calendar-provider.mjs')).href)
    const remote = await startProviderFixture(), portal = await startPortal(1, { calendarFixture: remote.origin, googleClientId: '' })
    try {
      await context.route(/https:\/\/(accounts.google.com|accounts.feishu.cn|open.feishu.cn)\//, async route => {
        const url = new URL(route.request().url())
        if (url.hostname === 'accounts.google.com') {
          const callback = new URL(url.searchParams.get('redirect_uri')!)
          callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'test' }).toString()
          await route.fulfill({ status: 302, headers: { location: callback.href } })
        } else {
          url.hostname === 'open.feishu.cn' ? remote.approveApp() : remote.approveUser()
          await route.fulfill({ contentType: 'text/html', body: '<h1>测试平台已同意授权</h1>' })
        }
      })
      await page.goto(portal.baseURL)
      const card = page.getByRole('region', { name: '日历授权' })
      await card.getByLabel('日历渠道').selectOption(provider)
      await expect(card.getByRole('button', { name: '连接日历', exact: true })).toBeEnabled()
      await expect(card.locator('input')).toHaveCount(0)
      if (provider === 'google') {
        await card.getByRole('button', { name: '连接日历', exact: true }).click()
        const setup = card.getByRole('group', { name: '首次连接 Google Calendar' })
        await expect(setup).toBeVisible()
        await expect(setup.getByRole('button', { name: '保存配置并授权' })).toBeDisabled()
        await card.screenshot({ path: testInfo.outputPath('google-first-connection.png') })
        for (const [file, error] of [['not JSON', /不是有效的 JSON/], [JSON.stringify({ web: { client_id: 'test' } }), /Desktop/]] as const) {
          await setup.getByLabel('Google 客户端 JSON').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(file) })
          await setup.getByRole('button', { name: '保存配置并授权' }).click()
          await expect(card.getByRole('alert')).toContainText(error)
          await expect(setup).toBeVisible()
        }
        await setup.getByLabel('Google 客户端 JSON').setInputFiles({ name: 'desktop-client.json', mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ installed: { client_id: '1234-ui.apps.googleusercontent.com', client_secret: 'UI_CLIENT_SECRET' } })) })
        const popup = context.waitForEvent('page')
        await setup.getByRole('button', { name: '保存配置并授权' }).click(); await popup
      } else {
        const popup = context.waitForEvent('page')
        await card.getByRole('button', { name: '连接日历', exact: true }).click(); await popup
      }
      if (provider === 'feishu') await card.getByRole('link', { name: '继续授权飞书日历' }).click()
      await expect(card.getByText('已连接', { exact: true })).toBeVisible({ timeout: 20000 })
      await expect(card.getByRole('status')).toContainText('下次启动 Agent')
      await card.screenshot({ path: testInfo.outputPath(`calendar-${provider}.png`) })
      await page.reload(); await expect(card.getByText('已连接', { exact: true })).toBeVisible()
      await card.getByRole('button', { name: '解除日历连接' }).click()
      await expect(card.getByRole('button', { name: '连接日历', exact: true })).toBeEnabled()
      if (provider === 'google') {
        await page.reload()
        await card.getByLabel('日历渠道').selectOption('google')
        await expect(card.getByText('已保存此 Agent 的 Google 配置，可直接登录授权。')).toBeVisible()
        await expect(card.locator('input[type="file"]')).toHaveCount(0)
        const popup = context.waitForEvent('page')
        await card.getByRole('button', { name: '连接日历', exact: true }).click(); await popup
        await expect(card.getByText('已连接', { exact: true })).toBeVisible({ timeout: 20000 })
      }
    } finally { await portal.close(); await remote.close() }
  })
}
test('unconfigured Google button opens setup, can cancel, and fits mobile layout', async ({ page }, testInfo) => {
  const portal = await startPortal(1)
  try {
    await page.goto(portal.baseURL)
    const card = page.getByRole('region', { name: '日历授权' })
    await card.getByLabel('日历渠道').selectOption('google')
    await expect(card.getByRole('button', { name: '连接日历', exact: true })).toBeEnabled()
    await card.getByRole('button', { name: '连接日历', exact: true }).click()
    const setup = card.getByRole('group', { name: '首次连接 Google Calendar' })
    await expect(setup).toBeVisible()
    await expect(setup.getByRole('link', { name: 'Clients', exact: true })).toHaveAttribute('href', 'https://console.cloud.google.com/auth/clients')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(setup).toBeVisible()
    expect(await setup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await card.screenshot({ path: testInfo.outputPath('google-setup-mobile.png') })
    await setup.getByRole('button', { name: '取消', exact: true }).click()
    await expect(setup).toHaveCount(0)
    await expect(card.locator('option')).toHaveCount(2)
    await card.getByLabel('日历渠道').selectOption('feishu')
    await expect(card.getByRole('button', { name: '连接日历', exact: true })).toBeEnabled()
    await expect(card.getByText(/加密保存在本机/)).toBeVisible()
  } finally { await portal.close() }
})
