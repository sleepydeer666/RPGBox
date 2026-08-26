import { DEFAULT_PROVIDER, DEFAULT_SYSTEM_PROMPT } from './config'
import { createDefaultAiSettings, createDefaultCharacters, createDefaultNarrative, OPENING_MESSAGE } from './game'
import { migrateLegacyNpcIds } from './lib/migrations'
import { normalizeMemoryState } from './lib/memory'
import { normalizeNewStoryChoiceCount } from './lib/prompt'
import { DEFAULT_NARRATIVE_MODES, normalizeGameNarrativeModes } from './lib/narrativeModes'
import type { ChatMessage, GameSession, GameState, NarrativeProgress, ProviderProfile } from './types'
import { readStoredState, writeStoredState } from './platform/stateStore'

const KEY = 'rpgbox-state-v1'

export interface PersistedState {
  providers: ProviderProfile[]
  activeProviderId: string
  globalJailbreakPrompt: string
  games: GameSession[]
  activeGameId: string
  bundledRpgImportKeys: string[]
}

interface LegacyState {
  systemPrompt?: string
  messages?: ChatMessage[]
  gameState?: GameState & { focusCharacter?: string; expression?: string }
  memory?: { summary?: string; turnsSinceSummary?: number }
}

export async function loadState(): Promise<Partial<PersistedState>> {
  const value = await readStoredState(KEY)
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
    parsed.games = (parsed.games ?? []).map((game) => {
      const legacy = game as GameSession & {
        chapter?: string
        preserveStatusBarAfterChapter?: boolean
        gameState: GameState & { focusCharacter?: string; expression?: string }
        memory: GameSession['memory'] & { summary?: string; turnsSinceSummary?: number }
      }
      const memory = legacy.memory ?? {} as typeof legacy.memory
      const narrative = chapterOnlyNarrative(
        legacy.narrative,
        legacy.chapter || '序章',
        legacy.messages[0]?.id ?? '',
      )
      const { nsfwEnabled: _removedNsfwEnabled, ...legacyWithoutNsfwEnabled } = legacy as typeof legacy & { nsfwEnabled?: boolean }
      return normalizeGameNarrativeModes(migrateLegacyNpcIds({
      ...legacyWithoutNsfwEnabled,
      note: legacy.note ?? '',
      narrativeModes: legacy.narrativeModes ?? DEFAULT_NARRATIVE_MODES.map((mode) => ({ ...mode })),
      newStoryChoiceCount: normalizeNewStoryChoiceCount(legacy.newStoryChoiceCount),
      aiSettings: { ...createDefaultAiSettings(fallbackProvider), ...legacy.aiSettings },
      storyStylePrompt: legacy.storyStylePrompt ?? legacy.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      modeStoryStylePrompts: legacy.modeStoryStylePrompts ?? {},
      chapterTransitionRules: legacy.chapterTransitionRules ?? '',
      narrativeModeRulesPrompt: legacy.narrativeModeRulesPrompt ?? '',
      recommendedChapterTurnsEnabled: legacy.recommendedChapterTurnsEnabled ?? false,
      recommendedChapterTurns: clampRecommendedChapterTurns(legacy.recommendedChapterTurns),
      statusRulesPrompt: legacy.statusRulesPrompt ?? '',
      clearStatusBarAfterChapter: legacy.clearStatusBarAfterChapter ?? (legacy.preserveStatusBarAfterChapter === undefined ? true : !legacy.preserveStatusBarAfterChapter),
      nsfwScenePrompt: legacy.nsfwScenePrompt ?? '',
      worldSettingPrompt: legacy.worldSettingPrompt ?? '',
      characters: (legacy.characters?.length ? legacy.characters : createDefaultCharacters(legacy.gameState.focusCharacter)).map((character) => {
        const legacyCharacter = character as typeof character & { nsfwDescription?: string }
        const { nsfwDescription, ...characterWithoutNsfwDescription } = legacyCharacter
        return {
        ...characterWithoutNsfwDescription,
        modeDescriptions: character.modeDescriptions ?? (nsfwDescription?.trim() ? { nsfw: nsfwDescription } : {}),
        statusBar: character.statusBar ?? '',
        portraits: (character.portraits ?? []).map((portrait) => ({
          ...portrait,
          tags: portrait.tags?.length ? portrait.tags : [portrait.expression].filter(Boolean),
          groups: portrait.groups ?? ['normal'],
        })),
        defaultPortraitId: character.defaultPortraitId ?? character.portraits?.[0]?.id,
        defaultPortraitIds: character.defaultPortraitIds ?? {
          normal: character.defaultPortraitId ?? character.portraits?.[0]?.id,
        },
      }}),
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
      }))
    })
    if (!parsed.activeGameId || !parsed.games.some((game) => game.id === parsed.activeGameId)) {
      parsed.activeGameId = parsed.games[0]?.id ?? ''
    }
    return {
      providers: parsed.providers,
      activeProviderId: parsed.activeProviderId,
      globalJailbreakPrompt: parsed.globalJailbreakPrompt ?? '',
      games: parsed.games,
      activeGameId: parsed.activeGameId,
      bundledRpgImportKeys: parsed.bundledRpgImportKeys ?? [],
    }
  } catch {
    return {}
  }
}

function clampRecommendedChapterTurns(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20
  return Math.min(30, Math.max(10, Math.round(value as number)))
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
    chapterPhase: legacyUnitTitle ? 'active' : narrative.chapterPhase,
  } : {
    chapter: narrative.chapter,
    chapterPhase: narrative.chapterPhase ?? (narrative.chapter.title.trim() ? 'active' : 'opening'),
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  await writeStoredState(KEY, JSON.stringify(state))
}

export function createInitialProviderState() {
  return {
    providers: [DEFAULT_PROVIDER],
    activeProviderId: DEFAULT_PROVIDER.id,
  }
}
