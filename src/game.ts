import { DEFAULT_GAME_STATE, DEFAULT_SYSTEM_PROMPT } from './config'
import { createNpcId } from './lib/migrations'
import { normalizeMemoryState } from './lib/memory'
import { DEFAULT_NARRATIVE_MODES } from './lib/narrativeModes'
import type { CharacterProfile, GameAiSettings, GameSession, NarrativeProgress, ProviderProfile } from './types'

export const OPENING_MESSAGE = `[状态] 地点：旧城区旅店；时间：深夜；章节：雨夜来客；在场人物：莉亚
[旁白] 雨水沿着旅店的彩绘玻璃缓慢滑落。莉亚坐在壁炉旁，听见你的脚步后抬起头，却很快移开了目光。
莉亚（紧张）：你还是来了。今晚有人跟踪我。我们恐怕没有多少时间。
[旁白] 她把一枚沾着泥水的银色徽章推到桌面中央。火光映在徽章残缺的纹路上，那正是三日前失踪商队留下的标志。
[选项A] 拿起徽章，询问她在哪里发现的
[选项B] 先确认旅店里是否有可疑人物
[选项C] 坐到她身边，询问她为什么如此紧张`

export function createDefaultAiSettings(provider?: ProviderProfile): GameAiSettings {
  return {
    providerId: provider?.id ?? 'default-provider',
    model: provider?.model ?? 'gpt-4o-mini',
    useCompatiblePromptFormat: true,
    temperature: provider?.temperature ?? 0.5,
    topP: provider?.topP ?? 1,
    presencePenalty: provider?.presencePenalty ?? 0,
    frequencyPenalty: provider?.frequencyPenalty ?? 0,
    maxTokens: 10000,
    contextTurns: 15,
    warnOnProtocolAnomaly: true,
    treatMalformedLinesAsNarration: false,
  }
}

export function createDefaultCharacters(focusCharacter = '莉亚'): CharacterProfile[] {
  const characters: CharacterProfile[] = [{
    id: 'player',
    role: 'player',
    name: '主角',
    gender: '男',
    description: '由用户扮演。AI不得替主角决定关键行动、想法或台词。',
    modeDescriptions: {},
    statusBar: '',
    color: '#65b7a5',
    portraits: [],
  }]

  if (focusCharacter) {
    characters.push({
      id: createNpcId(),
      role: 'npc',
      name: focusCharacter,
      gender: '女',
      description: '主要NPC。请在RPG设置中补充性格、服饰、口癖和人物关系。',
      modeDescriptions: {},
      statusBar: '',
      color: '#d3ab61',
      portraits: [],
    })
  }
  return characters
}

export function createDefaultNarrative(chapterTitle = '', _unitTitle = '', messageId = ''): NarrativeProgress {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    chapter: { id: `chapter-${stamp}`, title: chapterTitle, startedAtMessageId: messageId },
    chapterPhase: chapterTitle.trim() ? 'active' : 'opening',
  }
}

export function createInitialGame(): GameSession {
  const now = Date.now()
  return {
    id: 'game-rainy-night',
    title: '雨夜来客',
    note: '',
    narrativeModes: DEFAULT_NARRATIVE_MODES.map((mode) => ({ ...mode })),
    newStoryChoiceCount: 4,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    aiSettings: createDefaultAiSettings(),
    storyStylePrompt: DEFAULT_SYSTEM_PROMPT,
    modeStoryStylePrompts: {},
    chapterTransitionRules: '',
    narrativeModeRulesPrompt: '',
    recommendedChapterTurnsEnabled: false,
    recommendedChapterTurns: 20,
    statusRulesPrompt: '',
    clearStatusBarAfterChapter: true,
    nsfwScenePrompt: '',
    worldSettingPrompt: '',
    characters: createDefaultCharacters(),
    messages: [{ id: 'opening', role: 'assistant', content: OPENING_MESSAGE, createdAt: now }],
    gameState: DEFAULT_GAME_STATE,
    narrative: createDefaultNarrative('雨夜来客', '', 'opening'),
    memory: normalizeMemoryState(undefined),
    rollbackLog: [],
    updatedAt: now,
  }
}

export function createBlankGame(index: number, provider?: ProviderProfile): GameSession {
  const now = Date.now()
  return {
    id: `game-${now}-${Math.random().toString(16).slice(2)}`,
    title: `新RPG ${index}`,
    note: '',
    narrativeModes: DEFAULT_NARRATIVE_MODES.map((mode) => ({ ...mode })),
    newStoryChoiceCount: 4,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    aiSettings: createDefaultAiSettings(provider),
    storyStylePrompt: DEFAULT_SYSTEM_PROMPT,
    modeStoryStylePrompts: {},
    chapterTransitionRules: '',
    narrativeModeRulesPrompt: '',
    recommendedChapterTurnsEnabled: false,
    recommendedChapterTurns: 20,
    statusRulesPrompt: '',
    clearStatusBarAfterChapter: true,
    nsfwScenePrompt: '',
    worldSettingPrompt: '',
    characters: createDefaultCharacters('主要NPC'),
    messages: [{
      id: `opening-${now}`,
      role: 'assistant',
      content: '新的旅程尚未留下文字。',
      createdAt: now,
    }],
    gameState: { location: '未知之地', time: '序章', contentMode: 'normal', values: {} },
    narrative: createDefaultNarrative('', '', `opening-${now}`),
    memory: normalizeMemoryState(undefined),
    rollbackLog: [],
    updatedAt: now,
  }
}
