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

Microsandbox 的自动准备单元测试覆盖插件更新、阶段进度、缓存复用与失败重试。浏览器测试覆盖自动准备提示、启动中防重复点击、下载进度、WHP 缺失提示与重试。原生 VM 隔离和 30 秒/10 分钟生命周期实测在 dsh-a2a 的 `pnpm test:microsandbox` 中。

可选的真实安装测试（使用临时 DSH_HOME，不改用户配置）可在本包目录执行：

```powershell
$env:A2A_HOST_RUNTIME_TEST='1'
$env:A2A_PLUGIN_SOURCE='D:\code\dsh-a2a' # 预先 pnpm build 的开发版插件
node --import tsx --test tests/visitor-runtime.integration.test.ts
```

该测试自动安装插件和沙箱依赖，需要网络和系统虚拟化；不调用模型。可用 `A2A_SANDBOX_HOME` 指定已有测试缓存。

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
| U11 | 本机 IP:端口合并输入；缺少端口、含凭据/查询参数、非法 IP 或端口不能进入下一步 |
| U12 | 七步向导保存真实配置，不启动 Agent 也能进入控制台准备邀请 |
| U13 | 从编辑界面新建 agent 时重置配置和步骤 |
| U14 | 配置保存失败显示原因，恢复按钮，可重试 |
| U15 | 启动失败显示原因，恢复按钮，不永久停在处理中 |
| U16 | 不同新 agent 的默认访客令牌不同 |
| U17 | 确认删除当前 agent 后切到剩余 agent，保留剩余资料 |
| U18 | 取消删除保留配置 |

## 中继与新版布局用例

设置 `A2A_RELAY_SOURCE` 为独立 [Relay 仓库](https://github.com/huangjuhua-aigc/a2a-relay-server) 的绝对路径，并先在该仓库安装依赖，才能运行全部中继 UI 用例；未设置时明确跳过 4 项中继集成。

- `publication.spec.ts`：4 项真实 Relay / Connector 发布、邀请、调用、关闭与恢复、地址校验、剪贴板回退、离线注册和邀请的未生效提示。
- `visitors.spec.ts`：2 项中文姓名、随机/自定义 Token、默认隐藏与重新生成、重复校验、保存失败重试、折叠保留及手机布局。
- `visitors.test.ts`：CSRF、重复姓名/Token、并发新增、独立内部身份和已有访客权限保持。
- `layout.spec.ts`：6 项桌面/平板/手机布局、键盘焦点、网络模式切换、访客指令折叠和首次使用。
- `collapse.spec.ts`：3 项区块独立折叠、按 Agent 持久化、键盘操作、未保存编辑保留及存储不可用时的回退。
- `ports.test.ts`：3 项本地端口占用、检查后释放和非法端口拒绝。

`U19` 验证无效的局域网地址无法通过跳转步骤绕过保存校验，切换到中继后保留已配置的本地监听端口。地址测试也覆盖 IPv6 和显式 HTTP 默认端口。

完整 UI 套件共 37 项；后端与 CLI 共 24 项，其中 1 项安装集成默认跳过。调用技能另有 6 项测试，包括符合协议的 `GetTask` 直接 Task 响应和 11 位 ID 冲突保护。

`contact-id.test.ts` 验证邀请只使用 Relay 返回的编号，忽略旧本地号码，拒绝无效服务端号码；加载和保存本地 Agent 不再生成 11 位号码。中继 UI 用例校验 `add`/`card`/`send` 使用 Relay ID，并用数字 ID 完成实际技能调用。独立 Relay 的 `contact-numbers.test.mjs` 验证 64 个并发客户端、4 个并发数据库连接、唯一索引、旧库迁移、重复注册、撤销不回收、138/139 边界和号池耗尽；Connector 集成覆盖旧缓存从服务端补号及持久化。

## 报告与排查

### 真实模型整链测试（主动调用模型，会产生费用）

`scripts/real-chain-server.ts`、`real-chain-check.ts`、`real-chain-evidence.ts`、`real-chain-isolation.ts` 和 `record-real-chain.mjs` 用于本机人工触发的真实模型验收。它们创建独立 DSH/Portal 数据目录，沿 Portal 启动、A2A 调用技能、本地 Relay、真实 DeepSeek 和原生 Microsandbox 运行；不使用固定回复。`A2A_REAL_REPORT` 指定证据目录，`A2A_SANDBOX_HOME` 指定准备好的运行时缓存。当前脚本是 Windows 开发环境工具，默认项目路径、模型和端口见脚本，运行前按本机调整。

执行阶段：启动本地 Relay（8787）和 `real-chain-server.ts` → `real-chain-check.ts setup` → `start` → 等中继在线后分别 `connect alice/bob` → `send alice/bob` → 用保存的 task ID 执行 `task alice/bob`。只提交一次请求；响应不确定时不重发。随机校验码保存在测试文件中，不放入请求提示；回复必须包含实际读取到的值。`real-chain-evidence.ts` 提取真实工具事件、原生 VM 状态和挂载配置。`real-chain-isolation.ts` 是可信测试程序，直接在该 VM 中验证 Python 写入边界，不给访客开放执行工具。

停止回归必须验证：本机 owner 才能调用 `prepare-stop`，访客/公网不能调用；未确认写盘时不强杀；正常停止再启动后，沙箱生成文件仍能被真实模型读回。自动化对应 `credentials.test.ts`、`readiness.test.ts`、`stop-agent.test.ts` 和插件 `admin.spec.ts`。

`scripts/preregistration-demo.ts` 在上述本机环境中补充“先注册后启动”的真实验收：`setup` 创建独立 Agent → 在 Portal 获取中继地址并添加小林 → `status` 保存离线分配的地址 → 在页面启动 → `status` 校验同一路径 → `send` 仅提交一次真实读取请求 → `task` 查询并校验随机内容 → `evidence` 检查实际 `read_file` 和原生 VM。在线新增小周后，`auth-before` 验证小林仍可访问、小周 401；页面重启并应用后，`auth-after` 验证两位访客可认证、小周看不到小林任务。脚本不输出访客凭据；使用临时测试目录与本地 Relay，不证明生产公网连通性。

- `playwright-report/index.html`：HTML 用例报告，包括 U01 成功截图与失败附件。
- `test-results/results.json`：机器可读结果。
- `test-results/<用例>/trace.zip`：失败时的浏览器操作、网络与页面记录。
- `pnpm exec playwright test --grep U10`：在 `packages/a2a-host` 目录内重跑某一用例（需已构建前端）。

报告和临时截图已加入 `.gitignore`，不会混入源码提交。2026-10-26 在 Windows / Edge 上，8 项接口与命令行测试、19 项 UI 测试通过；Linux/macOS 尚未实测。
