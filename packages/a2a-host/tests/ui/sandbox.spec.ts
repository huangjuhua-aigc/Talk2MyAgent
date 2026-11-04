import { test, expect } from './fixtures.ts'

test('sandbox preparation is automatic in the wizard and does not ask for Docker', async ({ page }) => {
  await page.getByRole('button', { name: '+ 新建 Agent', exact: true }).click()
  await expect(page.getByText('访客独立沙箱', { exact: true })).toBeVisible()
  await expect(page.getByText('启动时自动准备', { exact: true })).toBeVisible()
  await expect(page.getByText(/安装.*Docker|构建.*镜像/)).toHaveCount(0)
})

test('start shows preparation progress, prevents duplicates, explains a missing hypervisor, and retries', async ({ page, portal }) => {
  const id = portal.agents[0]!.record.id
  let message = '首次使用，正在自动下载沙箱组件…', attempts = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/agents/${id}/status`, route => route.fulfill({ json: {
    running: false, logs: [], preparation: { phase: 'installing', message },
  } }))
  await page.route(`**/api/agents/${id}/start`, async route => {
    attempts++
    if (attempts === 1) {
      await gate
      await route.fulfill({ status: 500, json: { error: '请启用 Windows 虚拟机监控程序平台 (WHP) 并重启。' } })
    } else await route.fulfill({ json: { started: true, manual: 'fixture start' } })
  })
  const start = page.getByRole('button', { name: '启动', exact: true })
  await start.click()
  await expect(start).toBeDisabled()
  await expect(page.getByRole('button', { name: '添加新访客' })).toBeDisabled()
  await expect(page.getByRole('status', { name: '启动进度' })).toContainText('自动下载沙箱组件')
  message = '正在准备工具运行环境…'
  await expect(page.getByRole('status', { name: '启动进度' })).toContainText('准备工具运行环境')
  release()
  await expect(page.getByRole('alert')).toContainText('WHP')
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(start).toBeEnabled()
  expect(attempts).toBe(2)
})
