import { defineConfig } from '@playwright/test'

const channel = process.env['PLAYWRIGHT_CHANNEL'] ?? (process.platform === 'win32' ? 'msedge' : undefined)

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8000 },
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    browserName: 'chromium',
    ...(channel ? { channel } : {}),
    headless: true,
    viewport: { width: 1280, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
