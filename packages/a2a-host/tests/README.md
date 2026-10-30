# 自动化测试

本目录测试 Portal 的接口、命令行和浏览器行为。测试创建独立的临时 `A2A_HOST_HOME`、`DSH_HOME`、工作目录、随机监听端口及命名管道/Unix socket，结束时关闭测试进程并清理目录，不重启用户的服务。

## 运行

在仓库根目录执行：

```sh
pnpm install
pnpm --filter @talk2myagent/a2a-host test:all
pnpm --filter @talk2myagent/a2a-skill test
```

`test:all` 依次执行控制台接口测试、类型检查、前端生产构建和 UI 测试。单独执行 UI：

```sh
pnpm --filter @talk2myagent/a2a-host test:ui
pnpm --filter @talk2myagent/a2a-host test:ui:report
```

Windows 默认使用本机 Edge，无需下载浏览器。Linux/macOS 默认使用 Playwright Chromium，首次运行前执行：

```sh
pnpm --filter @talk2myagent/a2a-host exec playwright install chromium
```

`PLAYWRIGHT_CHANNEL` 可以覆盖浏览器选择；Windows 想用下载的 Chromium 时，可安装后在 PowerShell 执行 `$env:PLAYWRIGHT_CHANNEL = 'chromium'`。不要把测试指向真实公网 agent。

## 测试边界

- UI 使用真实生产构建、真实 Portal HTTP、真实文件保存及读取，以及带认证的本机主人 IPC。
- 管理监控使用确定性的主人 IPC 测试服务；简报开关测试读写真实设置文件，切换开关不提交模型任务。在线 agent 的每小时调度与重启行为由 `dsh-a2a/tests/briefing.spec.ts` 验证，模型使用测试适配器；未调用真实模型。
- 环境检测使用固定测试数据。创建向导中的启动步骤模拟返回值，不安装插件、不启动真实 DSH，不调用付费模型。意外触发安装、启动或桌面目录选择时测试失败。
- 所有浏览器用例检查未捕获的页面异常。失败保留截图与 trace，正常执行不自动重试。

## UI 用例清单

| ID | 操作与预期 |
| --- | --- |
| U01 | 展示正式简报、更新时间、来访记录；不显示采纳按钮或主人简报任务记录；保留截图 |
| U02 | 外部更新 `handoff.md` 后自动刷新；保留未保存编辑；保存只影响当前 agent |
| U03 | 取消编辑不改写文件 |
| U04 | 简报文件缺失时显示空状态，可手动创建 |
| U05 | 读取失败显示错误，后续刷新能恢复 |
| U06 | 保存失败保留编辑和按钮状态，重试成功 |
| U07 | 自动更新默认开启；关闭后刷新仍保持关闭，重新开启成功，原简报保留 |
| U08 × 2 | 开关保存返回 400/500 时显示错误，恢复按钮，保留原设置和简报 |
| U09 | 切换 agent 不带入上一位的未保存简报 |
| U10 | 上一位 agent 的延迟响应不得覆盖当前来访记录 |
| U11 | 不完整 URL、含凭据/查询参数的 URL、非法端口不能进入下一步 |
| U12 | 七步向导保存真实配置、模拟启动后进入新 agent 的控制台 |
| U13 | 从编辑界面新建 agent 时重置配置和步骤 |
| U14 | 配置保存失败显示原因，恢复按钮，可重试 |
| U15 | 启动失败显示原因，恢复按钮，不永久停在处理中 |
| U16 | 不同新 agent 的默认访客令牌不同 |
| U17 | 确认删除当前 agent 后切到剩余 agent，保留剩余资料 |
| U18 | 取消删除保留配置 |

## 中继与新版布局用例

设置 `A2A_RELAY_SOURCE` 为独立 [Relay 仓库](https://github.com/huangjuhua-aigc/a2a-relay-server) 的绝对路径，并先在该仓库安装依赖，才能运行全部中继 UI 用例；未设置时明确跳过 3 项中继集成。

- `publication.spec.ts`：3 项真实 Relay / Connector 发布、邀请、调用、关闭与恢复、地址校验、剪贴板回退和未应用配置检查。
- `layout.spec.ts`：6 项桌面/平板/手机布局、键盘焦点、网络模式切换、访客指令折叠和首次使用。
- `collapse.spec.ts`：3 项区块独立折叠、按 Agent 持久化、键盘操作、未保存编辑保留及存储不可用时的回退。
- `ports.test.ts`：3 项本地端口占用、检查后释放和非法端口拒绝。

完整 UI 套件共 31 项；后端与 CLI 共 13 项。调用技能另有 5 项测试，包括符合协议的 `GetTask` 直接 Task 响应。

## 报告与排查

- `playwright-report/index.html`：HTML 用例报告，包括 U01 成功截图与失败附件。
- `test-results/results.json`：机器可读结果。
- `test-results/<用例>/trace.zip`：失败时的浏览器操作、网络与页面记录。
- `pnpm exec playwright test --grep U10`：在 `packages/a2a-host` 目录内重跑某一用例（需已构建前端）。

报告和临时截图已加入 `.gitignore`，不会混入源码提交。2026-10-26 在 Windows / Edge 上，8 项接口与命令行测试、19 项 UI 测试通过；Linux/macOS 尚未实测。
