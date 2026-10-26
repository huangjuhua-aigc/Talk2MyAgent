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
  const [config, setConfig] = useState<WizardConfig>(props.initial)
  const [detectResult, setDetectResult] = useState<DetectResult | undefined>(undefined)
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
  /** When the user set no address, instructions still need a real one: the
   *  detected LAN IP first, loopback last. */
  const fallbackHost = detectResult?.lanIps[0] ?? '127.0.0.1'
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
      {saveError ? <p role="alert" className="field-note">{saveError}</p> : null}
      <div className="steps">
        {STEPS.map((step, index) => (
          <button
            key={step}
            className={`step${index === screen ? ' now' : index <= maxStep ? ' done' : ''}`}
            disabled={index > maxStep || index === screen}
            onClick={() => { setScreen(index) }}
            title={index <= maxStep ? '点击跳转' : undefined}
          >
            {index <= maxStep && index !== screen ? '✓ ' : ''}{index + 1}. {step}
          </button>
        ))}
      </div>
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
          config={config}
          patch={patch}
          onBack={back}
          onNext={next}
          lanIps={detectResult?.lanIps}
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
        />
      )}
      </SaveContext.Provider>
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
    if (!Object.values(result.keys).some(key => key.configured)) {
      steps.push('配置至少一家的 API Key（DeepSeek / OpenAI / 豆包 / 智谱 / Kimi / 阶跃任选）：在 ~/.dsh/.credentials.yaml 里写入对应一行的键与值（如 DEEPSEEK_API_KEY: sk-…）；没有可用的 key 就停下来向我要，不要自己编。')
    }
    if (steps.length === 0) return ''
    const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
    return `请帮我安装并配置「Talk2MyAgent」在线 agent 的运行环境，要求如下：\n${numbered}\n全部完成后把每步的结果告诉我。`
  }

  const missing = result !== undefined
    && (!result.node.ok || !result.dsh.installed || !Object.values(result.keys).some(key => key.configured))

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
  const rawUrl = derivedPublicUrl(props.config.network, props.fallbackHost)
    ?? `http://127.0.0.1:${props.config.network.port}/a2a`
  const hasPlaceholder = props.config.network.host === undefined
  const update = (index: number, name: string, token: string, trusted: boolean): void => {
    const next = peers.map((peer, i) => i === index ? { name, token, trusted } : peer)
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
          <div className="row">
            <input
              type="text"
              style={{ maxWidth: 160 }}
              value={peer.name}
              placeholder="访客名（字母数字）"
              onChange={event => update(index, event.target.value, peer.token, peer.trusted)}
            />
            <input
              className="grow mono"
              type="text"
              value={peer.token}
              onChange={event => update(index, peer.name, event.target.value, peer.trusted)}
            />
            <button className="quiet" onClick={() => update(index, peer.name, newToken(), peer.trusted)}>换一枚</button>
            {peers.length > 1 ? (
              <button className="quiet" onClick={() => props.patch({ peers: peers.filter((_, i) => i !== index) })}>移除</button>
            ) : null}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={peer.trusted}
              onChange={event => update(index, peer.name, peer.token, event.target.checked)}
            />
            <span>允许对话和读取指定工作目录；不勾选则禁止访问。暂不开放写文件、执行命令等其他工具。</span>
          </label>
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
          <pre className="code" style={{ marginTop: 8 }}>{messageFor(peer)}</pre>
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
        <strong>目录结构</strong>（根目录中的资料供获准访客读取；运行目录按访客区分）：
        <pre className="code" style={{ margin: '6px 0' }}>{`<根目录>/
├── zhangsan/   ← 访客 zhangsan 的 agent 在这里干活（cwd）
├── lisi/       ← 访客 lisi 的 agent 在这里干活
└── docs/…      ← 直接放在根目录下的文件 = 公共只读区（共享资料、说明）`}</pre>
        当前只开放<strong>读取文本文件和查看目录</strong>，不能读取所选目录以外的文件；写入、命令等工具以后逐步开放。
        访客之间的会话单独保存，系统会话存储不会通过文件读取开放。请将允许分享的资料放在这个工作目录中。
      </div>
      <Nav onBack={props.onBack} onNext={props.onNext} nextDisabled={isolation.workspaceRoot.length === 0} />
    </div>
  )
}

function NetworkScreen(props: {
  config: WizardConfig
  patch: (part: Partial<WizardConfig>) => void
  onBack: () => void
  onNext: () => void
  lanIps?: string[] | undefined
}): React.JSX.Element {
  const { network } = props.config
  const [showGuide, setShowGuide] = useState(false)
  const derived = derivedPublicUrl(network)
  const invalidAddress = network.mode === 'custom' && derived === undefined
  const invalidPort = !Number.isInteger(network.port) || network.port < 1 || network.port > 65535
  const useLan = (ip: string): void => {
    props.patch({ network: { ...network, mode: 'lan', host: ip } })
  }
  return (
    <div className="card">
      <h2>网络</h2>
      <p className="hint">访客从哪里进来。先定地址，下一屏发给访客的指令里就会带上真实地址。</p>
      <label className="check">
        <input
          type="radio"
          name="network-mode"
          checked={network.mode === 'lan'}
          onChange={() => {
            const first = props.lanIps?.[0]
            props.patch({
              network: {
                ...network,
                mode: 'lan',
                ...(network.mode !== 'lan' && first !== undefined ? { host: first } : {}),
              },
            })
          }}
        />
        <span>局域网地址（自动检测本机 IP）</span>
      </label>
      {network.mode === 'lan' ? (
        <div className="callout">
          {props.lanIps === undefined ? (
            <span className="muted">检测中…</span>
          ) : props.lanIps.length === 0 ? (
            <span>没检测到局域网地址——确认电脑已连上路由器/网络，或改用自定义地址。</span>
          ) : (
            <div className="row">
              <span>检测到本机地址：</span>
              {props.lanIps.map(ip => (
                <button
                  key={ip}
                  className={network.host === ip ? 'primary' : undefined}
                  onClick={() => { useLan(ip) }}
                >
                  {ip}
                </button>
              ))}
              <span className="small muted">多网卡时点击选用</span>
            </div>
          )}
          <p className="field-note" style={{ marginTop: 6 }}>
            注意是裸 HTTP，适合同一网段的信任环境；启动时会自动带 --host 绑定所选地址。
          </p>
        </div>
      ) : null}
      <label className="check">
        <input
          type="radio"
          name="network-mode"
          checked={network.mode === 'custom'}
          onChange={() => props.patch({ network: { ...network, mode: 'custom' } })}
        />
        <span>
          自定义地址（tailscale、公网域名等）
          <button className="quiet" style={{ marginLeft: 8 }} onClick={() => { setShowGuide(value => !value) }}>
            {showGuide ? '收起配置指南' : '怎么配置？'}
          </button>
        </span>
      </label>
      {network.mode === 'custom' ? (
        <>
          <label className="field">
            <span>对外地址（tailscale IP、裸域名，或以 https:// 开头的完整域名）</span>
            <input
              type="text"
              className="mono"
              placeholder="100.101.102.103 或 a2a.example.com 或 https://a2a.example.com"
              value={network.host ?? ''}
              onChange={event => props.patch({
                network: { ...network, host: event.target.value.length > 0 ? event.target.value : undefined },
              })}
            />
          </label>
          {showGuide ? (
            <div className="callout">
              <p style={{ margin: '0 0 6px' }}><strong>跨网络访问：</strong></p>
              <p style={{ margin: '0 0 4px' }}>
                <strong>Tailscale Serve（推荐）</strong>：两端安装 Tailscale，加入同一网络或共享设备；
                按教程只转发 A2A 和名片路径，把得到的完整 HTTPS 地址填到上面，本地端口保持与转发目标一致。
                保存后重启 agent。<a href="https://github.com/huangjuhua-aigc/Talk2MyAgent/blob/main/docs/tailscale.md" target="_blank" rel="noreferrer">安装、配置与验证教程 →</a>
              </p>
              <p style={{ margin: 0 }}>
                已有 HTTPS 域名或反向代理也可填写完整地址；代理只开放 A2A 和名片路径。
                Portal 的 17890 端口用于本机管理，不需要转发。
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      <label className="field">
        <span>端口（dsh web 服务监听端口）</span>
        <input
          type="number"
          min={1}
          max={65535}
          value={network.port}
          onChange={event => props.patch({ network: { ...network, port: Number(event.target.value) || 3080 } })}
        />
      </label>
      {derived !== undefined ? (
        <p className="field-note">访客将使用：<span className="mono">{derived}</span></p>
      ) : (
        <p className="field-note">还没定地址——下一屏发给访客的指令里地址会是占位符。</p>
      )}
      {invalidAddress ? <p role="alert" className="field-note">请填写有效的对外地址，不含用户名、密码、查询参数或片段。</p> : null}
      {invalidPort ? <p role="alert" className="field-note">端口必须是 1 到 65535 之间的整数。</p> : null}
      <Nav onBack={props.onBack} onNext={props.onNext} nextDisabled={invalidAddress || invalidPort} />
    </div>
  )
}

/** The credential reference a visitor's token is stored under, on their side. */
const envRefFor = (peer: string): string =>
  `A2A_PEER_${peer.toUpperCase().replace(/-/g, '_')}`

/**
 * A self-contained instruction the visitor pastes straight to THEIR agent,
 * which then wires up the access (env var + contacts entry + verification).
 */
function visitorInstruction(config: WizardConfig, peer: PeerEntry, fallbackHost?: string): string {
  const rawUrl = derivedPublicUrl(config.network, fallbackHost) ?? `http://127.0.0.1:${config.network.port}/a2a`
  return [
    `请帮我接入一个 A2A 在线 agent（装一次调用技能，之后随时可用），信息如下：`,
    `- 名字：${config.card.name}`,
    `- 服务地址：${rawUrl}`,
    `- Bearer 令牌：${peer.token}`,
    ``,
    `步骤：`,
    `1. 安装 a2a 调用技能（一次性）：`,
    `   git clone --depth 1 https://github.com/huangjuhua-aigc/Talk2MyAgent 到临时目录，`,
    `   把其中的 packages/a2a-skill 整个复制到 ~/.agents/skills/a2a（已存在则覆盖），然后删除临时目录。`,
    `2. 把令牌保存为环境变量 ${envRefFor(peer.name)}=${peer.token}`,
    `   （写入 shell 配置或凭据管理；不要写进会进模型上下文的文件）。`,
    `3. 写入通讯录（CLI 路径：node ~/.agents/skills/a2a/bin/a2a.mjs）：`,
    `   node ~/.agents/skills/a2a/bin/a2a.mjs add ${peer.name} ${rawUrl} ${envRefFor(peer.name)} "${config.card.name}"`,
    `4. 验证连通：`,
    `   node ~/.agents/skills/a2a/bin/a2a.mjs send ${peer.name} "你好"`,
    `   收到回复即接入成功；之后对我说"用 a2a 向 ${peer.name} …"就能随时联系。`,
    `完成后把验证结果告诉我。`,
  ].join('\n')
}

/** One visitor's copyable instruction block. */
function VisitorInstructionBlock(props: { config: WizardConfig; peer: PeerEntry; fallbackHost?: string | undefined }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = visitorInstruction(props.config, props.peer, props.fallbackHost)
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const config = props.config

  useEffect(() => {
    if (phase !== 'started' || savedId === undefined) return
    const timer = setInterval(() => { void api.status(savedId).then(status => setLogs(status.logs)) }, 2000)
    return () => { clearInterval(timer) }
  }, [phase, savedId])

  const save = async (): Promise<void> => {
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
    setError(undefined)
    try {
      const result = await api.start(savedId)
      setManual(result.manual)
      setPhase('started')
    } catch (error) { setError(`启动失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  const active = config.models[config.activeModelIndex] ?? config.models[0]
  const provider = active !== undefined ? (PROVIDERS[active.provider] ?? PROVIDERS.deepseek) : undefined
  const url = derivedPublicUrl(config.network, props.fallbackHost) ?? `http://127.0.0.1:${config.network.port}/a2a`
  const trusted = config.peers.filter(peer => peer.trusted).length

  return (
    <div className="card">
      <h2>{props.agentId === undefined ? '确认并启动' : '确认修改'}</h2>
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
        <button className={saved ? 'primary' : undefined} disabled={busy} onClick={() => { void save() }}>
          {saved ? '已保存 ✓' : '保存'}
        </button>
        {phase !== 'started' ? (
          <button className="primary" disabled={busy || savedId === undefined} onClick={() => { void start() }}>启动</button>
        ) : null}
        <span className="grow" />
        {phase === 'started' && savedId !== undefined ? <button className="primary" onClick={() => props.onLive(savedId)}>进入控制台 →</button> : null}
      </div>

      {error ? <p role="alert" className="field-note">{error}</p> : null}

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
