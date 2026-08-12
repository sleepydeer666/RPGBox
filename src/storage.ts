import { Preferences } from '@capacitor/preferences'
import { DEFAULT_PROVIDER, DEFAULT_SYSTEM_PROMPT } from './config'
import { createDefaultAiSettings, createDefaultCharacters, createDefaultNarrative, OPENING_MESSAGE } from './game'
import { migrateLegacyNpcIds } from './lib/migrations'
import { normalizeMemoryState } from './lib/memory'
import { normalizeNewStoryChoiceCount } from './lib/prompt'
import type { ChatMessage, GameSession, GameState, NarrativeProgress, ProviderProfile } from './types'

const KEY = 'rpgbox-state-v1'

export interface PersistedState {
  providers: ProviderProfile[]
  activeProviderId: string
  globalJailbreakPrompt: string
  games: GameSession[]
  activeGameId: string
}

interface LegacyState {
  systemPrompt?: string
  messages?: ChatMessage[]
  gameState?: GameState & { focusCharacter?: string; expression?: string }
  memory?: { summary?: string; turnsSinceSummary?: number }
}

export async function loadState(): Promise<Partial<PersistedState>> {
  const { value } = await Preferences.get({ key: KEY })
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Partial<PersistedState> & LegacyState
    if (parsed.providers) {
      parsed.providers = parsed.providers.map((provider) => ({
        ...provider,
        topP: provider.topP ?? 1,
        presencePenalty: provider.presencePenalty ?? 0,
        frequencyPenalty: provider.frequencyPenalty ?? 0,
        models: provider.models?.length
          ? Array.from(new Set(provider.models))
          : provider.model
            ? [provider.model]
            : [],
      }))
    }
    const fallbackProvider = parsed.providers?.find((provider) => provider.id === parsed.activeProviderId) ?? parsed.providers?.[0]
    if (!parsed.games?.length) {
      const gameId = 'game-rainy-night'
      parsed.games = [{
        id: gameId,
        title: '雨夜来客',
        note: '',
        nsfwEnabled: true,
        newStoryChoiceCount: 4,
        systemPrompt: parsed.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        aiSettings: createDefaultAiSettings(fallbackProvider),
        storyStylePrompt: parsed.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        statusRulesPrompt: '',
        nsfwScenePrompt: '',
        worldSettingPrompt: '',
        characters: createDefaultCharacters(parsed.gameState?.focusCharacter),
        messages: (parsed.messages ?? []).map((message) =>
          message.id === 'opening' && !message.content.includes('"segments"')
            ? { ...message, content: OPENING_MESSAGE }
            : message,
        ),
        gameState: { location: parsed.gameState?.location ?? '未知', time: parsed.gameState?.time ?? '未知', contentMode: parsed.gameState?.contentMode ?? 'normal', values: parsed.gameState?.values ?? {}, presentCharacterIds: parsed.gameState?.presentCharacterIds },
        narrative: createDefaultNarrative('雨夜来客', '', (parsed.messages ?? [])[0]?.id ?? ''),
        memory: normalizeMemoryState({ historicalSummary: parsed.memory?.summary ?? '' }),
        updatedAt: Date.now(),
      }]
      parsed.activeGameId = gameId
    }
    parsed.games = (parsed.games ?? []).map((game) => {
      const legacy = game as GameSession & {
        chapter?: string
        gameState: GameState & { focusCharacter?: string; expression?: string }
        memory: GameSession['memory'] & { summary?: string; turnsSinceSummary?: number }
      }
      const memory = legacy.memory ?? {} as typeof legacy.memory
      const narrative = chapterOnlyNarrative(
        legacy.narrative,
        legacy.chapter || '序章',
        legacy.messages[0]?.id ?? '',
      )
      return migrateLegacyNpcIds({
      ...legacy,
      note: legacy.note ?? '',
      nsfwEnabled: typeof legacy.nsfwEnabled === 'boolean' ? legacy.nsfwEnabled : true,
      newStoryChoiceCount: normalizeNewStoryChoiceCount(legacy.newStoryChoiceCount),
      aiSettings: { ...createDefaultAiSettings(fallbackProvider), ...legacy.aiSettings },
      storyStylePrompt: legacy.storyStylePrompt ?? legacy.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      statusRulesPrompt: legacy.statusRulesPrompt ?? '',
      nsfwScenePrompt: legacy.nsfwScenePrompt ?? '',
      worldSettingPrompt: legacy.worldSettingPrompt ?? '',
      characters: (legacy.characters?.length ? legacy.characters : createDefaultCharacters(legacy.gameState.focusCharacter)).map((character) => ({
        ...character,
        nsfwDescription: character.nsfwDescription ?? '',
        statusBar: character.statusBar ?? '',
        portraits: (character.portraits ?? []).map((portrait) => ({
          ...portrait,
          tags: portrait.tags?.length ? portrait.tags : [portrait.expression].filter(Boolean),
          groups: portrait.groups?.length ? portrait.groups : ['normal'],
        })),
        defaultPortraitId: character.defaultPortraitId ?? character.portraits?.[0]?.id,
        defaultPortraitIds: character.defaultPortraitIds ?? {
          normal: character.defaultPortraitId ?? character.portraits?.[0]?.id,
        },
      })),
      messages: legacy.messages.map((message) =>
        message.id === 'opening' && !message.content.includes('"segments"')
          ? { ...message, content: OPENING_MESSAGE }
          : message,
      ),
      gameState: { location: legacy.gameState.location ?? '未知', time: legacy.gameState.time ?? '未知', contentMode: legacy.gameState.contentMode ?? 'normal', values: legacy.gameState.values ?? {}, presentCharacterIds: legacy.gameState.presentCharacterIds },
      narrative,
      memory: normalizeMemoryState({
        ...memory,
        historicalSummary: memory.historicalSummary ?? memory.summary ?? '',
      }),
      rollbackLog: (legacy.rollbackLog ?? []).slice(-5).map((snapshot) => ({
        ...snapshot,
        narrative: chapterOnlyNarrative(snapshot.narrative, narrative.chapter.title, snapshot.narrative?.chapter.startedAtMessageId ?? ''),
        memory: normalizeMemoryState(snapshot.memory),
      })),
    })})
    if (!parsed.activeGameId || !parsed.games.some((game) => game.id === parsed.activeGameId)) {
      parsed.activeGameId = parsed.games[0].id
    }
    return {
      providers: parsed.providers,
      activeProviderId: parsed.activeProviderId,
      globalJailbreakPrompt: parsed.globalJailbreakPrompt ?? '',
      games: parsed.games,
      activeGameId: parsed.activeGameId,
    }
  } catch {
    return {}
  }
}

function chapterOnlyNarrative(narrative: NarrativeProgress | undefined, fallbackTitle: string, messageId: string): NarrativeProgress {
  if (!narrative?.chapter) return createDefaultNarrative(fallbackTitle, '', messageId)
  const legacyUnitTitle = narrative.unit?.title?.trim()
  const useLegacyUnit = legacyUnitTitle && !['当前单元', '旅程开始', '开场'].includes(legacyUnitTitle)
  return useLegacyUnit ? {
    chapter: {
      id: narrative.unit?.id ?? narrative.chapter.id,
      title: legacyUnitTitle,
      startedAtMessageId: narrative.unit?.startedAtMessageId ?? narrative.chapter.startedAtMessageId,
    },
  } : { chapter: narrative.chapter }
}

export async function saveState(state: PersistedState): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(state) })
}

export function createInitialProviderState() {
  return {
    providers: [DEFAULT_PROVIDER],
    activeProviderId: DEFAULT_PROVIDER.id,
  }
}
