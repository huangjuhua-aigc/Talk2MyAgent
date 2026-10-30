import { test, expect } from './fixtures.ts'

const cards = ['Agent 概览', '公网中继', '公开简报', '来访记录']

test('Cards fold independently, retain status, and remember preferences per agent after reload', async ({ page }, testInfo) => {
  for (const name of cards) {
    const card = page.getByRole('region', { name, exact: true })
    const toggle = card.getByRole('button', { name: `收起${name}`, exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(card.getByRole('button', { name: `展开${name}`, exact: true })).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(page.getByRole('button', { name: '启动', exact: true })).toBeHidden()
  await expect(page.getByLabel('Relay 服务')).toBeHidden()
  await expect(page.getByRole('button', { name: '编辑简报', exact: true })).toBeHidden()
  await expect(page.getByText('Alpha Agent 的访客问题', { exact: true })).toBeHidden()
  await expect(page.getByRole('region', { name: '公网中继', exact: true }).getByRole('status')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alpha Agent', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('collapsed-desktop.png'), fullPage: true })

  await page.reload()
  for (const name of cards) await expect(page.getByRole('button', { name: `展开${name}`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Beta Agent', exact: true }).click()
  for (const name of cards) await expect(page.getByRole('button', { name: `收起${name}`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Alpha Agent', exact: true }).click()
  for (const name of cards) await expect(page.getByRole('button', { name: `展开${name}`, exact: true })).toBeVisible()

  const overview = page.getByRole('region', { name: 'Agent 概览', exact: true })
  await overview.getByRole('button', { name: '展开Agent 概览', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(overview.getByRole('button', { name: '启动', exact: true })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(overview.getByRole('button', { name: '启动', exact: true })).toBeHidden()
})

test('Folding on a narrow screen preserves unfinished briefing and Relay settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const briefing = page.getByRole('region', { name: '公开简报', exact: true })
  const publication = page.getByRole('region', { name: '公网中继', exact: true })
  await briefing.getByRole('button', { name: '编辑简报', exact: true }).click()
  await briefing.getByRole('textbox', { name: '编辑公开简报' }).fill('仍在编辑，折叠后不能丢失。')
  await publication.getByLabel('Relay 服务').selectOption('custom')
  await publication.getByLabel('Relay host', { exact: true }).fill('https://my-relay.example.com')
  for (const name of cards) await page.getByRole('button', { name: `收起${name}`, exact: true }).click()
  await expect(briefing.getByText('编辑中', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('collapsed-mobile.png'), fullPage: true })
  await briefing.getByRole('button', { name: '展开公开简报', exact: true }).click()
  await expect(briefing.getByRole('textbox', { name: '编辑公开简报' })).toHaveValue('仍在编辑，折叠后不能丢失。')
  await publication.getByRole('button', { name: '展开公网中继', exact: true }).click()
  await expect(publication.getByLabel('Relay host', { exact: true })).toHaveValue('https://my-relay.example.com')
})

test('Cards remain usable when browser preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage disabled', 'SecurityError') }
    Storage.prototype.setItem = () => { throw new DOMException('Storage disabled', 'SecurityError') }
  })
  await page.reload()
  await page.getByRole('button', { name: '收起公开简报', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑简报', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '展开公开简报', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑简报', exact: true })).toBeVisible()
})
