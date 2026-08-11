import type { GameState, ProviderProfile } from './types'

export const DEFAULT_STORY_STYLE_PROMPT = `使用沉浸式中文小说叙事，细致描写场景、动作、神态与人物反应。
保持故事连贯和人物性格稳定，让剧情具有自然的起承转合。`

// Retained as a storage migration alias for builds created before prompt layers were separated.
export const DEFAULT_SYSTEM_PROMPT = DEFAULT_STORY_STYLE_PROMPT

export const DEFAULT_PROVIDER: ProviderProfile = {
  id: 'default-provider',
  name: '默认 API',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  models: ['gpt-4o-mini'],
  temperature: 0.9,
  topP: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  maxTokens: 1800,
}

export const DEFAULT_GAME_STATE: GameState = {
  location: '旧城区旅店',
  time: '深夜',
  contentMode: 'normal',
  values: {
    '莉亚·信赖': 12,
    '线索': 1,
  },
}
