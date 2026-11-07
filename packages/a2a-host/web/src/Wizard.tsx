/**
 * The seven-screen setup wizard.
 *
 * @module a2a-host/web/Wizard
 */

import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, newToken } from './api.ts'
import type { DetectResult, PeerEntry, WizardConfig } from '../../src/types.ts'
import { PROVIDERS } from '../../src/providers.ts'
import { previewPublicUrl as derivedPublicUrl } from '../../src/url.ts'
import { visitorInstruction } from '../../src/invitation.ts'
import { relayHostIssue } from './relayForm.ts'
import { formatLocalAddress, parseLocalAddress } from './localAddress.ts'
import { StartupNotice } from './StartupNotice.tsx'
import { isContactId } from '../../src/contact-id.ts'
import type { PublicationStatus } from '@talk2myagent/a2a-connector'

export const DEFAULT_CONFIG: WizardConfig = {
  card: { name: 'my-agent', description: '能读代码、查资料、跑任务的在线 agent。' },
  models: [{ provider: 'deepseek', model: 'deepseek-flash' }],
  activeModelIndex: 0,
  peers: [{ name: 'friend', token: newToken(), trusted: true }],
  adminToken: newToken(),
  isolation: {
    workspaceRoot: '',
    peerWorkspaces: {},
  },
  network: { mode: 'lan', port: 3080 },
}

const STEPS = ['环境检测', '名片', '模型', '网络', '访客', '工作区', '保存启动']

export function Wizard(props: {
  initial: WizardConfig
  /** Present when EDITING a saved agent; absent when creating a new one. */
  agentId?: string | undefined
  onDone: (agentId?: string) => void
}): React.JSX.Element {
  const [screen, setScreen] = useState(0)
  // Editing an existing agent: every screen is already populated, so every
  // tab is reachable at once. Creating: only the screens reached so far.
  const [maxStep, setMaxStep] = useState(props.agentId !== undefined ? STEPS.length - 1 : 0)
  const [storedConfig, setConfig] = useState<WizardConfig>(props.initial)
  const [detectResult, setDetectResult] = useState<DetectResult | undefined>(undefined)
  const [localAddressDraft, setLocalAddressDraft] = useState<string>()
  const fallbackHost = detectResult?.lanIps[0] ?? '127.0.0.1'
  const localAddress = localAddressDraft ?? formatLocalAddress(storedConfig.network.host ?? fallbackHost, storedConfig.network.port)
  const parsedLocalAddress = parseLocalAddress(localAddress)
  const networkValid = storedConfig.network.mode === 'lan' ? parsedLocalAddress !== undefined
    : storedConfig.network.mode !== 'relay' || isContactId(storedConfig.network.relay?.contactId)
      || !!props.agentId && props.initial.network.mode === 'relay' && storedConfig.network.relay?.contactId === undefined
  const config = storedConfig.network.mode === 'lan' && parsedLocalAddress
    ? { ...storedConfig, network: { ...storedConfig.network, ...parsedLocalAddress } } : storedConfig
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const refreshDetect = (): void => { void api.detect().then(setDetectResult) }
  useEffect(refreshDetect, [])
  const patch = (part: Partial<WizardConfig>): void => {
    setConfig(previous => ({ ...previous, ...part }))
  }
  const back = (): void => { setScreen(value => Math.max(0, value - 1)) }
  const next = (): void => {
    setScreen(value => {
      const target = Math.min(STEPS.length - 1, value + 1)
      setMaxStep(reached => Math.max(reached, target))
      return target
    })
  }

  /** Mid-wizard save for edits: persist without walking to the last screen. */
  const saveable = config.models.some(entry => entry.model.length > 0)
    && networkValid
    && config.isolation.workspaceRoot.length > 0
    && config.peers.length > 0
    && config.peers.every(peer => peer.name.length > 0 && peer.token.length > 0)
  const saveNow = (): void => {
    if (props.agentId === undefined || !saveable) return
    setBusy(true)
    setSaveError(undefined)
    void api.updateAgent(props.agentId, config).then(() => {
      setSaved(true)
      setTimeout(() => { setSaved(false) }, 2500)
    }).catch(error => setSaveError(`保存失败：${String(error)}`)).finally(() => setBusy(false))
  }
  const saveButton = props.agentId !== undefined && screen < STEPS.length - 1 ? (
    <button
      className={saved ? 'primary' : undefined}
      disabled={busy || !saveable}
      onClick={saveNow}
    >
      {saved ? '已保存 ✓' : '保存'}
    </button>
  ) : null

  return (
    <>
      <header className="page-heading">
        <div><span className="eyebrow">AGENT 配置</span><h2>{props.agentId ? '编辑你的 Agent' : '创建你的 Agent'}</h2>
          <p>{props.agentId ? '修改所需设置，保存后重新启动以应用。' : '一步一步设置，完成后即可邀请访客聊天。'}</p></div>
        <div className="wizard-progress"><span>第 {screen + 1} / {STEPS.length} 步</span><progress aria-label="配置进度" value={screen + 1} max={STEPS.length} /></div>
      </header>
      {saveError ? <p role="alert" className="field-note">{saveError}</p> : null}
      <nav className="steps" aria-label="配置步骤">
        {STEPS.map((step, index) => (
          <button
            key={step}
            className={`step${index === screen ? ' now' : index <= maxStep ? ' done' : ''}`}
            disabled={index > maxStep || index === screen}
            onClick={() => { setScreen(index) }}
            title={index <= maxStep ? '点击跳转' : undefined}
            aria-label={`${index + 1}. ${step}`}
            aria-current={index === screen ? 'step' : undefined}
          >
            <span className="step-index" aria-hidden="true">{index + 1}</span><span>{step}</span>
          </button>
        ))}
      </nav>
      <SaveContext.Provider value={saveButton}>
      {screen === 0 && (
        <DetectScreen result={detectResult} refresh={refreshDetect} onDone={next} onRerun={props.onDone} />
      )}
      {screen === 1 && <CardScreen config={config} patch={patch} onBack={back} onNext={next} />}
      {screen === 2 && (
        <ModelScreen
          config={config}
          patch={patch}
          onBack={back}
          onNext={next}
          keys={detectResult?.keys}
        />
      )}
      {screen === 3 && (
        <NetworkScreen
          agentId={props.agentId}
          config={config}
          patch={patch}
          onBack={back}
          onNext={next}
          lanIps={detectResult?.lanIps}
          localAddress={localAddress}
          onLocalAddressChange={setLocalAddressDraft}
        />
      )}
      {screen === 4 && <VisitorsScreen config={config} patch={patch} onBack={back} onNext={next} fallbackHost={fallbackHost} />}
      {screen === 5 && <WorkspaceScreen config={config} patch={patch} onBack={back} onNext={next} />}
      {screen === 6 && (
        <ReviewScreen
          config={config}
          patch={patch}
          agentId={props.agentId}
          onBack={back}
          onLive={props.onDone}
          fallbackHost={fallbackHost}
          keys={detectResult?.keys}
          networkValid={networkValid}
        />
      )}
      </SaveContext.Provider>
      <button className="quiet" onClick={() => props.onDone(props.agentId)}>{props.agentId ? '返回控制台' : '暂不配置，返回首页'}</button>
    </>
  )
}

/** Carries the mid-wizard save button into every screen's Nav row. */
const SaveContext = createContext<React.ReactNode>(null)

function Nav(props: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean }): React.JSX.Element {
  const extra = useContext(SaveContext)
  return (
    <div className="nav">
      {props.onBack === undefined ? <span /> : <button onClick={props.onBack}>← 上一步</button>}
      {extra}
      {props.onNext === undefined ? <span /> : (
        <button className="primary" onClick={props.onNext} disabled={props.nextDisabled}>
          {props.nextLabel ?? '下一步 →'}
        </button>
      )}
    </div>
  )
}

function DetectScreen(props: {
  result: DetectResult | undefined
  refresh: () => void
  onDone: () => void
  onRerun: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [pluginState, setPluginState] = useState<'auto' | 'failed'>('auto')
  const result = props.result

  // The protocol plugin installs itself here, proactively — the user never
  // manages it. Refresh after the attempt so the row reflects reality.
  useEffect(() => {
    if (result?.dsh.installed === true && result.profile.exists && !result.profile.pluginInstalled) {
      void api.ensurePlugin().then(() => { props.refresh() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.profile.pluginInstalled, result?.profile.exists, result?.dsh.installed])

  const pluginRow = (): React.JSX.Element => {
    if (result === undefined || !result.dsh.installed) return <span className="chip">待装 dsh 后自动安装</span>
    if (result.profile.pluginInstalled) return <span className="chip ok">已安装</span>
    if (!result.profile.exists) return <span className="chip">首次启动时自动安装</span>
    return pluginState === 'auto'
      ? <span className="chip">正在自动安装…</span>
      : (
        <span className="row">
          <span className="chip warn">自动安装失败</span>
          <button className="quiet" onClick={() => {
            setPluginState('auto')
            void api.ensurePlugin().then(() => { setPluginState('failed'); props.refresh() })
          }}>重试</button>
        </span>
      )
  }

  /**
   * A self-contained instruction assembled ONLY from what detection found
   * missing: an installed item never appears in it, and numbering restarts
   * per combination.
   */
  const agentInstruction = (): string => {
    if (result === undefined) return ''
    const steps: string[] = []
    if (!result.node.ok) {
      steps.push(`升级 Node.js 到 22 或更高（当前是 ${result.node.version}）：从 nodejs.org 下载 LTS 安装包升级，node -v 确认。`)
    }
    if (!result.dsh.installed) {
      steps.push('安装 DeepSeek Harness CLI：npm install -g @deepseek-ai/dsh，装完运行 dsh --version 确认能输出版本号。')
    }
    if (result.sandbox.automatic && !result.sandbox.supported) {
      steps.push(result.sandbox.reason ?? '请使用支持本地沙箱的系统。')
    }
    if (!Object.values(result.keys).some(key => key.configured)) {
      steps.push('配置至少一家的 API Key（DeepSeek / OpenAI / 豆包 / 智谱 / Kimi / 阶跃任选）：在 ~/.dsh/.credentials.yaml 里写入对应一行的键与值（如 DEEPSEEK_API_KEY: sk-…）；没有可用的 key 就停下来向我要，不要自己编。')
    }
    if (steps.length === 0) return ''
    const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
    return `请帮我安装并配置「Talk2MyAgent」在线 agent 的运行环境，要求如下：\n${numbered}\n全部完成后把每步的结果告诉我。`
  }

  const missing = result !== undefined
    && (!result.node.ok || !result.dsh.installed || (result.sandbox.automatic && !result.sandbox.supported) || !Object.values(result.keys).some(key => key.configured))

  const chip = (ok: boolean, okText: string, badText: string): React.JSX.Element => (
    <span className={`chip ${ok ? 'ok' : 'warn'}`}>{ok ? okText : badText}</span>
  )
  return (
    <div className="card">
      <h2>环境检测</h2>
      <p className="hint">缺项不用自己装——把安装指令发给你的 Agent（Claude Code / ZCode 等）代装，装完后回到这一屏点「重新检测」。</p>
      {result === undefined ? <p className="muted">检测中…</p> : (
        <div>
          <div className="row">
            <span className="grow">Node.js ≥ 22</span>
            {chip(result.node.ok, result.node.version, `当前 ${result.node.version}，需升级`)}
          </div>
          <div className="row">
            <span className="grow">dsh 运行时</span>
            {chip(result.dsh.installed, result.dsh.version ?? '已安装', '未安装')}
          </div>
          <div className="row">
            <span className="grow">访客独立沙箱</span>
            {result.sandbox.automatic
              ? chip(result.sandbox.supported, '启动时自动准备', result.sandbox.reason ?? '当前系统暂不支持')
              : <span className="chip">已关闭，使用受限只读工具</span>}
          </div>
          <div className="row">
            <span className="grow">API Key（任选一家）</span>
            {chip(
              Object.values(result.keys).some(key => key.configured),
              Object.entries(result.keys).filter(([, key]) => key.configured).map(([ref]) => ref.replace(/_API_KEY$/, '')).join('、') || '已配置',
              '未配置',
            )}
          </div>
          <div className="row">
            <span className="grow">dsh profile「a2a」</span>
            {chip(result.profile.exists, '已存在', '首次配置时自动创建')}
          </div>
          <div className="row">
            <span className="grow">协议插件 dsh-a2a-server</span>
            {pluginRow()}
          </div>
          {missing ? (
            <div className="callout" style={{ marginTop: 12 }}>
              <div className="row">
                <span className="grow small">
                  把下面的指令整段发给你的 Agent 去装{copied ? '（已复制 ✓）' : ''}，装完回来点「重新检测」。指令只包含上面检测到的缺项。
                </span>
                <button className="primary" onClick={() => {
                  void navigator.clipboard.writeText(agentInstruction()).then(() => {
                    setCopied(true)
                    setTimeout(() => { setCopied(false) }, 2500)
                  })
                }}>复制安装指令（发给你的 Agent）</button>
              </div>
              <pre className="code" style={{ marginTop: 10 }}>{agentInstruction()}</pre>
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="quiet" onClick={props.refresh}>重新检测</button>
            <span className="grow" />
            <button className="primary" onClick={props.onDone} disabled={!result.dsh.installed}>继续 →</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CardScreen(props: {
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const { card } = props.config
  return (
    <div className="card">
      <h2>名片</h2>
      <p className="hint">访客发现你时看到的就是这些（Agent Card）。</p>
      <label className="field">
        <span>名字</span>
        <input type="text" value={card.name} onChange={event => props.patch({ card: { ...card, name: event.target.value } })} />
      </label>
      <label className="field">
        <span>描述</span>
        <textarea value={card.description} onChange={event => props.patch({ card: { ...card, description: event.target.value } })} />
      </label>
      <div className="callout">
        预览：<strong>{card.name || '（未命名）'}</strong> — {card.description || '（无描述）'}
      </div>
      <Nav onBack={props.onBack} onNext={props.onNext} nextDisabled={card.name.length === 0} />
    </div>
  )
}

function ModelScreen(props: {
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
  keys?: Record<string, { configured: boolean; source?: string; masked?: string; value?: string }> | undefined
}): React.JSX.Element {
  const { models, activeModelIndex } = props.config
  const setEntry = (index: number, part: Partial<WizardConfig['models'][number]>): void => {
    props.patch({ models: models.map((entry, i) => i === index ? { ...entry, ...part } : entry) })
  }
  return (
    <div className="card">
      <h2>模型</h2>
      <p className="hint">在线 agent 的大脑。可配置多个模型，启用其中一个；对话会调用启用模型所属家的 API。</p>
      {models.map((entry, index) => {
        // Any historical provider spelling falls back to DeepSeek rather than crashing.
        const info = PROVIDERS[entry.provider] ?? PROVIDERS.deepseek
        const status = props.keys?.[info.keyRef]
        const suggestions = info.models.map(model => typeof model === 'string' ? { id: model, label: model } : model)
        const inList = suggestions.some(model => model.id === entry.model)
        return (
          <div className="visitor" key={index}>
            <div className="row">
              <label className="check" style={{ margin: 0 }} title="设为启用">
                <input
                  type="radio"
                  name="active-model"
                  checked={index === activeModelIndex}
                  onChange={() => props.patch({ activeModelIndex: index })}
                />
                <span>{index === activeModelIndex ? '启用中' : '启用'}</span>
              </label>
              <select
                value={entry.provider}
                onChange={event => {
                  const provider = event.target.value as WizardConfig['models'][number]['provider']
                  const first = PROVIDERS[provider].models[0]
                  setEntry(index, { provider, model: typeof first === 'string' ? first : first?.id ?? '', apiKey: undefined })
                }}
              >
                {Object.entries(PROVIDERS).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
              {inList ? (
                <select
                  className="grow mono"
                  value={entry.model}
                  onChange={event => { setEntry(index, { model: event.target.value === '__custom' ? '' : event.target.value }) }}
                >
                  {suggestions.map(model => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                  <option value="__custom">自定义…（手输型号）</option>
                </select>
              ) : (
                <div className="row grow">
                  <input
                    className="grow mono"
                    type="text"
                    value={entry.model}
                    placeholder="输入模型 id（各家最新型号）"
                    onChange={event => setEntry(index, { model: event.target.value })}
                  />
                  <button
                    className="quiet"
                    title="回到清单选择"
                    onClick={() => { setEntry(index, { model: suggestions[0]?.id ?? '' }) }}
                  >
                    ▾
                  </button>
                </div>
              )}
              {models.length > 1 ? (
                <button className="quiet" onClick={() => {
                  const next = models.filter((_, i) => i !== index)
                  props.patch({
                    models: next,
                    activeModelIndex: Math.min(activeModelIndex, next.length - 1),
                  })
                }}>移除</button>
              ) : null}
            </div>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>API Key（{info.keyRef}）</span>
              <input
                type="text"
                className="key-input mono"
                value={entry.apiKey ?? (status?.configured === true ? status.value : '')}
                placeholder={status?.configured === true ? '留空沿用现有 Key；编辑则覆盖' : '粘贴 API Key'}
                onChange={event => setEntry(index, {
                  apiKey: event.target.value.length > 0 ? event.target.value : undefined,
                })}
              />
              <span className="field-note">
                {status?.configured === true
                  ? `已检测到现有配置（来自 ${status.source}）：${status.value ?? status.masked}，留空即沿用。`
                  : '尚未检测到这家的 Key，粘贴后写入。'}
                保存位置：~/.dsh/.credentials.yaml 的 {info.keyRef}，不进配置文件。
              </span>
            </label>
          </div>
        )
      })}
      <div className="row">
        <button onClick={() => {
          const first = PROVIDERS.deepseek.models[0]
          props.patch({ models: [...models, { provider: 'deepseek', model: typeof first === 'string' ? first : first?.id ?? '' }] })
        }}>
          + 添加模型
        </button>
      </div>
      <Nav
        onBack={props.onBack}
        onNext={props.onNext}
        nextDisabled={models.length === 0 || models.some(entry => entry.model.length === 0)}
      />
    </div>
  )
}

function VisitorsScreen(props: {
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
  fallbackHost?: string | undefined
}): React.JSX.Element {
  const { peers } = props.config
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [failedIndex, setFailedIndex] = useState<number | null>(null)
  const rawUrl = props.config.network.mode === 'relay' ? '保存后在控制台获取固定地址' : derivedPublicUrl(props.config.network, props.fallbackHost)
    ?? `http://127.0.0.1:${props.config.network.port}/a2a`
  const relay = props.config.network.mode === 'relay'
  const hasPlaceholder = !relay && props.config.network.host === undefined
  const update = (index: number, name: string, token: string, trusted: boolean): void => {
    const next = peers.map((peer, i) => i === index ? { ...peer, name, token, trusted } : peer)
    props.patch({ peers: next })
  }
  /**
   * A self-contained instruction the visitor pastes straight to THEIR agent,
   * which then wires up the access (env var + contacts entry + verification).
   */
  const messageFor = (peer: PeerEntry): string => visitorInstruction(props.config, peer, props.fallbackHost)
  const copy = (index: number, text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedIndex(index)
        setFailedIndex(null)
        setTimeout(() => { setCopiedIndex(null) }, 2500)
      },
      () => {
        // Clipboard denied: fall back to showing the text for manual selection.
        setFailedIndex(index)
      },
    )
  }
  return (
    <div className="card">
      <h2>访客</h2>
      <p className="hint">每位访客一个身份和一枚独立令牌；泄露哪枚只影响哪一位，可随时轮换。任务权限按访客单独授予。</p>
      {peers.map((peer, index) => (
        <div className="visitor" key={index}>
          <div className="visitor-fields">
            <label className="field"><span>访客名</span>
            <input
              type="text"
              value={peer.displayName ?? peer.name}
              placeholder={peer.displayName === undefined ? '访客名（字母数字）' : '访客姓名'}
              onChange={event => {
                if (peer.displayName === undefined) update(index, event.target.value, peer.token, peer.trusted)
                else props.patch({ peers: peers.map((p, i) => i === index ? { ...p, displayName: event.target.value } : p) })
              }}
            />
            </label>
            <label className="field"><span>访客令牌</span>
            <input
              className="mono"
              type="text"
              spellCheck={false}
              value={peer.token}
              onChange={event => update(index, peer.name, event.target.value, peer.trusted)}
            />
            </label>
            <div className="row">
            <button className="quiet" onClick={() => update(index, peer.name, newToken(), peer.trusted)}>换一枚</button>
            {peers.length > 1 ? (
              <button className="quiet" onClick={() => props.patch({ peers: peers.filter((_, i) => i !== index) })}>移除</button>
            ) : null}
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={peer.trusted}
              onChange={event => update(index, peer.name, peer.token, event.target.checked)}
            />
            <span>允许对话和读取指定工作目录；不勾选则禁止访问。暂不开放写文件、执行命令等其他工具。</span>
          </label>
          {relay ? <p className="field-note">保存后进入控制台，可先获取固定地址并准备聊天邀请；启动 Agent 后，访客即可连接。</p> : <details>
          <summary>查看与复制访客配置指令</summary>
          <div className="row">
            <button
              className={copiedIndex === index ? 'primary' : undefined}
              onClick={() => { copy(index, messageFor(peer)) }}
            >
              {copiedIndex === index ? '已复制 ✓' : '复制配置指令'}
            </button>
            {failedIndex === index ? (
              <span className="small" style={{ color: 'var(--bad)' }}>自动复制被浏览器拒绝，请手动选中下方文本复制</span>
            ) : null}
          </div>
          <pre className="code invitation-preview" style={{ marginTop: 8 }}>{messageFor(peer)}</pre>
          </details>}
        </div>
      ))}
      <div className="row">
        <button onClick={() => props.patch({ peers: [...peers, { name: `visitor-${peers.length + 1}`, token: newToken(), trusted: false }] })}>
          + 添加访客
        </button>
      </div>
      {hasPlaceholder ? (
        <p className="field-note">地址来自自动检测（{rawUrl}）；如需固定对外地址，到「网络」一屏填写。</p>
      ) : null}
      <Nav
        onBack={props.onBack}
        onNext={props.onNext}
        nextDisabled={peers.length === 0 || peers.some(peer => peer.name.length === 0 || peer.token.length < 16)}
      />
    </div>
  )
}

function WorkspaceScreen(props: {
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const { isolation } = props.config
  return (
    <div className="card">
      <h2>工作区</h2>
      <p className="hint">选择 agent 可以读取的本地资料目录。获准访客可以让它查询这里的文件，开场简报仍会自动注入。</p>
      <PathField
        label="工作目录（允许读取的资料目录，绝对路径）"
        value={isolation.workspaceRoot}
        placeholder="点击右侧在资源管理器中选择，或直接输入"
        onChange={path => props.patch({ isolation: { ...isolation, workspaceRoot: path } })}
      />
      <div className="callout">
        <strong>公共资料与私有工作区分开存放</strong>：
        <pre className="code" style={{ margin: '6px 0' }}>{`所选资料目录 → 沙箱内 /source（只读副本）

zhangsan 的沙箱 → /work（独立持久化磁盘）
lisi 的沙箱    → /work（另一块独立持久化磁盘）`}</pre>
        <p className="field-note">私有文件保存在本机虚拟磁盘中，停止沙箱后仍会保留；不会同步回旧的访客文件夹。</p>
        当前只开放<strong>读取文本文件和查看目录</strong>，范围是公共资料和该访客自己的工作区；写入、命令等工具以后逐步开放。
        每位访客使用独立沙箱，只能读取公共资料，以及读写自己的私有工作区。空闲 30 秒暂停、10 分钟停止，私有文件保留。首次启动自动准备环境；其他访客的数据、聊天记录和凭据不会放入沙箱。
      </div>
      <Nav onBack={props.onBack} onNext={props.onNext} nextDisabled={isolation.workspaceRoot.length === 0} />
    </div>
  )
}

function NetworkScreen(props: {
  agentId?: string | undefined
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
  lanIps?: string[] | undefined
  localAddress: string
  onLocalAddressChange: (value: string | undefined) => void
}): React.JSX.Element {
  const { network } = props.config
  const [defaultHost, setDefaultHost] = useState<string>()
  const [sessionError, setSessionError] = useState('')
  const [publication, setPublication] = useState<PublicationStatus>()
  useEffect(() => {
    let canceled = false
    if (props.agentId) void api.publication(props.agentId).then(result => { if (!canceled) setPublication(result) }).catch(() => {})
    return () => { canceled = true }
  }, [props.agentId])
  useEffect(() => {
    let canceled = false
    void api.session().then(result => { if (!canceled) setDefaultHost(result.defaultRelayHost) })
      .catch(() => { if (!canceled) setSessionError('默认服务暂时无法读取，可以填写自定义 Relay。') })
    return () => { canceled = true }
  }, [])
  const provider = network.relay?.provider ?? 'default'
  const relayIssue = provider === 'custom' ? relayHostIssue(network.relay?.host ?? '') : undefined
  const origin = (provider === 'custom' ? network.relay?.host?.trim() : defaultHost)?.replace(/\/$/, '')
  const fixedNumber = publication?.relayOrigin === origin && isContactId(publication?.contactId) ? publication.contactId : undefined
  const numberInvalid = !fixedNumber && !isContactId(network.relay?.contactId)
  const invalidAddress = network.mode === 'lan' && !parseLocalAddress(props.localAddress)
  const derived = invalidAddress ? undefined : derivedPublicUrl(network)
  const invalidRelay = network.mode === 'relay' && (numberInvalid || (provider === 'custom' ? !!relayIssue : !defaultHost))
  const choose = (mode: WizardConfig['network']['mode']): void => {
    props.onLocalAddressChange(undefined)
    const nextNetwork = { ...network, mode,
      ...(mode === 'lan' && network.mode !== 'lan' ? { host: props.lanIps?.[0] ?? '127.0.0.1' } : {}),
      ...(mode === 'relay' ? { relay: network.relay ?? { provider: 'default', enabled: true } } : {}),
    }
    delete nextNetwork.bindHost
    delete nextNetwork.publicUrl
    props.patch({ network: nextNetwork })
  }
  return (
    <section className="card" aria-label="网络设置">
      <h2>访客如何连接你的 Agent？</h2>
      <p className="hint">跨网络访问选择公网中继；同一局域网内可以直接连接。</p>
      <fieldset className="network-choices">
        <legend className="sr-only">连接方式</legend>
        <label className={`network-choice ${network.mode === 'relay' ? 'selected' : ''}`}>
          <input type="radio" name="network-mode" aria-label="公网中继（自动注册，后台连接）" checked={network.mode === 'relay'} onChange={() => choose('relay')} />
          <span><strong>公网中继</strong><small>自动注册地址，适合跨网络访问</small></span>
        </label>
        <label className={`network-choice ${network.mode === 'lan' ? 'selected' : ''}`}>
          <input type="radio" name="network-mode" aria-label="局域网地址（自动检测本机 IP）" checked={network.mode === 'lan'} onChange={() => choose('lan')} />
          <span><strong>局域网</strong><small>适合同一路由器下的设备</small></span>
        </label>
      </fieldset>
      {network.mode === 'relay' ? (
        <div className="network-panel">
          <label className="field"><span>Relay 服务</span>
            <select value={provider} onChange={e => props.patch({ network: { ...network, relay: { ...network.relay, provider: e.target.value as 'default' | 'custom', enabled: true } } })}>
              <option value="default">默认 Relay{defaultHost === undefined ? '（读取中）' : defaultHost ? ` · ${defaultHost}` : '（尚未提供）'}</option>
              <option value="custom">自定义 Relay host</option>
            </select>
          </label>
          {provider === 'custom' ? (
            <label className="field"><span>Relay host</span>
              <input type="text" className="relay-host-input" aria-label="Relay host" aria-describedby="wizard-relay-help" aria-invalid={!!network.relay?.host && !!relayIssue}
                autoComplete="url" spellCheck={false} placeholder="https://relay.example.com" value={network.relay?.host ?? ''}
                onChange={e => props.patch({ network: { ...network, relay: { ...network.relay, provider: 'custom', host: e.target.value, enabled: true } } })} />
              <span className="field-note" id="wizard-relay-help">填写 Relay 服务地址；如需指定端口，写在这里，例如 https://relay.example.com:8443。Agent 的访问地址会自动生成。</span>
            </label>
          ) : sessionError || defaultHost === '' ? (
            <p className="field-note">{sessionError || '还没有默认服务，请选择自定义 Relay host。'}</p>
          ) : null}
          {provider === 'custom' && network.relay?.host && relayIssue ? <p role="alert">{relayIssue}</p> : null}
          <label className="field"><span>手机号（公开编号）</span>
            <input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={11} placeholder="13812345678" aria-label="手机号（公开编号）"
              aria-describedby="wizard-number-help" aria-invalid={!fixedNumber&&!!network.relay?.contactId&&numberInvalid}
              value={fixedNumber ?? network.relay?.contactId ?? ''} readOnly={!!fixedNumber}
              onChange={e => props.patch({ network: { ...network, relay: { ...network.relay, provider, enabled: true, contactId: e.target.value.trim() } } })}/>
            <span id="wizard-number-help" className="field-note">{fixedNumber?'已登记，编号固定；关闭发布仍会保留。':'填写自己的 11 位手机号，用作公开 Agent 编号。暂不验证号码归属；重号时注册会被拒绝。'}</span>
          </label>
          {!fixedNumber&&network.relay?.contactId&&numberInvalid?<p role="alert">请填写有效的 11 位手机号。</p>:null}
          {!numberInvalid&&origin?<p className="field-note">{fixedNumber?'已登记编号':'注册成功后地址'}：<span className="mono">{origin}/r/{fixedNumber ?? network.relay?.contactId}/a2a</span>{fixedNumber?'':'（尚未注册）'}</p>:null}
          <div className="connection-result">保存并启动 Agent 后自动连接。在控制台查看访问地址，复制完整聊天邀请。</div>
        </div>
      ) : null}
      {network.mode === 'lan' ? (
        <div className="network-panel">
          <h3>选择本机地址</h3>
          {props.lanIps === undefined ? <p className="muted">正在检测本机网络…</p> : props.lanIps.length === 0 ? (
            <p className="muted">未检测到局域网地址，请确认已连接网络，或选择其他连接方式。</p>
          ) : <div className="row">{props.lanIps.map(ip => <button key={ip} className={network.host === ip && !invalidAddress ? 'primary mono' : 'mono'}
            aria-pressed={network.host === ip && !invalidAddress} onClick={() => props.onLocalAddressChange(formatLocalAddress(ip, network.port))}>{formatLocalAddress(ip, network.port)}</button>)}</div>}
          <label className="field"><span>本机地址（IP:端口）</span>
            <input type="text" className="mono" spellCheck={false} autoComplete="off" placeholder="192.168.1.10:3080"
              aria-invalid={invalidAddress} aria-describedby="local-address-help" value={props.localAddress}
              onChange={event => props.onLocalAddressChange(event.target.value)} />
            <span className="field-note" id="local-address-help">端口直接写在地址后面，例如 192.168.1.10:3080；仅在本机访问可填 127.0.0.1:3080。</span>
          </label>
          {invalidAddress ? <p role="alert">请填写有效的本机 IP 和端口（1–65535），例如 192.168.1.10:3080。</p> : null}
          <p className="field-note">访客需要连接同一个局域网。存在多张网卡时，选择访客能访问的 IP。</p>
        </div>
      ) : null}
      {network.mode === 'custom' ? (
        <p className="field-note">当前保留已保存的旧版直连配置。若要更换连接方式，请选择公网中继或局域网。</p>
      ) : null}
      {derived ? <div className="connection-result">访客将使用：<span className="mono">{derived}</span></div> : null}
      <Nav onBack={props.onBack} onNext={props.onNext} nextDisabled={invalidAddress || invalidRelay} />
    </section>
  )
}

/** One visitor's copyable instruction block. */
function VisitorInstructionBlock(props: { config: WizardConfig; peer: PeerEntry; fallbackHost?: string | undefined }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = visitorInstruction(props.config, props.peer, props.fallbackHost)
  if (props.config.network.mode === 'relay') return <p className="field-note">{text}</p>
  return (
    <div className="visitor">
      <div className="row" style={{ marginBottom: 6 }}>
        <strong>{props.peer.name}</strong>
        <span className="grow" />
        <button
          className={copied ? 'primary' : undefined}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => { setCopied(false) }, 2500)
            })
          }}
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <pre className="code">{text}</pre>
    </div>
  )
}

/** A path input with a 📁 button that opens the system folder dialog. */
function PathField(props: {
  label: string
  value: string
  placeholder?: string
  onChange: (path: string) => void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  return (
    <label className="field">
      <span>{props.label}</span>
      <div className="row">
        <input
          className="grow mono"
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          onChange={event => props.onChange(event.target.value)}
        />
        <button
          className="pick"
          disabled={picking}
          title="在系统资源管理器中选择"
          onClick={() => {
            setPicking(true)
            void api.pickDirectory().then(result => {
              if (result.ok) props.onChange(result.path)
              setPicking(false)
            })
          }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="M1.75 3.5h4l1.5 2h6.75c.41 0 .75.34.75.75v6c0 .41-.34.75-.75.75H2.5a.75.75 0 0 1-.75-.75V3.5z" />
          </svg>
          {picking ? '选择中…' : '浏览'}
        </button>
      </div>
    </label>
  )
}

/** One summary row for the final screen: label left, value right. */
function SummaryRow(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="row" style={{ margin: '6px 0' }}>
      <span className="muted" style={{ width: 88, flex: 'none' }}>{props.label}</span>
      <span className="grow">{props.children}</span>
    </div>
  )
}

function ReviewScreen(props: {
  config: WizardConfig
  networkValid: boolean
  patch: (part: Partial<WizardConfig>) => void
  agentId?: string | undefined
  onBack: () => void
  onLive: (agentId: string) => void
  fallbackHost?: string | undefined
  keys?: Record<string, { configured: boolean; source?: string; masked?: string; value?: string }> | undefined
}): React.JSX.Element {
  const [savedId, setSavedId] = useState<string | undefined>(props.agentId)
  const [phase, setPhase] = useState<'ready' | 'started'>('ready')
  const [saved, setSaved] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [manual, setManual] = useState<string | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const config = props.config

  useEffect(() => {
    if (phase !== 'started' || savedId === undefined) return
    const timer = setInterval(() => { void api.status(savedId).then(status => setLogs(status.logs)) }, 2000)
    return () => { clearInterval(timer) }
  }, [phase, savedId])

  const save = async (): Promise<void> => {
    if (!props.networkValid) return
    setBusy(true)
    setError(undefined)
    try {
      if (savedId !== undefined) {
        await api.updateAgent(savedId, config)
      } else {
        const result = await api.createAgent(config)
        setSavedId(result.record.id)
      }
      setSaved(true)
      setTimeout(() => { setSaved(false) }, 2500)
    } catch (error) { setError(`保存失败：${String(error)}`) }
    finally { setBusy(false) }
  }
  const start = async (): Promise<void> => {
    if (savedId === undefined) return
    setBusy(true)
    setStarting(true)
    setError(undefined)
    try {
      const result = await api.start(savedId)
      setManual(result.manual)
      setPhase('started')
    } catch (error) { setError(`启动失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false); setStarting(false) }
  }

  const active = config.models[config.activeModelIndex] ?? config.models[0]
  const provider = active !== undefined ? (PROVIDERS[active.provider] ?? PROVIDERS.deepseek) : undefined
  const url = config.network.mode === 'relay' ? '保存后进入控制台获取固定地址，无需先启动' : derivedPublicUrl(config.network, props.fallbackHost) ?? `http://127.0.0.1:${config.network.port}/a2a`
  const trusted = config.peers.filter(peer => peer.trusted).length

  return (
    <div className="card">
      <h2>{props.agentId === undefined ? '确认配置' : '确认修改'}</h2>
      <p className="hint">以下是将生效的全部配置：</p>
      <SummaryRow label="名片"><strong>{config.card.name}</strong>　{config.card.description}</SummaryRow>
      <SummaryRow label="模型">
        {provider?.label ?? '—'}　<span className="mono">{active?.model ?? '—'}</span>
        {config.models.length > 1 ? <span className="chip">另有 {config.models.length - 1} 个备用</span> : null}
        {provider !== undefined ? (
          props.keys?.[provider.keyRef]?.configured === true
            ? <span className="chip mono" title={props.keys[provider.keyRef]?.source}>{props.keys[provider.keyRef]?.value ?? props.keys[provider.keyRef]?.masked}</span>
            : <span className="chip warn">Key 未配置</span>
        ) : null}
      </SummaryRow>
      <SummaryRow label="服务地址"><span className="mono">{url}</span></SummaryRow>
      <SummaryRow label="访客">
        {config.peers.length} 位（{config.peers.map(peer => peer.name).join('、')}），其中 {trusted} 位可对话、读文件
      </SummaryRow>
      <SummaryRow label="工作区"><span className="mono">{config.isolation.workspaceRoot}</span></SummaryRow>

      <div className="row" style={{ marginTop: 16 }}>
        <button className={saved ? 'primary' : undefined} disabled={busy || !props.networkValid} onClick={() => { void save() }}>
          {saved ? '已保存 ✓' : '保存'}
        </button>
        {phase !== 'started' ? (
          <button className="primary" disabled={busy || savedId === undefined} onClick={() => { void start() }}>启动</button>
        ) : null}
        <span className="grow" />
        {savedId !== undefined ? <button className={phase === 'started' ? 'primary' : undefined} disabled={busy} onClick={() => props.onLive(savedId)}>进入控制台 →</button> : null}
      </div>

      {starting && savedId !== undefined ? <StartupNotice agentId={savedId} /> : null}
      {error ? <p role="alert" className="field-note">{error}</p> : null}
      {!props.networkValid ? <p role="alert">请返回「网络」填写有效的本机地址后保存。</p> : null}

      {savedId !== undefined ? (
        <div style={{ marginTop: 16 }}>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            把对应的接入指令发给访客（或直接发给访客的 Agent，它会自动配好）：
          </p>
          {config.peers.map(peer => (
            <VisitorInstructionBlock key={peer.name} config={config} peer={peer} fallbackHost={props.fallbackHost} />
          ))}
        </div>
      ) : null}
      {phase === 'started' ? (
        <>
          <p className="small muted" style={{ marginTop: 12 }}>启动后可用「进入控制台」确认运行状态；完整日志在 ~/.dsh/logs/ 下。</p>
          {manual !== undefined ? <p className="small muted">若自动启动失败，可手动运行：<span className="mono">{manual}</span></p> : null}
        </>
      ) : null}
      <Nav onBack={props.onBack} />
    </div>
  )
}
