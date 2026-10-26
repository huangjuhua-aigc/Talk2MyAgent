import { test as base, expect } from '@playwright/test'
import { startPortal, type TestPortal } from '../support/portal.ts'

export const test = base.extend<{ portal: TestPortal; agentCount: number }>({
  agentCount: [2, { option: true }],
  portal: async ({ agentCount }, use) => {
    const portal = await startPortal(agentCount)
    try { await use(portal) } finally { await portal.close() }
  },
  page: async ({ page, portal }, use) => {
    const errors: string[] = []
    const unexpected: string[] = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (/(\/start|\/install|\/ensure-plugin|\/pick-directory)$/.test(path)) {
        unexpected.push(path)
        await route.fulfill({ status: 501, json: { error: 'External process or desktop interaction is disabled in UI tests' } })
      } else { await route.continue() }
    })
    await page.route('**/api/detect', route => route.fulfill({ json: {
      node: { version: 'v22.0.0', ok: true }, dsh: { installed: true, version: 'fixture' }, docker: { installed: false },
      keys: { DEEPSEEK_API_KEY: { configured: true, masked: 'fixture-key' } }, lanIps: ['127.0.0.1'],
      profile: { exists: true, pluginInstalled: true }, configured: true,
    } }))
    await page.goto(portal.baseURL)
    await use(page)
    expect(errors, 'Browser must not have uncaught errors').toEqual([])
    expect(unexpected, 'Tests must explicitly stub external side effects').toEqual([])
  },
})
export { expect }
