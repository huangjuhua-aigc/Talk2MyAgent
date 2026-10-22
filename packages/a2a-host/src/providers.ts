/**
 * The provider table, shared by the CLI's config generation and the UI's
 * dropdowns. Dependency-free on purpose: the web bundle imports it too.
 *
 * Model ids were verified against each provider's docs (2026-10-21) and are
 * the last-half-year lineups; the input stays free-form, so a newer id can be
 * typed the day it ships.
 *
 * @module a2a-host/providers
 */

import type { ProviderKind } from './types.ts'

/** One provider family the wizard can wire. */
export interface ProviderInfo {
  /** Display name — no implementation details surface to the user. */
  label: string
  /** The route name requests select (`provider` on the a2a-server row). */
  route: string
  /** Where this family's API key lives. */
  keyRef: string
  /** Suggested model ids (verified recent lineups; input stays free-form). */
  models: string[]
  /** How dsh reaches this family; absent = the direct DeepSeek adapter. */
  piAi?: {
    /** pi-ai catalog provider name, for families the catalog knows. */
    provider?: string
    /** Wire protocol, for hand-declared OpenAI-compatible gateways. */
    api?: string
    /** Gateway endpoint, for hand-declared routes. */
    baseURL?: string
    displayName?: string
  }
}

/** Map any historical provider spelling onto a current provider kind. */
export function normalizeProvider(value: string | undefined): ProviderKind {
  if (value === 'deepseek-official' || value === 'deepseek') return 'deepseek'
  const kinds = Object.keys(PROVIDERS) as ProviderKind[]
  for (const kind of kinds) {
    if (kind === value || PROVIDERS[kind].route === value) return kind
  }
  return 'deepseek'
}

/** Every family the wizard offers. */
export const PROVIDERS: Record<ProviderKind, ProviderInfo> = {
  deepseek: {
    label: 'DeepSeek',
    route: 'deepseek-official',
    keyRef: 'DEEPSEEK_API_KEY',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  openai: {
    label: 'OpenAI',
    route: 'openai',
    keyRef: 'OPENAI_API_KEY',
    models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'],
    piAi: { provider: 'openai' },
  },
  anthropic: {
    label: 'Anthropic',
    route: 'anthropic',
    keyRef: 'ANTHROPIC_API_KEY',
    models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'],
    piAi: { provider: 'anthropic' },
  },
  doubao: {
    label: '豆包（火山方舟）',
    route: 'doubao',
    keyRef: 'ARK_API_KEY',
    models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915'],
    piAi: { api: 'openai-completions', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', displayName: '豆包' },
  },
  zhipu: {
    label: '智谱 GLM',
    route: 'zhipu',
    keyRef: 'ZHIPU_API_KEY',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
    piAi: { api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4', displayName: '智谱 GLM' },
  },
  kimi: {
    label: 'Kimi',
    route: 'kimi',
    keyRef: 'MOONSHOT_API_KEY',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    piAi: { api: 'openai-completions', baseURL: 'https://api.moonshot.ai/v1', displayName: 'Kimi' },
  },
  stepfun: {
    label: '阶跃星辰',
    route: 'stepfun',
    keyRef: 'STEP_API_KEY',
    models: ['step-5-preview'],
    piAi: { api: 'openai-completions', baseURL: 'https://api.stepfun.com/v1', displayName: '阶跃星辰' },
  },
}
