import { AlertTriangle, BookOpen, Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronUp, ChevronsDown, ChevronsUp, CircleStop, ClipboardList, Clock3, Flag, History, Hourglass, Lock, MapPin, Menu, Plus, RefreshCw, RotateCcw, Send, Server, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import GameDrawer, { type GameDrawerProps } from './components/GameDrawer'
import GameSettingsDialog from './components/GameSettingsDialog'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'
import OnboardingGuide from './components/OnboardingGuide'
import { DeferredTextarea } from './components/DeferredFields'
import { createBlankGame } from './game'
import { tokenizeCharacterNames, tokenizeNarrationText } from './lib/characterText'
import { buildCharacterExperienceUserPrompt, CHARACTER_EXPERIENCE_SYSTEM_PROMPT, chapterExperienceTargets, parseCharacterExperienceResponse, type CharacterExperienceTarget } from './lib/characterExperience'
import { acceptNewChapterTitle, buildChapterProgressInstruction, buildTurnInstructions, CHAPTER_END_MARKER, CHAPTER_NAMING_INSTRUCTION, currentChapterTurnCount, selectedChoiceEndsChapter, shouldRequestNewChapterName } from './lib/chapterTurns'
import { loadBundledDefaultPrompt, resolveGlobalJailbreakPrompt } from './lib/defaultPrompt'
import { groupDebugPromptSegments, latestDebugExchange } from './lib/debugExchange'
import { resolveCharacterExpression } from './lib/expressions'
import { buildHistoryLines } from './lib/history'
import { importBundledRpg, listBundledRpgPresets, type BundledRpgPreset } from './lib/bundledRpg'
import { archivedChapterMemories, characterExperience, currentChapterSummary, mergeChapterMemories, normalizeMemoryState, partitionRecentChapterMemories, pendingDistantChapterMemories, recentChapterMemories } from './lib/memory'
import { buildChapterSummaryDebugRequest, buildDistantSummaryDebugRequest, CHAPTER_SUMMARY_SYSTEM_PROMPT, DISTANT_SUMMARY_SYSTEM_PROMPT, formatAdditionalMemorySummaryInstructions, formatCharacterExperienceSummaryTargets, isValidChapterSummary, isValidDistantSummary, normalizeMemorySummaryOutput } from './lib/memorySummary'
import { hasProtocolAnomaly, normalizeProtocolResponse, parseAssistantResponse, protocolAnomalyExpressionRanges, protocolAnomalyLineIndexes, standardResponse } from './lib/parser'
import { completedTurnPlaybackIndex, hasCompleteVisibleContent, isChoicePageVisible, parsePlaybackResponse, reconcilePlaybackIndex, resolvePlayback, resolvePlaybackContentMode, scenePresentationChanged } from './lib/playback'
import { portraitSource } from './lib/portraits'
import { deletePortraitFile } from './lib/portraits'
import { cloneGameSession, exportRpgbox, importRpgbox, type RpgboxImportSource, type RpgExportOptions } from './lib/rpgPackage'
import { buildFormatRepairApiMessages, buildLlmSpecialInstructionText, buildRpgTurnApiMessages, buildRpgTurnDebugSegments, buildSystemPrompt, buildTurnCharacterProfiles, buildTurnDynamicInstructions, buildTurnNarrativeContext, buildTurnOutputContract, buildTurnRequestDebugContent, FORMAT_REPAIR_INSTRUCTION, normalizeAssistantMessageForContext, takeRecentConversationTurns, toApiMessages, type LlmSpecialInstructions } from './lib/prompt'
import { inspectLatestResponseCompletion, mergeContinuationResponseResult, responseContinuationInstruction } from './lib/responseCompletion'
import { appendRollbackSnapshot, changedStatusCharacterIds, createRollbackSnapshot, latestTurnPreviousStatuses, restoreLastRollback, rollbackInputDraft } from './lib/rollback'
import { buildTurnStateInstruction, choiceActionText, resolveTurnContentMode } from './lib/rpgState'
import { availableNarrativeModes, defaultNarrativeModeId, narrativeModeById } from './lib/narrativeModes'
import { applyRpgStatePatch } from './lib/state'
import { collectRecentActors, collectTurnActors, includeActiveSpeaker, type StageActor, type StageTurn } from './lib/stage'
import { selectTurnPortraitCharacters } from './lib/turnPortraits'
import { streamCompletion } from './services/openai'
import type { CompletionUsage } from './services/openai'
import { createInitialProviderState, loadState, saveState } from './storage'
import { readLocalFlag, writeLocalFlag } from './platform/stateStore'
import type { ChapterMemory, CharacterProfile, ChatMessage, Choice, DebugPromptSegment, GameSession, MemoryState, MemorySummaryDebugEntry, PortraitGroup, ProviderProfile, StorySegment } from './types'

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const CLOSE_CHAPTER_INSTRUCTION = '尽快收尾本章节，然后开启一段过渡剧情为新章节做准备；如果前后章节紧密连贯，也可以直接开始新章节。'
const EMPTY_RPG_PLACEHOLDER = '新的旅程尚未留下文字。'
const EMPTY_LLM_SPECIAL_INSTRUCTIONS: LlmSpecialInstructions = {
  preferEroticChoices: false,
  increaseLength: false,
  decreaseLength: false,
}
const ONBOARDING_PROMPT_SEEN_KEY = 'rpgbox-onboarding-prompt-seen-v1'

function formatMemorySummaryDebug(
  label: string,
  request: string,
  responses: string[],
  usage?: CompletionUsage,
  error?: string,
): MemorySummaryDebugEntry {
  const response = responses.map((value, index) => `===== 第 ${index + 1} 次 LLM 原始返回 =====\n${value || '（空响应）'}`).join('\n\n')
  return {
    label,
    request,
    response: [response, error ? `===== 错误 =====\n${error}` : ''].filter(Boolean).join('\n\n'),
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  }
}

function App() {
  const defaults = createInitialProviderState()
  const fallbackGame = useMemo(() => createBlankGame(1), [])
  const [providers, setProviders] = useState<ProviderProfile[]>(defaults.providers)
  const [activeProviderId, setActiveProviderId] = useState(defaults.activeProviderId)
  const [globalJailbreakPrompt, setGlobalJailbreakPrompt] = useState('')
  const [bundledDefaultPrompt, setBundledDefaultPrompt] = useState('')
  const [games, setGames] = useState<GameSession[]>([])
  const [activeGameId, setActiveGameId] = useState('')
  const [bundledRpgImportKeys, setBundledRpgImportKeys] = useState<string[]>([])
  const [bundledRpgPresets, setBundledRpgPresets] = useState<BundledRpgPreset[]>([])
  const [segmentPositions, setSegmentPositions] = useState<Record<string, number>>({})
  const [manualDisplayContentModes, setManualDisplayContentModes] = useState<Record<string, PortraitGroup | undefined>>({})
  const [selectedChoices, setSelectedChoices] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')
  const [rpgStateLocked, setRpgStateLocked] = useState(false)
  const [rpgStateMenuOpen, setRpgStateMenuOpen] = useState(false)
  const [gameDrawerOpen, setGameDrawerOpen] = useState(false)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [llmSpecialInstructionsOpen, setLlmSpecialInstructionsOpen] = useState(false)
  const [llmSpecialInstructions, setLlmSpecialInstructions] = useState<LlmSpecialInstructions>(EMPTY_LLM_SPECIAL_INSTRUCTIONS)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [onboardingPromptOpen, setOnboardingPromptOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [onboardingPromptSeen, setOnboardingPromptSeen] = useState<boolean | null>(null)
  const [viewedStatusCharacterId, setViewedStatusCharacterId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [continuingResponse, setContinuingResponse] = useState(false)
  const [summarizingMemory, setSummarizingMemory] = useState<string | null>(null)
  const [autoMemoryFeedback, setAutoMemoryFeedback] = useState<{ key: number; status: 'success' | 'error' } | null>(null)
  const [error, setError] = useState('')
  const [protocolAlertKey, setProtocolAlertKey] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const rpgStateControlsRef = useRef<HTMLDivElement>(null)
  const streamingPlaybackRef = useRef<Record<string, { messageId: string; segments: StorySegment[]; index: number }>>({})
  const sceneAnnouncementPendingMessageRef = useRef<string | null>(null)
  const sceneAnnouncementPlaybackRef = useRef<{ messageId: string; index: number } | null>(null)
  const sceneAnnouncementSequenceRef = useRef(0)
  const [sceneAnnouncement, setSceneAnnouncement] = useState<{ key: number; location: string; characterIds: string[] } | null>(null)
  const narrativeModeFlashPendingMessageRef = useRef<string | null>(null)
  const narrativeModePlaybackRef = useRef<{ messageId: string; index: number } | null>(null)
  const [narrativeModeFlashKey, setNarrativeModeFlashKey] = useState(0)

  const activeGame = games.find((game) => game.id === activeGameId) ?? games[0] ?? fallbackGame
  const autoMemoryInProgress = summarizingMemory?.startsWith('auto-memory:') ?? false
  const activeNarrativeModes = availableNarrativeModes(activeGame)
  const configuredProvider = providers.find((provider) => provider.id === activeGame.aiSettings.providerId) ?? providers[0]
  const activeProvider = configuredProvider ? {
    ...configuredProvider,
    model: activeGame.aiSettings.model || configuredProvider.model,
    temperature: activeGame.aiSettings.temperature,
    topP: activeGame.aiSettings.topP,
    presencePenalty: activeGame.aiSettings.presencePenalty,
    frequencyPenalty: activeGame.aiSettings.frequencyPenalty,
    maxTokens: activeGame.aiSettings.maxTokens,
  } : undefined
  const hasUsableProvider = Boolean(activeProvider?.baseUrl.trim() && activeProvider.apiKey.trim() && activeProvider.model.trim())
  const latestRollbackSnapshot = activeGame.rollbackLog?.at(-1)
  const latestMessagePair = activeGame.messages.slice(-2)
  const canRepairLatestResponse = Boolean(
    latestRollbackSnapshot
    && latestRollbackSnapshot.messageCount === activeGame.messages.length - 2
    && latestMessagePair[0]?.role === 'user'
    && latestMessagePair[0].requestSegments?.length
    && latestMessagePair[1]?.role === 'assistant'
    && (latestMessagePair[1].rawContent ?? latestMessagePair[1].content).trim(),
  )
  const chapterTurnCount = currentChapterTurnCount(activeGame)
  const effectiveGlobalJailbreakPrompt = resolveGlobalJailbreakPrompt(globalJailbreakPrompt, bundledDefaultPrompt)
  const latestAssistant = [...activeGame.messages].reverse().find((message) => message.role === 'assistant')
  const latestFinalContentMode = latestAssistant?.rpgStateId ?? activeGame.gameState.contentMode
  const latestInitialContentMode = latestAssistant?.initialRpgStateId ?? latestFinalContentMode
  const debugExchange = useMemo(() => latestDebugExchange(activeGame.messages), [activeGame.messages])
  const latestParsed = useMemo(() => parsePlaybackResponse(latestAssistant?.rawContent ?? latestAssistant?.content ?? '', {
    characters: activeGame.characters,
    contentMode: latestFinalContentMode,
    initialContentMode: latestInitialContentMode,
    narrativeModes: activeGame.narrativeModes,
    treatMalformedLinesAsNarration: activeGame.aiSettings.treatMalformedLinesAsNarration,
  }, true), [activeGame.characters, activeGame.narrativeModes, latestAssistant?.content, latestAssistant?.rawContent, latestFinalContentMode, latestInitialContentMode])
  const streamingParsed = useMemo(
    () => parsePlaybackResponse(latestAssistant?.rawContent ?? latestAssistant?.content ?? '', {
      characters: activeGame.characters,
      contentMode: latestFinalContentMode,
      initialContentMode: latestInitialContentMode,
      narrativeModes: activeGame.narrativeModes,
      treatMalformedLinesAsNarration: activeGame.aiSettings.treatMalformedLinesAsNarration,
    }),
    [activeGame.characters, activeGame.narrativeModes, latestAssistant?.content, latestAssistant?.rawContent, latestFinalContentMode, latestInitialContentMode],
  )
  const rawSegmentIndex = segmentPositions[activeGame.id] ?? 0
  const playback = resolvePlayback(busy, latestParsed.segments, streamingParsed.segments, rawSegmentIndex)
  const segmentIndex = playback.index
  const segmentsComplete = playback.complete
  const choicesAvailable = !busy && segmentsComplete && latestParsed.choices.length > 0
  const choicesVisible = choicesAvailable && isChoicePageVisible(busy, latestParsed.segments.length, latestParsed.choices.length, rawSegmentIndex)
  const canAdvance = playback.canAdvance || (choicesAvailable && !choicesVisible)
  const currentSegment: StorySegment | undefined = playback.current
    ?? (busy ? { type: 'narration', text: '正在生成' } : undefined)
  const inputVisible = !busy && segmentsComplete && (!choicesAvailable || choicesVisible)
  const responseCompletion = useMemo(() => inspectLatestResponseCompletion(activeGame), [activeGame])
  const protocolAnomaly = useMemo(() => Boolean(activeGame.aiSettings.warnOnProtocolAnomaly)
    && !activeGame.aiSettings.treatMalformedLinesAsNarration
    && !busy
    && Boolean(latestAssistant?.rawContent)
    && hasProtocolAnomaly(
    latestAssistant?.rawContent ?? '',
    { characters: activeGame.characters, contentMode: latestFinalContentMode, initialContentMode: latestInitialContentMode, narrativeModes: activeGame.narrativeModes },
  ), [activeGame.aiSettings.warnOnProtocolAnomaly, activeGame.characters, activeGame.narrativeModes, busy, latestAssistant?.rawContent, latestFinalContentMode, latestInitialContentMode])
  const needsContinuation = !busy && responseCompletion.canContinue && !responseCompletion.complete
  const showProgressContinuation = needsContinuation && !responseCompletion.hasChoices && segmentsComplete
  const showChoiceContinuation = needsContinuation && responseCompletion.hasChoices && choicesVisible
  const statusRulesEnabled = Boolean(activeGame.statusRulesPrompt?.trim())
  const memoryForDisplay = normalizeMemoryState(activeGame.memory)
  const hasStoryRecord = activeGame.messages.some((message) => message.role === 'user'
    || (message.role === 'assistant' && message.content.trim() && message.content.trim() !== EMPTY_RPG_PLACEHOLDER))
  const emptyRpg = !hasStoryRecord && !busy
  const previousStageTurns = useMemo(() => activeGame.messages.flatMap((message): StageTurn[] => {
    if (message.role !== 'assistant' || message.id === latestAssistant?.id) return []
    const parsed = parseAssistantResponse(message.rawContent ?? message.content, {
      characters: activeGame.characters,
      contentMode: message.rpgStateId ?? activeGame.gameState.contentMode,
      initialContentMode: message.initialRpgStateId ?? message.rpgStateId ?? activeGame.gameState.contentMode,
      narrativeModes: activeGame.narrativeModes,
    })
    return [{
      segments: parsed.segments,
      presentCharacterIds: parsed.gameData?.statePatch?.presentCharacterIds as string[] | undefined,
    }]
  }), [activeGame.characters, activeGame.messages, activeGame.narrativeModes, latestAssistant?.id])
  const currentStageParse = busy ? streamingParsed : latestParsed
  const patchedDisplayGameState = applyRpgStatePatch(activeGame.gameState, currentSegment?.statePatch ?? currentStageParse.gameData?.statePatch)
  const playbackContentMode = resolvePlaybackContentMode(choicesVisible, currentSegment, latestInitialContentMode, activeGame.gameState.contentMode, manualDisplayContentModes[activeGame.id])
  const displayGameState = { ...patchedDisplayGameState, contentMode: playbackContentMode }
  const displayChapterTitle = activeGame.narrative.chapter.title.trim()
  const displayChapterTurnCount = activeGame.narrative.chapterPhase === 'active' ? chapterTurnCount : 0
  const currentPresentCharacterIds = currentSegment?.presentCharacterIds
  const persistentDialogueActors = collectRecentActors([
    ...previousStageTurns,
    {
      segments: playback.segments.slice(0, segmentIndex + 1),
      presentCharacterIds: currentPresentCharacterIds,
    },
  ], activeGame.characters, 2, displayGameState.contentMode, true)
  const dialogueActors = includeActiveSpeaker(persistentDialogueActors, currentSegment, activeGame.characters, displayGameState.contentMode, 2)
  const choiceActors = collectTurnActors(
    latestParsed.segments,
    activeGame.characters,
    (latestParsed.segments.at(-1)?.presentCharacterIds ?? latestParsed.gameData?.statePatch?.presentCharacterIds) as string[] | undefined,
    4,
    displayGameState.contentMode,
  )
  const previousStatuses = latestTurnPreviousStatuses(activeGame)
  const dialogueStatusActors = previousStatuses ? dialogueActors.map((actor) => ({
    ...actor,
    character: { ...actor.character, statusBar: previousStatuses[actor.character.id] ?? actor.character.statusBar },
  })) : dialogueActors
  const changedStatusIds = choicesVisible
    ? changedStatusCharacterIds(previousStatuses, latestParsed.characterStatusUpdates)
    : new Set<string>()
  const visibleStatusActors = choicesVisible ? choiceActors : dialogueStatusActors
  const historyLines = useMemo(
    () => buildHistoryLines(activeGame.messages, busy ? latestAssistant?.id : undefined, activeGame.characters),
    [activeGame.characters, activeGame.messages, busy, latestAssistant?.id],
  )

  useEffect(() => {
    void loadBundledDefaultPrompt().then(setBundledDefaultPrompt)
  }, [])

  useLayoutEffect(() => {
    if (!latestAssistant?.id) return
    if (busy) {
      streamingPlaybackRef.current[activeGame.id] = {
        messageId: latestAssistant.id,
        segments: streamingParsed.segments,
        index: segmentIndex,
      }
      return
    }
    const previous = streamingPlaybackRef.current[activeGame.id]
    if (!previous || previous.messageId !== latestAssistant.id) return
    delete streamingPlaybackRef.current[activeGame.id]
    const reconciled = reconcilePlaybackIndex(previous.segments, latestParsed.segments, previous.index)
    if (reconciled !== rawSegmentIndex) {
      setSegmentPositions((current) => ({ ...current, [activeGame.id]: reconciled }))
    }
  }, [activeGame.id, busy, latestAssistant?.id, latestParsed.segments, rawSegmentIndex, segmentIndex, streamingParsed.segments])

  useEffect(() => {
    const messageId = latestAssistant?.id
    const segment = playback.current
    if (!messageId || !segment) return
    const previousPlayback = sceneAnnouncementPlaybackRef.current
    const isNewTurnOpening = sceneAnnouncementPendingMessageRef.current === messageId && segmentIndex === 0
    const movedForward = previousPlayback?.messageId === messageId && segmentIndex > previousPlayback.index
    const previousSegment = movedForward ? playback.segments[segmentIndex - 1] : undefined
    if (isNewTurnOpening || (movedForward && scenePresentationChanged(previousSegment, segment))) {
      const location = typeof segment.statePatch?.location === 'string' ? segment.statePatch.location : displayGameState.location
      const present = segment.presentCharacterIds ?? segment.statePatch?.presentCharacterIds
      const characterIds = Array.isArray(present) ? present.filter((id): id is string => typeof id === 'string') : []
      sceneAnnouncementSequenceRef.current += 1
      setSceneAnnouncement({ key: sceneAnnouncementSequenceRef.current, location: location || '未知之地', characterIds })
      if (isNewTurnOpening) sceneAnnouncementPendingMessageRef.current = null
    }
    sceneAnnouncementPlaybackRef.current = { messageId, index: segmentIndex }
  }, [displayGameState.location, latestAssistant?.id, playback.current, playback.segments, segmentIndex])

  useEffect(() => {
    const messageId = latestAssistant?.id
    const segment = playback.current
    if (!messageId || !segment || manualDisplayContentModes[activeGame.id]) return
    const previousPlayback = narrativeModePlaybackRef.current
    const isNewTurnOpening = narrativeModeFlashPendingMessageRef.current === messageId && segmentIndex === 0
    const movedForward = previousPlayback?.messageId === messageId && segmentIndex > previousPlayback.index
    const previousMode = movedForward
      ? playback.segments[segmentIndex - 1]?.rpgStateId ?? latestInitialContentMode
      : latestInitialContentMode
    const currentMode = segment.rpgStateId ?? latestInitialContentMode
    if ((isNewTurnOpening || movedForward) && previousMode !== currentMode) setNarrativeModeFlashKey((key) => key + 1)
    if (isNewTurnOpening) narrativeModeFlashPendingMessageRef.current = null
    narrativeModePlaybackRef.current = { messageId, index: segmentIndex }
  }, [activeGame.id, latestAssistant?.id, latestInitialContentMode, manualDisplayContentModes, playback.current, playback.segments, segmentIndex])

  useEffect(() => {
    void loadState().then((saved) => {
      if (saved.providers?.length) setProviders(saved.providers)
      if (saved.activeProviderId) setActiveProviderId(saved.activeProviderId)
      if (saved.globalJailbreakPrompt) setGlobalJailbreakPrompt(saved.globalJailbreakPrompt)
      setBundledRpgImportKeys(saved.bundledRpgImportKeys ?? [])
      const savedGames = saved.games ?? []
      setGames(savedGames)
      setActiveGameId(saved.activeGameId ?? saved.games?.[0]?.id ?? '')
      setSegmentPositions(Object.fromEntries(savedGames.map((game) => {
        const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
        const parsed = parseAssistantResponse(latest?.rawContent ?? latest?.content ?? '', { characters: game.characters, narrativeModes: game.narrativeModes })
        return [game.id, completedTurnPlaybackIndex(parsed.segments.length, parsed.choices.length)]
      })))
      setHydrated(true)
      void readLocalFlag(ONBOARDING_PROMPT_SEEN_KEY).then(setOnboardingPromptSeen)
    })
  }, [])

  useEffect(() => {
    void listBundledRpgPresets().then(setBundledRpgPresets)
  }, [])

  useEffect(() => {
    if (hydrated && games.length > 0 && onboardingPromptSeen === false) setOnboardingPromptOpen(true)
  }, [games.length, hydrated, onboardingPromptSeen])

  useEffect(() => {
    if (!autoMemoryFeedback) return
    const feedbackKey = autoMemoryFeedback.key
    const timer = window.setTimeout(() => {
      setAutoMemoryFeedback((current) => current?.key === feedbackKey ? null : current)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [autoMemoryFeedback])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => void saveState({ providers, activeProviderId, globalJailbreakPrompt, games, activeGameId, bundledRpgImportKeys }), 250)
    return () => window.clearTimeout(timer)
  }, [activeGameId, activeProviderId, bundledRpgImportKeys, games, globalJailbreakPrompt, hydrated, providers])

  useEffect(() => {
    setViewedStatusCharacterId(null)
  }, [activeGameId, activeGame.messages.length])

  useEffect(() => {
    setLlmSpecialInstructionsOpen(false)
    setLlmSpecialInstructions(EMPTY_LLM_SPECIAL_INSTRUCTIONS)
    setRpgStateLocked(false)
    setRpgStateMenuOpen(false)
  }, [activeGameId])

  useEffect(() => {
    if (!rpgStateMenuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!rpgStateControlsRef.current?.contains(event.target as Node)) setRpgStateMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [rpgStateMenuOpen])

  useEffect(() => {
    if (busy) setRpgStateMenuOpen(false)
  }, [busy])

  useEffect(() => {
    if (!protocolAnomaly || !latestAssistant?.id) {
      setProtocolAlertKey(null)
      return
    }
    const alertKey = `${activeGame.id}:${latestAssistant.id}`
    setProtocolAlertKey(alertKey)
  }, [activeGame.id, latestAssistant?.id, protocolAnomaly])

  useEffect(() => {
    if (viewedStatusCharacterId && !visibleStatusActors.some((actor) => actor.character.id === viewedStatusCharacterId)) {
      setViewedStatusCharacterId(null)
    }
  }, [viewedStatusCharacterId, visibleStatusActors])

  function updateGame(gameId: string, updater: (game: GameSession) => GameSession) {
    setGames((current) => current.map((game) => game.id === gameId ? updater(game) : game))
  }

  function selectGame(gameId: string) {
    if (busy || summarizingMemory) return
    setActiveGameId(gameId)
    setSegmentPositions((current) => {
      if (current[gameId] !== undefined) return current
      const game = games.find((item) => item.id === gameId)
      if (!game) return current
      const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
      const parsed = parseAssistantResponse(latest?.rawContent ?? latest?.content ?? '', { characters: game.characters, narrativeModes: game.narrativeModes })
      return { ...current, [gameId]: completedTurnPlaybackIndex(parsed.segments.length, parsed.choices.length) }
    })
    setSelectedChoices([])
    setCustomInput('')
    setError('')
    setGameDrawerOpen(false)
  }

  function reorderGames(gameId: string, direction: 'up' | 'down') {
    setGames((current) => {
      const index = current.findIndex((game) => game.id === gameId)
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [game] = next.splice(index, 1)
      next.splice(targetIndex, 0, game)
      return next
    })
  }

  async function createGame(
    title: string,
    importSource: RpgboxImportSource | null,
    onPortraitProgress?: (completed: number, total: number) => void,
  ) {
    const blank = createBlankGame(games.length + 1, configuredProvider)
    const imported = importSource ? await importRpgbox(importSource, blank, { onPortraitProgress }) : blank
    const game = {
      ...imported,
      title: title.trim() || importSource?.name.replace(/\.rpgbox$/iu, '').trim() || blank.title,
      updatedAt: Date.now(),
    }
    setGames((current) => [...current, game])
    setActiveGameId(game.id)
    const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
    const parsed = parseAssistantResponse(latest?.content ?? '', { characters: game.characters, narrativeModes: game.narrativeModes })
    setSegmentPositions((current) => ({ ...current, [game.id]: completedTurnPlaybackIndex(parsed.segments.length, parsed.choices.length) }))
    setSelectedChoices([])
    setCustomInput('')
    setGameDrawerOpen(false)
  }

  async function importPreset(key: string, onPortraitProgress?: (completed: number, total: number) => void) {
    const imported = await importBundledRpg(key, configuredProvider, onPortraitProgress)
    const game = { ...imported.game, updatedAt: Date.now() }
    const nextGames = [...games, game]
    const nextImportedKeys = Array.from(new Set([...bundledRpgImportKeys, imported.key]))
    await saveState({ providers, activeProviderId, globalJailbreakPrompt, games: nextGames, activeGameId: game.id, bundledRpgImportKeys: nextImportedKeys })
    setGames(nextGames)
    setActiveGameId(game.id)
    setBundledRpgImportKeys(nextImportedKeys)
    const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
    const parsed = parseAssistantResponse(latest?.content ?? '', { characters: game.characters, narrativeModes: game.narrativeModes })
    setSegmentPositions((current) => ({ ...current, [game.id]: completedTurnPlaybackIndex(parsed.segments.length, parsed.choices.length) }))
    setSelectedChoices([])
    setCustomInput('')
  }

  async function deleteGame(gameId: string) {
    const target = games.find((game) => game.id === gameId)
    if (!target) return
    await Promise.all(target.characters.flatMap((character) => character.portraits.map((portrait) => deletePortraitFile(portrait.uri))))
    const remaining = games.filter((game) => game.id !== gameId)
    setGames(remaining)
    if (activeGameId === gameId) {
      setActiveGameId(remaining[0]?.id ?? '')
      setSelectedChoices([])
      setCustomInput('')
    }
  }

  async function cloneGame(gameId: string) {
    const source = games.find((game) => game.id === gameId)
    if (!source) return
    const id = newId('game')
    const baseTitle = `${source.title} 副本`
    const title = games.some((game) => game.title === baseTitle) ? `${baseTitle} ${games.length + 1}` : baseTitle
    const clone = await cloneGameSession(source, id, title)
    setGames((current) => [...current, clone])
    setActiveGameId(clone.id)
    setSegmentPositions((current) => ({ ...current, [clone.id]: segmentPositions[source.id] ?? 0 }))
    setSelectedChoices([])
    setCustomInput('')
    setGameDrawerOpen(false)
  }

  async function exportGame(gameId: string, options: RpgExportOptions) {
    const game = games.find((item) => item.id === gameId)
    if (!game) throw new Error('找不到要导出的 RPG')
    return exportRpgbox(game, options)
  }

  function updateRpgMetadata(gameId: string, title: string) {
    updateGame(gameId, (game) => ({
      ...game,
      title: title.trim() || '未命名RPG',
      updatedAt: Date.now(),
    }))
  }

  function advanceSegment() {
    if (!canAdvance) return
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: segmentIndex + 1 }))
  }

  function rewindSegment() {
    if (busy || (!choicesVisible && segmentIndex <= 0)) return
    setSegmentPositions((current) => ({
      ...current,
      [activeGame.id]: choicesVisible ? Math.max(0, latestParsed.segments.length - 1) : segmentIndex - 1,
    }))
  }

  function resetStory() {
    setViewedStatusCharacterId(null)
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    updateGame(activeGame.id, (game) => ({
      ...game,
      messages: [],
      gameState: { location: '未知之地', time: '序章', contentMode: defaultNarrativeModeId(game), values: {} },
      narrative: {
        chapter: { id: `chapter-${stamp}`, title: '', startedAtMessageId: '' },
        chapterPhase: 'opening',
      },
      memory: normalizeMemoryState(undefined),
      characters: game.characters.map((character) => ({ ...character, statusBar: '' })),
      rollbackLog: [],
      updatedAt: Date.now(),
    }))
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: 0 }))
    setManualDisplayContentModes((current) => ({ ...current, [activeGame.id]: undefined }))
    setSelectedChoices([])
    setCustomInput('')
    setError('')
    setGameSettingsOpen(false)
    setHistoryOpen(false)
  }

  function toggleChoice(choice: Choice) {
    setSelectedChoices((current) => current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id].sort())
  }

  function changeRpgState(contentMode: PortraitGroup) {
    setRpgStateMenuOpen(false)
    if (busy) return
    setManualDisplayContentModes((current) => ({ ...current, [activeGame.id]: contentMode }))
    if (contentMode === activeGame.gameState.contentMode) return
    updateGame(activeGame.id, (game) => ({
      ...game,
      gameState: { ...game.gameState, contentMode },
      updatedAt: Date.now(),
    }))
  }

  function rollbackTurn() {
    if (busy || summarizingMemory) return
    const inputDraft = rollbackInputDraft(activeGame)
    const restoredGame = restoreLastRollback(activeGame)
    if (!restoredGame) return
    setViewedStatusCharacterId(null)
    setManualDisplayContentModes((current) => ({ ...current, [activeGame.id]: undefined }))
    const messages = restoredGame.messages
    const latest = [...messages].reverse().find((message) => message.role === 'assistant')
    const restored = parseAssistantResponse(latest?.content ?? '', { characters: activeGame.characters, narrativeModes: activeGame.narrativeModes })
    updateGame(activeGame.id, (game) => ({
      ...game,
      messages,
      gameState: restoredGame.gameState,
      narrative: restoredGame.narrative,
      memory: restoredGame.memory,
      characters: restoredGame.characters,
      rollbackLog: restoredGame.rollbackLog,
      updatedAt: Date.now(),
    }))
    setSegmentPositions((current) => ({
      ...current,
      [activeGame.id]: completedTurnPlaybackIndex(restored.segments.length, restored.choices.length),
    }))
    setSelectedChoices(inputDraft.selectedChoiceIds)
    setCustomInput(inputDraft.customInput)
    setError('')
  }

  function chapterMessages(game: GameSession, messages: ChatMessage[], chapterTitle = game.narrative.chapter.title, sourceMessageIds?: string[]) {
    if (sourceMessageIds?.length) {
      const sourceIds = new Set(sourceMessageIds)
      return messages.filter((message) => sourceIds.has(message.id))
    }
    if (chapterTitle !== game.narrative.chapter.title) {
      return messages.filter((message) => message.chapterTitle === chapterTitle)
    }
    const start = messages.findIndex((message) => message.id === game.narrative.chapter.startedAtMessageId)
    const range = start >= 0 ? messages.slice(start) : messages
    return range.filter((message) => message.chapterTitle === undefined || message.chapterTitle === chapterTitle)
  }

  function memoryTranscript(messages: ChatMessage[]) {
    return messages.map((message) => {
      if (message.role === 'user') return `用户指令：${message.content}`
      const parsed = parseAssistantResponse(message.content)
      const story = parsed.segments.map((segment) => segment.type === 'dialogue'
        ? `${segment.characterName || segment.characterId || '角色'}：${segment.text}`
        : segment.text).join('\n')
      return `剧情：${story}`
    }).join('\n\n')
  }

  async function summarizeChapterMemory(
    game: GameSession,
    sourceMessages: ChatMessage[],
    chapterTitle: string,
    signal: AbortSignal,
    options: { sourceMessageIds?: string[]; existingSummary?: string; experienceTargets?: CharacterProfile[]; onDebug?: (entry: MemorySummaryDebugEntry) => void } = {},
  ) {
    if (!activeProvider || !chapterTitle.trim()) return undefined
    const transcript = memoryTranscript(chapterMessages(game, sourceMessages, chapterTitle, options.sourceMessageIds))
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    const messages = [
      { role: 'system' as const, content: CHAPTER_SUMMARY_SYSTEM_PROMPT },
      { role: 'user' as const, content: `章节名称：${chapterTitle}${formatCharacterExperienceSummaryTargets(options.experienceTargets)}\n\n已有的本章摘要（仅在内容确实是剧情摘要时参考；若包含网页、代码、任务分析或其他无关内容则完全忽略）：\n${(options.existingSummary ?? currentChapterSummary(game.memory)) || '无'}${formatAdditionalMemorySummaryInstructions(game.memory.chapterSummaryInstructions)}\n\n本章剧情：\n${transcript || '无可用剧情记录'}` },
    ]
    const debugRequest = buildChapterSummaryDebugRequest(chapterTitle, game.memory.chapterSummaryInstructions, options.experienceTargets)
    const responses: string[] = []
    let usage: CompletionUsage | undefined
    options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, debugRequest, responses, usage))
    try {
      const rawSummary = await streamCompletion({
        provider,
        signal,
        messages,
        onUsage: (next) => { usage = next },
      })
      responses.push(rawSummary)
      options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, debugRequest, responses, usage))
      const summary = normalizeMemorySummaryOutput(rawSummary)
      if (isValidChapterSummary(summary)) return summary
      throw new Error('模型返回了空的章节摘要')
    } catch (error) {
      const message = toErrorMessage(error)
      options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, debugRequest, responses, usage, message))
      throw error
    }
  }

  async function summarizeDistantMemory(existing: string, chapters: ChapterMemory[], signal: AbortSignal, additionalInstructions = '', onDebug?: (entry: MemorySummaryDebugEntry) => void) {
    if (!activeProvider) return undefined
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    const messages = [
      { role: 'system' as const, content: DISTANT_SUMMARY_SYSTEM_PROMPT },
      { role: 'user' as const, content: `既有远期记忆：\n${existing || '无'}${formatAdditionalMemorySummaryInstructions(additionalInstructions)}\n\n移出的旧章节：\n${chapters.map((chapter) => `章节：${chapter.title}\n${chapter.summary}`).join('\n\n') || '无，仅整理既有远期记忆'}` },
    ]
    const debugRequest = buildDistantSummaryDebugRequest(additionalInstructions)
    const responses: string[] = []
    let usage: CompletionUsage | undefined
    onDebug?.(formatMemorySummaryDebug('远期记忆整理', debugRequest, responses, usage))
    try {
      const rawSummary = await streamCompletion({
        provider,
        signal,
        messages,
        onUsage: (next) => { usage = next },
      })
      responses.push(rawSummary)
      onDebug?.(formatMemorySummaryDebug('远期记忆整理', debugRequest, responses, usage))
      const summary = normalizeMemorySummaryOutput(rawSummary)
      if (isValidDistantSummary(summary)) return summary
      throw new Error('模型返回了空的远期记忆')
    } catch (error) {
      const message = toErrorMessage(error)
      onDebug?.(formatMemorySummaryDebug('远期记忆整理', debugRequest, responses, usage, message))
      throw error
    }
  }

  async function summarizeCharacterExperiences(
    game: GameSession,
    chapterTitle: string,
    targets: CharacterExperienceTarget[],
    chapterSource: string,
    signal: AbortSignal,
    options: { onDebug?: (entry: MemorySummaryDebugEntry) => void } = {},
  ) {
    if (!activeProvider || !chapterTitle.trim()) return undefined
    const memory = normalizeMemoryState(game.memory)
    if (!memory.characterExperienceEnabled) return undefined
    if (!targets.length || !chapterSource.trim()) return undefined
    const userPrompt = buildCharacterExperienceUserPrompt(chapterTitle, targets, chapterSource, memory.characterExperienceInstructions)
    const request = `===== SYSTEM =====\n${CHARACTER_EXPERIENCE_SYSTEM_PROMPT}\n\n===== USER（整理要求与章节材料）=====\n${userPrompt}`
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1200, activeProvider.maxTokens) }
    let usage: CompletionUsage | undefined
    options.onDebug?.(formatMemorySummaryDebug(`角色经历整理：${chapterTitle}`, request, [], usage))
    let raw = ''
    try {
      raw = await streamCompletion({
        provider,
        signal,
        messages: [
          { role: 'system', content: CHARACTER_EXPERIENCE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        onUsage: (next) => { usage = next },
      })
      options.onDebug?.(formatMemorySummaryDebug(`角色经历整理：${chapterTitle}`, request, [raw], usage))
      const parsed = parseCharacterExperienceResponse(raw, targets)
      return { ...parsed, characterNames: targets.map(({ character }) => character.name) }
    } catch (error) {
      options.onDebug?.(formatMemorySummaryDebug(`角色经历整理：${chapterTitle}`, request, raw ? [raw] : [], usage, toErrorMessage(error)))
      throw Object.assign(new Error(toErrorMessage(error)), { characterNames: targets.map(({ character }) => character.name) })
    }
  }

  async function summarizeCharacterExperiencesNow(chapter: ChapterMemory, characterIds: string[]) {
    if (busy || summarizingMemory || !activeProvider || !chapter.summary.trim()) return
    const memory = normalizeMemoryState(activeGame.memory)
    if (!memory.characterExperienceEnabled) return
    const selectedIds = new Set(characterIds)
    const targets: CharacterExperienceTarget[] = activeGame.characters
      .filter((character) => character.role === 'npc' && selectedIds.has(character.id))
      .map((character) => ({ character, existingExperience: characterExperience(memory, character.id) }))
    if (!targets.length) return
    const operationId = `experience:${chapter.id}`
    setSummarizingMemory(operationId)
    setError('')
    const debugMessageId = [...activeGame.messages].reverse().find((message) => message.role === 'assistant')?.id
    const updateExperienceDebug = debugMessageId
      ? (entry: MemorySummaryDebugEntry) => updateGame(activeGame.id, (game) => ({
          ...game,
          messages: game.messages.map((message) => {
            if (message.id !== debugMessageId) return message
            const existing = Array.isArray(message.memorySummaryDebug) ? message.memorySummaryDebug : []
            return {
              ...message,
              memorySummaryDebug: [...existing.filter((item) => item.label !== entry.label), entry],
            }
          }),
          updatedAt: Date.now(),
        }))
      : undefined
    try {
      const result = await summarizeCharacterExperiences(
        activeGame,
        chapter.title,
        targets,
        chapter.summary.trim(),
        new AbortController().signal,
        { onDebug: updateExperienceDebug },
      )
      if (result) {
        updateGame(activeGame.id, (game) => ({
        ...game,
        memory: {
          ...normalizeMemoryState(game.memory),
          characterExperiences: { ...normalizeMemoryState(game.memory).characterExperiences, ...result.experiences },
        },
        updatedAt: Date.now(),
        }))
        if (result.missingCharacterNames.length) setError(`角色经历手工抽取部分完成。以下角色经历未能从章节记忆中抽取，请手工补充：${result.missingCharacterNames.join('、')}`)
      }
    } catch (summaryError) {
      setError(`角色经历手工抽取失败：${toErrorMessage(summaryError)}`)
    } finally {
      setSummarizingMemory(null)
    }
  }

  async function summarizeMemoryNow(kind: 'chapter' | 'history', completedChapter?: ChapterMemory) {
    if (busy || summarizingMemory || !activeProvider) return
    const memorySettings = normalizeMemoryState(activeGame.memory)
    if (kind === 'chapter' && !memorySettings.chapterMemoryEnabled) return
    if (kind === 'history' && !memorySettings.distantMemoryEnabled) return
    const archivedForDistant = pendingDistantChapterMemories(memorySettings)
    if (kind === 'history' && !memorySettings.historicalSummary.trim() && !archivedForDistant.length) {
      setError('没有可整理的远期记忆或已归档主记忆')
      return
    }
    const archivedDistantIds = new Set(archivedForDistant.map((chapter) => chapter.id))
    const operationId = completedChapter?.id ?? kind
    setSummarizingMemory(operationId)
    setError('')
    const debugMessageId = [...activeGame.messages].reverse().find((message) => message.role === 'assistant')?.id
    const updateManualSummaryDebug = debugMessageId
      ? (entry: MemorySummaryDebugEntry) => updateGame(activeGame.id, (game) => ({
          ...game,
          messages: game.messages.map((message) => message.id === debugMessageId
            ? { ...message, memorySummaryDebug: [entry] }
            : message),
          updatedAt: Date.now(),
        }))
      : undefined
    try {
      const signal = new AbortController().signal
      const result = kind === 'chapter'
        ? await summarizeChapterMemory(
          activeGame,
          activeGame.messages,
          completedChapter?.title ?? activeGame.narrative.chapter.title,
          signal,
          completedChapter
            ? { sourceMessageIds: completedChapter.sourceMessageIds, existingSummary: completedChapter.summary, onDebug: updateManualSummaryDebug }
            : { onDebug: updateManualSummaryDebug },
        )
        : await summarizeDistantMemory(memorySettings.historicalSummary, archivedForDistant, signal, memorySettings.distantSummaryInstructions, updateManualSummaryDebug)
      if (result) updateGame(activeGame.id, (game) => ({
        ...game,
        memory: kind === 'chapter'
          ? completedChapter
            ? {
              ...normalizeMemoryState(game.memory),
              recentChapters: recentChapterMemories(normalizeMemoryState(game.memory)).map((chapter) => chapter.id === completedChapter.id
                ? { ...chapter, summary: result }
                : chapter),
            }
            : { ...normalizeMemoryState(game.memory), currentChapterSummary: result }
          : {
            ...normalizeMemoryState(game.memory),
            historicalSummary: result,
            pendingDistantChapterIds: normalizeMemoryState(game.memory).pendingDistantChapterIds
              ?.filter((id) => !archivedDistantIds.has(id)),
          },
        updatedAt: Date.now(),
      }))
    } catch (summaryError) {
      setError(`手工总结失败：${toErrorMessage(summaryError)}`)
    } finally {
      setSummarizingMemory(null)
    }
  }

  async function continueTruncatedResponse() {
    if (busy || summarizingMemory || !activeProvider) return
    const gameSnapshot = activeGame
    const completion = inspectLatestResponseCompletion(gameSnapshot)
    const assistantIndex = gameSnapshot.messages.map((message) => message.role).lastIndexOf('assistant')
    const assistantMessage = gameSnapshot.messages[assistantIndex]
    const userMessage = gameSnapshot.messages[assistantIndex - 1]
    if (!completion.canContinue || completion.complete || !assistantMessage || userMessage?.role !== 'user') return

    const requestGlobalJailbreakPrompt = resolveGlobalJailbreakPrompt(
      globalJailbreakPrompt,
      bundledDefaultPrompt || await loadBundledDefaultPrompt(),
    )
    const gameId = gameSnapshot.id
    const submittedManualDisplayContentMode = manualDisplayContentModes[gameId]
    const continuationContentMode = assistantMessage.rpgStateId ?? gameSnapshot.gameState.contentMode
    const continuationInitialContentMode = assistantMessage.initialRpgStateId ?? continuationContentMode
    const parseContext = {
      characters: gameSnapshot.characters,
      contentMode: continuationContentMode,
      initialContentMode: continuationInitialContentMode,
      narrativeModes: gameSnapshot.narrativeModes,
      treatMalformedLinesAsNarration: gameSnapshot.aiSettings.treatMalformedLinesAsNarration,
    }
    const originalRaw = normalizeProtocolResponse(assistantMessage.rawContent ?? assistantMessage.content, parseContext)
    const continuationPromptInitialMode = parseAssistantResponse(originalRaw, parseContext).narrativeModeSwitchIndexes.length
      ? continuationContentMode
      : continuationInitialContentMode
    const apiHistory = gameSnapshot.messages.map((message) => message.role === 'assistant'
      ? {
          ...message,
          content: normalizeAssistantMessageForContext(
            message.id === assistantMessage.id ? originalRaw : normalizeProtocolResponse(message.rawContent ?? message.content, parseContext),
            gameSnapshot.characters,
            message.rpgStateId ?? continuationContentMode,
            message.initialRpgStateId ?? message.rpgStateId ?? continuationContentMode,
            gameSnapshot.narrativeModes,
          ),
        }
      : message)
    const continuationCharacters = selectTurnPortraitCharacters(
      gameSnapshot,
      [],
      [],
      userMessage.content,
      gameSnapshot.narrative.chapterPhase !== 'active',
    )
    const continuationCharacterProfiles = buildTurnCharacterProfiles(
      continuationCharacters,
      continuationContentMode,
      continuationPromptInitialMode,
      gameSnapshot.narrativeModes,
      normalizeMemoryState(gameSnapshot.memory).characterExperiences,
      normalizeMemoryState(gameSnapshot.memory).characterExperienceEnabled,
    )
    const continuationContext = buildTurnNarrativeContext(
      gameSnapshot,
      buildTurnStateInstruction(continuationPromptInitialMode, false, gameSnapshot.narrativeModes),
      buildChapterProgressInstruction(gameSnapshot),
    )
    const continuationOutputContract = buildTurnOutputContract({
      ...gameSnapshot,
      characters: continuationCharacters,
      gameState: { ...gameSnapshot.gameState, contentMode: continuationContentMode },
    }, continuationPromptInitialMode, gameSnapshot.narrative.chapterPhase === 'transition', true, gameSnapshot.narrative.chapterPhase === 'transition')
    const continuationGameSnapshot = {
      ...gameSnapshot,
      gameState: { ...gameSnapshot.gameState, contentMode: continuationContentMode },
    }
    const continuationInstruction: ChatMessage = {
      id: newId('continuation'),
      role: 'user',
      content: responseContinuationInstruction(completion),
      initialRpgStateId: continuationInitialContentMode,
      rpgStateId: continuationContentMode,
      createdAt: Date.now(),
    }
    const continuationDynamicInstructions = buildTurnDynamicInstructions({
      context: continuationContext,
      characters: continuationCharacterProfiles,
    })
    const compatiblePromptFormat = gameSnapshot.aiSettings.useCompatiblePromptFormat ?? true
    const continuationApiMessages = buildRpgTurnApiMessages({
      systemPrompt: buildSystemPrompt(continuationGameSnapshot, requestGlobalJailbreakPrompt, continuationPromptInitialMode),
      conversation: [...takeRecentConversationTurns(apiHistory, gameSnapshot.aiSettings.contextTurns), continuationInstruction],
      dynamicInstructions: continuationDynamicInstructions,
      outputContract: continuationOutputContract,
      compatible: compatiblePromptFormat,
    })
    const continuationRequestContent = buildTurnRequestDebugContent({
      input: continuationInstruction.content,
      dynamicInstructions: continuationDynamicInstructions,
      outputContract: continuationOutputContract,
      compatible: compatiblePromptFormat,
    })
    const continuationRequestSegments = buildRpgTurnDebugSegments(continuationApiMessages, compatiblePromptFormat)
    const controller = new AbortController()
    abortRef.current = controller
    setViewedStatusCharacterId(null)
    setManualDisplayContentModes((current) => ({ ...current, [gameId]: undefined }))
    setError('')
    setContinuingResponse(true)
    setBusy(true)
    let continuationSpliceOffset: number | undefined
    let soughtContinuationSplice = false
    let continuationUsage: CompletionUsage | undefined
    const seekToContinuationSplice = (mergedRaw: string, spliceOffset: number) => {
      if (soughtContinuationSplice) return
      const firstContinuationLineEnd = mergedRaw.indexOf('\n', spliceOffset)
      const spliceSegmentIndex = Math.max(0, parseAssistantResponse(
        mergedRaw.slice(0, firstContinuationLineEnd < 0 ? mergedRaw.length : firstContinuationLineEnd + 1),
        parseContext,
      ).segments.length - 1)
      soughtContinuationSplice = true
      setSegmentPositions((current) => ({ ...current, [gameId]: spliceSegmentIndex }))
    }

    try {
      const continuation = await streamCompletion({
        provider: activeProvider,
        messages: continuationApiMessages,
        signal: controller.signal,
        onUsage: (usage) => { continuationUsage = usage },
        onToken: (content) => {
          const merge = mergeContinuationResponseResult(originalRaw, content, {
            spliceOffset: continuationSpliceOffset,
          })
          if (merge.aligned && merge.spliceOffset !== undefined) {
            continuationSpliceOffset = merge.spliceOffset
            seekToContinuationSplice(merge.text, merge.spliceOffset)
          }
          updateGame(gameId, (game) => ({
            ...game,
            messages: game.messages.map((message) => message.id === assistantMessage.id
              ? { ...message, content: standardResponse(merge.text, parseContext), rawContent: merge.text }
              : message),
            updatedAt: Date.now(),
          }))
        },
      })
      const finalMerge = mergeContinuationResponseResult(originalRaw, continuation, {
        final: true,
        spliceOffset: continuationSpliceOffset,
      })
      if (finalMerge.aligned && finalMerge.spliceOffset !== undefined) {
        seekToContinuationSplice(finalMerge.text, finalMerge.spliceOffset)
      }
      const mergedRaw = finalMerge.text
      const parsed = parseAssistantResponse(mergedRaw, parseContext)
      const responseHasVisibleContent = hasCompleteVisibleContent(mergedRaw, parseContext, true)
      const responseCommitsContentMode = responseHasVisibleContent || parsed.choices.length > 0
      const namingAuthorized = continuationRequestContent.includes(CHAPTER_NAMING_INSTRUCTION)
      const acceptedNewChapter = acceptNewChapterTitle(parsed.newChapterTitle, namingAuthorized)
      const turnChapter = acceptedNewChapter || assistantMessage.chapterTitle || gameSnapshot.narrative.chapter.title
      const statusUpdates = gameSnapshot.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()

      updateGame(gameId, (game) => ({
        ...game,
        messages: game.messages.map((message) => {
          if (message.id === assistantMessage.id) return {
            ...message,
            content: standardResponse(mergedRaw, parseContext),
            rawContent: mergedRaw,
            chapterTitle: turnChapter,
            inputTokens: continuationUsage ? (message.inputTokens ?? 0) + continuationUsage.inputTokens : message.inputTokens,
            outputTokens: continuationUsage ? (message.outputTokens ?? 0) + continuationUsage.outputTokens : message.outputTokens,
          }
          if (message.id === userMessage.id) return {
            ...message,
            chapterTitle: turnChapter,
            requestContent: continuationRequestContent,
            requestSegments: continuationRequestSegments,
          }
          return message
        }),
        gameState: {
          ...applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch),
          contentMode: responseCommitsContentMode ? continuationContentMode : game.gameState.contentMode,
        },
        characters: statusUpdates.size
          ? game.characters.map((character) => statusUpdates.has(character.id)
            ? { ...character, statusBar: statusUpdates.get(character.id) }
            : character)
          : game.characters,
        narrative: acceptedNewChapter
          ? { chapter: { id: newId('chapter'), title: acceptedNewChapter, startedAtMessageId: userMessage.id }, chapterPhase: 'active' }
          : game.narrative,
        updatedAt: Date.now(),
      }))
    } catch (continuationError) {
      if (!controller.signal.aborted) {
        setError(`补全失败：${toErrorMessage(continuationError)}`)
        if (submittedManualDisplayContentMode) setManualDisplayContentModes((current) => ({ ...current, [gameId]: submittedManualDisplayContentMode }))
      }
    } finally {
      setBusy(false)
      setContinuingResponse(false)
      abortRef.current = null
    }
  }

  async function repairLatestResponseFormat() {
    if (busy || summarizingMemory || !activeProvider) return
    const originalGame = activeGame
    const rollbackSnapshot = originalGame.rollbackLog?.at(-1)
    const originalAssistant = originalGame.messages.at(-1)
    const originalUser = originalGame.messages.at(-2)
    const rawResponse = originalAssistant?.role === 'assistant'
      ? (originalAssistant.rawContent ?? originalAssistant.content)
      : ''
    if (!rollbackSnapshot
      || rollbackSnapshot.messageCount !== originalGame.messages.length - 2
      || originalUser?.role !== 'user'
      || originalAssistant?.role !== 'assistant'
      || !originalUser.requestSegments?.length
      || !rawResponse.trim()) {
      setError('当前轮缺少完整的请求记录或回退记录，无法尝试修正格式。')
      return
    }
    const restoredGame = restoreLastRollback(originalGame)
    if (!restoredGame) return

    const gameId = originalGame.id
    const previousSegmentPosition = rawSegmentIndex
    const initialContentMode = originalAssistant.initialRpgStateId ?? restoredGame.gameState.contentMode
    const resolvedContentMode = originalAssistant.rpgStateId ?? initialContentMode
    const repairApiMessages = buildFormatRepairApiMessages(
      originalUser.requestSegments,
      originalUser.content,
      rawResponse,
    )
    const repairRequestSegments: DebugPromptSegment[] = repairApiMessages.map((message, index) => ({
      title: index === repairApiMessages.length - 2
        ? '待修正的 LLM 原文'
        : index === repairApiMessages.length - 1
          ? '本轮格式修正指令'
          : message.role === 'system' ? '原轮规则' : '原轮兼容格式规则',
      role: message.role,
      content: message.content,
    }))
    const repairedUser: ChatMessage = {
      ...originalUser,
      requestContent: FORMAT_REPAIR_INSTRUCTION,
      requestSegments: repairRequestSegments,
      createdAt: Date.now(),
    }
    const pendingAssistant: ChatMessage = {
      id: originalAssistant.id,
      role: 'assistant',
      content: '',
      initialRpgStateId: initialContentMode,
      rpgStateId: resolvedContentMode,
      createdAt: Date.now(),
    }
    const requestMessages = [...restoredGame.messages, repairedUser]
    const replacementRollback = createRollbackSnapshot(restoredGame, newId('rollback'))
    const controller = new AbortController()
    abortRef.current = controller
    sceneAnnouncementPendingMessageRef.current = pendingAssistant.id
    narrativeModeFlashPendingMessageRef.current = pendingAssistant.id
    setViewedStatusCharacterId(null)
    setError('')
    setBusy(true)
    setLlmSpecialInstructionsOpen(false)
    setSegmentPositions((current) => ({ ...current, [gameId]: 0 }))
    setManualDisplayContentModes((current) => ({ ...current, [gameId]: undefined }))
    updateGame(gameId, () => ({
      ...restoredGame,
      messages: [...requestMessages, pendingAssistant],
      rollbackLog: appendRollbackSnapshot(restoredGame.rollbackLog, replacementRollback),
      updatedAt: Date.now(),
    }))

    const responseParseContext = {
      characters: restoredGame.characters,
      contentMode: resolvedContentMode,
      initialContentMode,
      narrativeModes: restoredGame.narrativeModes,
      treatMalformedLinesAsNarration: restoredGame.aiSettings.treatMalformedLinesAsNarration,
    }
    try {
      let completionUsage: CompletionUsage | undefined
      const fullText = await streamCompletion({
        provider: activeProvider,
        messages: repairApiMessages,
        signal: controller.signal,
        onUsage: (usage) => { completionUsage = usage },
        onToken: (content) => {
          updateGame(gameId, (game) => ({
            ...game,
            messages: [...requestMessages, { ...pendingAssistant, content: standardResponse(content, responseParseContext), rawContent: content }],
            updatedAt: Date.now(),
          }))
        },
      })
      const parsed = parseAssistantResponse(fullText, responseParseContext)
      const responseHasVisibleContent = hasCompleteVisibleContent(fullText, responseParseContext, true)
      const responseCommitsContentMode = responseHasVisibleContent || parsed.choices.length > 0
      const namingAuthorized = originalUser.requestContent?.includes(CHAPTER_NAMING_INSTRUCTION) ?? false
      const acceptedNewChapter = acceptNewChapterTitle(parsed.newChapterTitle, namingAuthorized)
      const enteredTransition = originalGame.narrative.chapterPhase === 'transition'
        && restoredGame.narrative.chapterPhase !== 'transition'
      const turnChapter = enteredTransition ? '' : acceptedNewChapter || restoredGame.narrative.chapter.title
      const nextNarrative = enteredTransition || acceptedNewChapter ? {
        chapter: { id: newId('chapter'), title: turnChapter, startedAtMessageId: repairedUser.id },
        chapterPhase: enteredTransition ? 'transition' as const : 'active' as const,
      } : restoredGame.narrative
      const statusUpdates = restoredGame.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()
      const completedUser = { ...repairedUser, chapterTitle: turnChapter }
      const completedAssistant: ChatMessage = {
        ...pendingAssistant,
        content: standardResponse(fullText, responseParseContext),
        rawContent: fullText,
        chapterTitle: turnChapter,
        inputTokens: completionUsage?.inputTokens,
        outputTokens: completionUsage?.outputTokens,
      }
      updateGame(gameId, (game) => ({
        ...game,
        messages: [...restoredGame.messages, completedUser, completedAssistant],
        gameState: {
          ...applyRpgStatePatch(restoredGame.gameState, parsed.gameData?.statePatch),
          contentMode: responseCommitsContentMode ? resolvedContentMode : restoredGame.gameState.contentMode,
          ...(enteredTransition ? { presentCharacterIds: [] } : {}),
        },
        characters: enteredTransition && (restoredGame.clearStatusBarAfterChapter ?? true)
          ? restoredGame.characters.map((character) => ({ ...character, statusBar: '' }))
          : statusUpdates.size
            ? restoredGame.characters.map((character) => statusUpdates.has(character.id)
              ? { ...character, statusBar: statusUpdates.get(character.id) }
              : character)
            : restoredGame.characters,
        narrative: nextNarrative,
        memory: enteredTransition ? originalGame.memory : restoredGame.memory,
        updatedAt: Date.now(),
      }))
    } catch (repairError) {
      if (!controller.signal.aborted) {
        setError(`格式修正失败：${toErrorMessage(repairError)}`)
        updateGame(gameId, () => originalGame)
        setSegmentPositions((current) => ({ ...current, [gameId]: previousSegmentPosition }))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function sendTurn(forcedInput?: string) {
    const choiceText = selectedChoices.join('')
    const supplement = customInput.trim()
    const input = forcedInput?.trim() || [choiceText, supplement].filter(Boolean).join('，但是')
    if (!input || busy || summarizingMemory || !activeProvider) return
    const requestGlobalJailbreakPrompt = resolveGlobalJailbreakPrompt(
      globalJailbreakPrompt,
      bundledDefaultPrompt || await loadBundledDefaultPrompt(),
    )
    setViewedStatusCharacterId(null)

    const gameId = activeGame.id
    const gameSnapshot = activeGame
    const forcedChapterEnd = forcedInput?.trim() === CLOSE_CHAPTER_INSTRUCTION
    const selectedChapterEnd = !forcedInput && selectedChoiceEndsChapter(latestParsed.choices, selectedChoices)
    const requestsChapterEnd = forcedChapterEnd || selectedChapterEnd
    const endsChapter = gameSnapshot.narrative.chapterPhase === 'active'
      && Boolean(gameSnapshot.narrative.chapter.title.trim())
      && requestsChapterEnd
    const restartsChapterTransition = gameSnapshot.narrative.chapterPhase === 'transition' && forcedChapterEnd
    const startsNewTransition = endsChapter || restartsChapterTransition
    const initialContentMode = gameSnapshot.gameState.contentMode
    const resolvedContentMode = resolveTurnContentMode(
      initialContentMode,
      rpgStateLocked,
      latestParsed.choices,
      forcedInput ? [] : selectedChoices,
      startsNewTransition,
      defaultNarrativeModeId(gameSnapshot),
    )
    const startsOpeningTransition = gameSnapshot.narrative.chapterPhase === 'opening'
    const entersTransition = startsNewTransition || startsOpeningTransition
    const turnGameSnapshot = {
      ...gameSnapshot,
      gameState: { ...gameSnapshot.gameState, contentMode: resolvedContentMode },
    }
    const requestChapterSnapshot = entersTransition ? {
      ...turnGameSnapshot,
      narrative: {
        chapter: { id: gameSnapshot.narrative.chapter.id, title: '', startedAtMessageId: gameSnapshot.narrative.chapter.startedAtMessageId },
        chapterPhase: 'transition' as const,
      },
    } : turnGameSnapshot
    const submittedSelectedChoices = forcedInput ? [] : [...selectedChoices]
    const submittedCustomInput = forcedInput ? '' : supplement
    const submittedSpecialInstructions = llmSpecialInstructions
    const submittedRpgStateLocked = rpgStateLocked
    const submittedManualDisplayContentMode = manualDisplayContentModes[gameId]
    const previousSegmentPosition = rawSegmentIndex
    setError('')
    setBusy(true)
    setCustomInput('')
    setSelectedChoices([])
    setSegmentPositions((current) => ({ ...current, [gameId]: 0 }))
    setManualDisplayContentModes((current) => ({ ...current, [gameId]: undefined }))
    const controller = new AbortController()
    abortRef.current = controller

    const userMessage: ChatMessage = {
      id: newId('user'),
      role: 'user',
      content: input,
      selectedChoiceIds: submittedSelectedChoices,
      customInput: submittedCustomInput,
      rpgStateId: resolvedContentMode,
      createdAt: Date.now(),
    }
    const pendingAssistant: ChatMessage = {
      id: newId('assistant'), role: 'assistant', content: '',
      initialRpgStateId: initialContentMode, rpgStateId: resolvedContentMode, createdAt: Date.now(),
    }
    sceneAnnouncementPendingMessageRef.current = pendingAssistant.id
    narrativeModeFlashPendingMessageRef.current = pendingAssistant.id
    const requestsNewChapterName = !startsNewTransition && shouldRequestNewChapterName(turnGameSnapshot)
    const turnInstructions = buildTurnInstructions(turnGameSnapshot, startsNewTransition, llmSpecialInstructions.preferEroticChoices)
    const specialInstructionText = buildLlmSpecialInstructionText(turnGameSnapshot, llmSpecialInstructions)
    const stateInstructionText = buildTurnStateInstruction(initialContentMode, rpgStateLocked, turnGameSnapshot.narrativeModes)
    const chapterInstructionText = buildChapterProgressInstruction(requestChapterSnapshot)
    const narrativeContext = buildTurnNarrativeContext(requestChapterSnapshot, stateInstructionText, chapterInstructionText)
    const turnPortraitCharacters = selectTurnPortraitCharacters(
      turnGameSnapshot,
      latestParsed.choices,
      forcedInput ? [] : selectedChoices,
      forcedInput ? forcedInput : supplement,
      entersTransition,
    )
    const outputContract = buildTurnOutputContract({ ...turnGameSnapshot, characters: turnPortraitCharacters }, initialContentMode, entersTransition, false, entersTransition)
    const characterProfiles = buildTurnCharacterProfiles(
      turnPortraitCharacters,
      resolvedContentMode,
      initialContentMode,
      turnGameSnapshot.narrativeModes,
      normalizeMemoryState(turnGameSnapshot.memory).characterExperiences,
      normalizeMemoryState(turnGameSnapshot.memory).characterExperienceEnabled,
    )
    const dynamicInstructions = buildTurnDynamicInstructions({
      context: narrativeContext,
      characters: characterProfiles,
      special: specialInstructionText,
      turn: turnInstructions.join('\n'),
    })
    const requestContent = buildTurnRequestDebugContent({
      input,
      dynamicInstructions,
      outputContract,
      compatible: gameSnapshot.aiSettings.useCompatiblePromptFormat ?? true,
    })
    setLlmSpecialInstructions(EMPTY_LLM_SPECIAL_INSTRUCTIONS)
    setLlmSpecialInstructionsOpen(false)
    setRpgStateLocked(false)
    const parseContext = { characters: gameSnapshot.characters, narrativeModes: gameSnapshot.narrativeModes, treatMalformedLinesAsNarration: gameSnapshot.aiSettings.treatMalformedLinesAsNarration }
    const normalizedHistory = gameSnapshot.messages.map((message) => message.role === 'assistant'
      ? {
          ...message,
          content: normalizeAssistantMessageForContext(
            normalizeProtocolResponse(message.rawContent ?? message.content, parseContext),
            gameSnapshot.characters,
            message.rpgStateId ?? gameSnapshot.gameState.contentMode,
            message.initialRpgStateId ?? message.rpgStateId ?? gameSnapshot.gameState.contentMode,
            gameSnapshot.narrativeModes,
          ),
        }
      : message)
    const apiRequestMessages = [
      ...normalizedHistory,
      { ...userMessage, content: input },
    ]
    const compatiblePromptFormat = gameSnapshot.aiSettings.useCompatiblePromptFormat ?? true
    const turnApiMessages = buildRpgTurnApiMessages({
      systemPrompt: buildSystemPrompt(turnGameSnapshot, requestGlobalJailbreakPrompt, initialContentMode),
      conversation: takeRecentConversationTurns(apiRequestMessages, gameSnapshot.aiSettings.contextTurns),
      dynamicInstructions,
      outputContract,
      compatible: compatiblePromptFormat,
    })
    const requestSegments = buildRpgTurnDebugSegments(turnApiMessages, compatiblePromptFormat)
    const storedUserMessage = { ...userMessage, requestContent, requestSegments }
    const requestMessages = [...gameSnapshot.messages, storedUserMessage]
    const rollbackSnapshot = createRollbackSnapshot(gameSnapshot, newId('rollback'))
    updateGame(gameId, (game) => ({
      ...game,
      narrative: entersTransition ? requestChapterSnapshot.narrative : game.narrative,
      messages: [...requestMessages, pendingAssistant],
      rollbackLog: appendRollbackSnapshot(game.rollbackLog, rollbackSnapshot),
      updatedAt: Date.now(),
    }))

    try {
      let completionUsage: CompletionUsage | undefined
      const responseParseContext = {
        characters: gameSnapshot.characters,
        contentMode: resolvedContentMode,
        initialContentMode,
        narrativeModes: gameSnapshot.narrativeModes,
        treatMalformedLinesAsNarration: gameSnapshot.aiSettings.treatMalformedLinesAsNarration,
      }
      const fullText = await streamCompletion({
        provider: activeProvider,
        messages: turnApiMessages,
        signal: controller.signal,
        onUsage: (usage) => { completionUsage = usage },
        onToken: (content) => {
          updateGame(gameId, (game) => ({
            ...game,
            messages: [...requestMessages, { ...pendingAssistant, content: standardResponse(content, responseParseContext), rawContent: content }],
            updatedAt: Date.now(),
          }))
        },
      })
      const rawContent = fullText
      const parsed = parseAssistantResponse(fullText, responseParseContext)
      const responseHasVisibleContent = hasCompleteVisibleContent(fullText, responseParseContext, true)
      const responseCommitsContentMode = responseHasVisibleContent || parsed.choices.length > 0
      const previousChapter = gameSnapshot.narrative.chapter.title.trim()
      const acceptedNewChapter = acceptNewChapterTitle(parsed.newChapterTitle, requestsNewChapterName)
      const turnChapter = entersTransition ? '' : acceptedNewChapter || previousChapter
      const chapterChanged = entersTransition || Boolean(acceptedNewChapter)
      const chapterClosed = endsChapter
      const completedUser = { ...storedUserMessage, chapterTitle: turnChapter }
      const normalizedContent = standardResponse(fullText, responseParseContext)
      const completedAssistant = {
        ...pendingAssistant,
        content: normalizedContent,
        rawContent,
        chapterTitle: turnChapter,
        inputTokens: completionUsage?.inputTokens,
        outputTokens: completionUsage?.outputTokens,
      }
      const completeMessages = [...gameSnapshot.messages, completedUser, completedAssistant]
      const nextNarrative = chapterChanged ? {
        chapter: {
          id: newId('chapter'),
          title: turnChapter,
          startedAtMessageId: completedUser.id,
        },
        chapterPhase: entersTransition ? 'transition' as const : 'active' as const,
      } : gameSnapshot.narrative
      const normalizedMemory = normalizeMemoryState(gameSnapshot.memory)
      const draftSummary = currentChapterSummary(normalizedMemory).trim()
      const closedChapterMessages = chapterClosed
        ? chapterMessages(gameSnapshot, gameSnapshot.messages, previousChapter)
        : []
      const pendingChapterMemory: ChapterMemory | undefined = chapterClosed ? {
        id: gameSnapshot.narrative.chapter.id,
        title: previousChapter,
        summary: draftSummary,
        completedAt: Date.now(),
        sourceMessageIds: closedChapterMessages.map((message) => message.id),
      } : undefined
      const memoryAfterBoundary = chapterClosed ? {
        ...normalizedMemory,
        currentChapterSummary: '',
      } : normalizedMemory
      const statusUpdates = gameSnapshot.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()
      updateGame(gameId, (game) => ({
        ...game,
        messages: completeMessages,
        gameState: {
          ...applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch),
          contentMode: responseCommitsContentMode ? resolvedContentMode : game.gameState.contentMode,
          ...(chapterClosed ? { presentCharacterIds: [] } : {}),
        },
        characters: chapterClosed && (gameSnapshot.clearStatusBarAfterChapter ?? true)
          ? game.characters.map((character) => ({ ...character, statusBar: '' }))
          : statusUpdates.size
          ? game.characters.map((character) => statusUpdates.has(character.id)
            ? { ...character, statusBar: statusUpdates.get(character.id) }
            : character)
          : game.characters,
        narrative: nextNarrative,
        memory: memoryAfterBoundary,
        updatedAt: Date.now(),
      }))
      if (chapterClosed) {
        const summaryController = new AbortController()
        const memoryOperationId = `auto-memory:${gameSnapshot.narrative.chapter.id}`
        setAutoMemoryFeedback(null)
        setSummarizingMemory(memoryOperationId)
        void (async () => {
          let chapterSummaryDebug: MemorySummaryDebugEntry | undefined
          let experienceDebug: MemorySummaryDebugEntry | undefined
          let distantSummaryDebug: MemorySummaryDebugEntry | undefined
          const errors: string[] = []
          const updateSummaryDebug = (entries: MemorySummaryDebugEntry[]) => {
            updateGame(gameId, (game) => ({
              ...game,
              messages: game.messages.map((message) => message.id === completedAssistant.id
                ? { ...message, memorySummaryDebug: entries }
                : message),
              updatedAt: Date.now(),
            }))
          }
          try {
            const sourceMessages = chapterMessages(gameSnapshot, gameSnapshot.messages, previousChapter, pendingChapterMemory?.sourceMessageIds)
            const experienceTargets = normalizedMemory.characterExperienceEnabled
              ? chapterExperienceTargets(sourceMessages, gameSnapshot.characters, normalizedMemory.characterExperiences, gameSnapshot.aiSettings.treatMalformedLinesAsNarration)
              : []
            let summary: string | undefined
            if (normalizedMemory.chapterMemoryEnabled) {
              try {
                summary = await summarizeChapterMemory(gameSnapshot, gameSnapshot.messages, previousChapter, summaryController.signal, {
                  sourceMessageIds: pendingChapterMemory?.sourceMessageIds,
                  existingSummary: draftSummary,
                  experienceTargets: experienceTargets.map(({ character }) => character),
                  onDebug: (entry) => { chapterSummaryDebug = entry; updateSummaryDebug([entry, ...(experienceDebug ? [experienceDebug] : []), ...(distantSummaryDebug ? [distantSummaryDebug] : [])]) },
                })
              } catch (summaryError) {
                errors.push(experienceTargets.length
                  ? `章节已切换，但上一章节总结失败，因此角色经历也未生成：${toErrorMessage(summaryError)}`
                  : `章节已切换，但上一章节总结失败：${toErrorMessage(summaryError)}`)
              }
            }
            let archived = archivedChapterMemories(normalizedMemory)
            let archivedForDistant = pendingDistantChapterMemories(normalizedMemory)
            if (summary) {
              const completedChapter: ChapterMemory = {
                id: gameSnapshot.narrative.chapter.id,
                title: previousChapter,
                summary,
                completedAt: Date.now(),
                sourceMessageIds: pendingChapterMemory?.sourceMessageIds,
              }
              const recent = [...recentChapterMemories(normalizedMemory).filter((chapter) => chapter.id !== completedChapter.id), completedChapter]
              const { overflow, retained } = partitionRecentChapterMemories(recent, normalizedMemory.recentChapterLimit)
              archived = mergeChapterMemories(archived, overflow)
              archivedForDistant = mergeChapterMemories(archivedForDistant, overflow)
              updateGame(gameId, (game) => ({
                ...game,
                memory: {
                  ...normalizeMemoryState(game.memory),
                  recentChapters: retained,
                  archivedChapters: archived,
                  pendingDistantChapterIds: archivedForDistant.map((chapter) => chapter.id),
                },
                updatedAt: Date.now(),
              }))
            }
            let experienceResult: Awaited<ReturnType<typeof summarizeCharacterExperiences>>
            if (experienceTargets.length && summary) {
              try {
                experienceResult = await summarizeCharacterExperiences(
                  gameSnapshot,
                  previousChapter,
                  experienceTargets,
                  summary,
                  summaryController.signal,
                  { onDebug: (entry) => { experienceDebug = entry; updateSummaryDebug([...(chapterSummaryDebug ? [chapterSummaryDebug] : []), entry, ...(distantSummaryDebug ? [distantSummaryDebug] : [])]) } },
                )
              } catch (experienceError) {
                const names = (experienceError as Error & { characterNames?: string[] }).characterNames
                errors.push(`章节已切换，但角色经历整理失败${names?.length ? `（${names.join('、')}）` : ''}。本次经历未写入，请前往“记忆 → 角色经历”手工录入。`)
              }
            }
            if (experienceResult) {
              updateGame(gameId, (game) => ({
                ...game,
                memory: { ...normalizeMemoryState(game.memory), characterExperiences: { ...normalizeMemoryState(game.memory).characterExperiences, ...experienceResult.experiences } },
                updatedAt: Date.now(),
              }))
              if (experienceResult.missingCharacterNames.length) {
                errors.push(`章节已切换，但以下角色经历未能从章节记忆中抽取，请手工补充：${experienceResult.missingCharacterNames.join('、')}`)
              }
            }
            if (archivedForDistant.length && normalizedMemory.distantMemoryEnabled) {
              const consumedIds = new Set(archivedForDistant.map((chapter) => chapter.id))
              try {
                const distant = await summarizeDistantMemory(normalizedMemory.historicalSummary, archivedForDistant, summaryController.signal, normalizedMemory.distantSummaryInstructions, (entry) => {
                  distantSummaryDebug = entry
                  updateSummaryDebug([...(chapterSummaryDebug ? [chapterSummaryDebug] : []), ...(experienceDebug ? [experienceDebug] : []), entry])
                })
                if (distant) {
                  updateGame(gameId, (game) => {
                    const memory = normalizeMemoryState(game.memory)
                    return {
                      ...game,
                      memory: {
                        ...memory,
                        historicalSummary: distant,
                        pendingDistantChapterIds: memory.pendingDistantChapterIds?.filter((id) => !consumedIds.has(id)),
                      },
                      updatedAt: Date.now(),
                    }
                  })
                }
              } catch (distantError) {
                errors.push(`远期记忆整理失败，已归档主记忆仍保留，可稍后手工重试：${toErrorMessage(distantError)}`)
              }
            }
          } catch (memoryError) {
            errors.push(`记忆整理发生意外错误：${toErrorMessage(memoryError)}`)
          } finally {
            if (errors.length) setError(errors.join('\n'))
            setAutoMemoryFeedback({ key: Date.now(), status: errors.length ? 'error' : 'success' })
            setSummarizingMemory((current) => current === memoryOperationId ? null : current)
          }
        })()
      }
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(toErrorMessage(requestError))
        updateGame(gameId, (game) => ({ ...game, messages: gameSnapshot.messages, gameState: gameSnapshot.gameState, narrative: gameSnapshot.narrative, memory: gameSnapshot.memory, rollbackLog: gameSnapshot.rollbackLog ?? [], updatedAt: Date.now() }))
        setSegmentPositions((current) => ({ ...current, [gameId]: previousSegmentPosition }))
        setSelectedChoices(submittedSelectedChoices)
        setCustomInput(submittedCustomInput)
        setLlmSpecialInstructions(submittedSpecialInstructions)
        setRpgStateLocked(submittedRpgStateLocked)
        if (submittedManualDisplayContentMode) setManualDisplayContentModes((current) => ({ ...current, [gameId]: submittedManualDisplayContentMode }))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  if (!hydrated || games.length === 0) {
    const drawerProps: GameDrawerProps = {
      open: gameDrawerOpen,
      games,
      activeGameId,
      onClose: () => setGameDrawerOpen(false),
      onSelect: selectGame,
      onReorder: reorderGames,
      onCreate: createGame,
      onUpdateMetadata: updateRpgMetadata,
      onDelete: deleteGame,
      onClone: cloneGame,
      onExport: exportGame,
      bundledRpgPresets,
      bundledRpgImportKeys,
      onImportBundledRpg: importPreset,
      onOpenSettings: () => { setGameDrawerOpen(false); setGlobalSettingsOpen(true) },
      onStartOnboarding: () => {},
    }
    return <><EmptyLibraryScreen loading={!hydrated} onOpenLibrary={() => setGameDrawerOpen(true)} drawerProps={drawerProps} />{globalSettingsOpen && <GlobalSettingsDialog providers={providers} activeProviderId={activeProviderId} globalJailbreakPrompt={globalJailbreakPrompt} onClose={() => setGlobalSettingsOpen(false)} onChangeProviders={setProviders} onChangeActive={setActiveProviderId} onChangeGlobalJailbreakPrompt={setGlobalJailbreakPrompt} />}</>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button" data-onboarding-target="menu" onClick={() => setGameDrawerOpen(true)} title="RPG目录"><Menu size={21} /></button>
        <div className="brand-block"><span className="brand">RPGBox</span><span className="chapter">{displayChapterTitle || '章节间过渡'} · {activeGame.title}</span></div>
        <div className="topbar-actions">
          <button className="topbar-action-button" data-onboarding-target="settings" onClick={() => setGameSettingsOpen(true)} title={`RPG设置 · ${activeProvider?.model || activeProvider?.name || '未配置'}`}>{!hasUsableProvider && <span className="provider-warning-badge" aria-label="AI API 未完整配置">!</span>}<Server size={18} /><span>设置</span></button>
          <button className="topbar-action-button" data-onboarding-target="history" onClick={() => setHistoryOpen(true)} title="历史记录"><History size={18} /><span>历史</span></button>
          <button className={`topbar-action-button memory-action-button ${autoMemoryInProgress ? 'memory-processing' : autoMemoryFeedback ? `memory-${autoMemoryFeedback.status}` : ''}`} data-onboarding-target="memory" key={autoMemoryInProgress ? 'memory-processing' : `memory-${autoMemoryFeedback?.key ?? 0}`} onClick={() => setMemoryOpen(true)} disabled={autoMemoryInProgress} title={autoMemoryInProgress ? '正在自动整理记忆' : autoMemoryFeedback?.status === 'error' ? '自动记忆整理存在失败，请查看错误提示' : '主记忆与远期记忆'}>{autoMemoryInProgress ? <Hourglass className="memory-processing-hourglass" size={18} /> : <Brain size={18} />}<span>记忆</span></button>
          <button className="topbar-action-button" data-onboarding-target="rollback" onClick={() => setRollbackConfirmOpen(true)} disabled={busy || Boolean(summarizingMemory) || !(activeGame.rollbackLog?.length)} title={`回滚上一轮（可用 ${activeGame.rollbackLog?.length ?? 0} / 5）`}><RotateCcw size={18} /><span>撤回</span></button>
          <button className="topbar-action-button" data-onboarding-target="debug" onClick={() => setDebugOpen(true)} title="AI 原文 Debug"><Bug size={18} /><span>Debug</span></button>
          <button className={`topbar-action-button ${Object.values(llmSpecialInstructions).some(Boolean) ? 'special-instructions-pending' : ''}`} data-onboarding-target="instructions" onClick={() => setLlmSpecialInstructionsOpen(true)} disabled={busy} title="LLM特殊指令"><SlidersHorizontal size={18} /><span>指令</span></button>
        </div>
      </header>

      <main className="rpg-stage-shell">
        <div
          className={`rpg-stage ${choicesVisible ? 'selection' : currentSegment?.type === 'dialogue' ? 'dialogue' : 'narration'}`}
          role={canAdvance ? 'button' : undefined}
          tabIndex={canAdvance ? 0 : undefined}
          onClick={(event) => { if (protocolAlertKey) { event.stopPropagation(); setProtocolAlertKey(null); return } advanceSegment() }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') advanceSegment() }}
        >
          <div className="stage-context" aria-label="当前剧情状态">
            <span className="stage-context-item location"><MapPin size={14} /><strong>{displayGameState.location}</strong></span>
            <span className="stage-context-item"><Clock3 size={14} /><span>{displayGameState.time}</span></span>
            {activeNarrativeModes.length > 1 && <div ref={rpgStateControlsRef} className="rpg-state-controls" onClick={(event) => event.stopPropagation()}>
              <button type="button" className={`rpg-state-trigger ${narrativeModeFlashKey ? 'mode-changed' : ''}`} key={`${displayGameState.contentMode}:${narrativeModeFlashKey}`} style={{ '--narrative-mode-color': narrativeModeById(activeNarrativeModes, displayGameState.contentMode).color } as React.CSSProperties} disabled={busy} aria-expanded={rpgStateMenuOpen} aria-haspopup="menu" onClick={() => setRpgStateMenuOpen((open) => !open)} title="切换当前叙事模式">
                {rpgStateLocked && <Lock size={13} aria-label="本轮状态已锁定" />}
                <span>{narrativeModeById(activeNarrativeModes, displayGameState.contentMode).name}</span>
                <ChevronDown size={13} />
              </button>
              {rpgStateMenuOpen && <div className="rpg-state-menu" role="menu" aria-label="RPG 状态选择">
                <div className="rpg-state-options">
                  {activeNarrativeModes.map((mode) => <button type="button" role="menuitemradio" aria-checked={activeGame.gameState.contentMode === mode.id} className={activeGame.gameState.contentMode === mode.id ? 'active' : ''} style={{ '--narrative-mode-color': mode.color } as React.CSSProperties} key={mode.id} onClick={() => changeRpgState(mode.id)}><span>{mode.name}</span>{activeGame.gameState.contentMode === mode.id && <Check className="rpg-state-selected-check" size={14} />}</button>)}
                </div>
                <label className="rpg-state-lock-option">
                  <input type="checkbox" checked={rpgStateLocked} onChange={(event) => setRpgStateLocked(event.target.checked)} />
                  <span>本轮叙事模式锁定</span>
                </label>
              </div>}
            </div>}
          </div>
          {sceneAnnouncement && <div className="scene-announcement-zone" aria-live="polite" key={sceneAnnouncement.key}>
            <div className="scene-announcement">
              <strong>{sceneAnnouncement.location}</strong>
              <div>{sceneAnnouncement.characterIds.length ? sceneAnnouncement.characterIds.map((id, index) => {
                const character = activeGame.characters.find((item) => item.id === id)
                if (!character) return null
                return <span style={{ color: character.color }} key={id}>{index > 0 ? '、' : ''}{character.name}</span>
              }) : <span>无</span>}</div>
            </div>
          </div>}
          {(!hasUsableProvider || error || protocolAlertKey) && <div className="stage-alerts" aria-live="polite">
            {!hasUsableProvider && <div className="stage-alert error"><span>尚未设置LLM，请在左上角菜单的全局设置中设置可用的大语言模型AI接口</span></div>}
            {error && <div className="stage-alert error"><span>{error}</span><button onClick={(event) => { event.stopPropagation(); setError('') }} title="关闭错误提示"><X size={15} /></button></div>}
            {protocolAlertKey && <div key={protocolAlertKey} className="stage-alert protocol">LLM输出存在格式异常，可检查 <span className="alert-command">Debug-&gt;输出</span> 查看细节。建议继续下一轮对话前使用 <span className="alert-command">指令-&gt;尝试修正格式</span> 进行修复，或撤回重新输出。如果模型一直无法正确遵守格式，建议打开 <span className="alert-command">设置-&gt;错误格式以旁白处理</span> 开关。如不想再收到此提醒，可关闭 <span className="alert-command">设置-&gt;LLM输出不符合格式时提醒</span></div>}
          </div>}
          {choicesVisible ? (
            <ChoiceScene choices={latestParsed.choices} selectedChoices={selectedChoices} actors={choiceActors} characters={activeGame.characters} narrativeModes={activeNarrativeModes} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} characterExperiences={memoryForDisplay.characterExperiences ?? {}} characterExperienceEnabled={memoryForDisplay.characterExperienceEnabled ?? true} changedStatusCharacterIds={changedStatusIds} onToggle={toggleChoice} onCloseChapter={() => void sendTurn(CLOSE_CHAPTER_INSTRUCTION)} showContinuation={showChoiceContinuation} onContinue={() => void continueTruncatedResponse()} />
          ) : busy && currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} characterExperiences={memoryForDisplay.characterExperiences ?? {}} characterExperienceEnabled={memoryForDisplay.characterExperienceEnabled ?? true} streaming />
          ) : busy ? (
            <NarrationScene text={currentSegment?.text || '正在生成'} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} characterExperiences={memoryForDisplay.characterExperiences ?? {}} characterExperienceEnabled={memoryForDisplay.characterExperienceEnabled ?? true} streaming />
          ) : currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} characterExperiences={memoryForDisplay.characterExperiences ?? {}} characterExperienceEnabled={memoryForDisplay.characterExperienceEnabled ?? true} />
          ) : (
            <NarrationScene text={currentSegment?.text || '...'} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} characterExperiences={memoryForDisplay.characterExperiences ?? {}} characterExperienceEnabled={memoryForDisplay.characterExperienceEnabled ?? true} />
          )}
        </div>

        <footer className={`interaction-dock ${emptyRpg ? 'empty-rpg-mode' : inputVisible && !showProgressContinuation ? 'composer-mode' : 'playback-mode'}`}>
          {emptyRpg ? <div className="dock-main empty-rpg-dock"><button type="button" className="start-game-button" onClick={() => void sendTurn('开始新的一天')} disabled={!hasUsableProvider} title={!hasUsableProvider ? '请先完成 AI API 设置' : '开始游戏'}><Send size={18} />开始游戏</button></div> : <div className="dock-main">
            <button className="rewind-button" onClick={rewindSegment} disabled={busy || (!choicesVisible && segmentIndex <= 0)} title="返回上一段"><ChevronLeft size={21} /></button>
            {busy ? (
              <div className="playback-info">
                <div className="narrative-position">{displayChapterTitle || '章节间过渡'}-{displayChapterTurnCount}</div>
                <div className="generation-status" aria-live="polite">
                  <span>{streamingParsed.segments.length ? `${segmentIndex + 1} / ${streamingParsed.segments.length}` : '0 / 0'} · <span className="generation-label">{continuingResponse ? '补全中' : '生成中'}</span></span>
                  <button className="send-button stop" onClick={() => { abortRef.current?.abort(); setBusy(false) }} title="停止生成"><CircleStop size={20} /></button>
                </div>
              </div>
            ) : inputVisible && !showProgressContinuation ? (
              <div className="composer"><textarea value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendTurn() } }} placeholder={selectedChoices.length ? '补充行动（可选）' : '输入自定义行动'} rows={1} /><button className="send-button" onClick={() => void sendTurn()} disabled={!customInput.trim() && !selectedChoices.length} title="发送行动"><Send size={19} /></button></div>
            ) : (
              <div className="playback-info">
                <div className="narrative-position">{displayChapterTitle || '章节间过渡'}-{displayChapterTurnCount}</div>
                <div className="playback-status"><span>{latestParsed.segments.length ? `${segmentIndex + 1} / ${latestParsed.segments.length} · ${showProgressContinuation ? '输出不完整' : '完成'}` : '等待剧情'}</span>{showProgressContinuation && <button type="button" className="continue-response-button" onClick={() => void continueTruncatedResponse()}><RefreshCw size={14} />从截断处补全</button>}</div>
              </div>
            )}
          </div>}
        </footer>
      </main>

      <GameDrawer open={gameDrawerOpen} games={games} activeGameId={activeGame.id} onClose={() => setGameDrawerOpen(false)} onSelect={selectGame} onReorder={reorderGames} onCreate={createGame} onUpdateMetadata={updateRpgMetadata} onDelete={deleteGame} onClone={cloneGame} onExport={exportGame} bundledRpgPresets={bundledRpgPresets} bundledRpgImportKeys={bundledRpgImportKeys} onImportBundledRpg={importPreset} onOpenSettings={() => { setGameDrawerOpen(false); setGlobalSettingsOpen(true) }} onStartOnboarding={() => { setGameDrawerOpen(false); setOnboardingOpen(true) }} />
      {gameSettingsOpen && <GameSettingsDialog game={activeGame} games={games} providers={providers} fullSystemPrompt={buildSystemPrompt(activeGame, effectiveGlobalJailbreakPrompt)} onClose={() => setGameSettingsOpen(false)} onChange={(nextGame) => updateGame(activeGame.id, () => nextGame)} />}
      {globalSettingsOpen && <GlobalSettingsDialog providers={providers} activeProviderId={activeProviderId} globalJailbreakPrompt={globalJailbreakPrompt} onClose={() => setGlobalSettingsOpen(false)} onChangeProviders={setProviders} onChangeActive={setActiveProviderId} onChangeGlobalJailbreakPrompt={setGlobalJailbreakPrompt} />}
      {historyOpen && <HistoryDialog lines={historyLines} characters={activeGame.characters} onResetStory={resetStory} onClose={() => setHistoryOpen(false)} />}
      {debugOpen && <RawResponseDialog requestSegments={debugExchange.requestSegments} content={debugExchange.rawResponse} repairContent={debugExchange.repairContent} memorySummaryEntries={debugExchange.memorySummaryEntries} inputTokens={debugExchange.inputTokens} outputTokens={debugExchange.outputTokens} characters={activeGame.characters} contentMode={latestFinalContentMode} onClose={() => setDebugOpen(false)} />}
      {llmSpecialInstructionsOpen && <LlmSpecialInstructionsDialog value={llmSpecialInstructions} repairDisabled={busy || Boolean(summarizingMemory) || !activeProvider || !canRepairLatestResponse} onRepair={() => void repairLatestResponseFormat()} onChange={setLlmSpecialInstructions} onClose={() => setLlmSpecialInstructionsOpen(false)} />}
      {memoryOpen && <MemoryDialog game={activeGame} summarizing={summarizingMemory} actionsDisabled={busy || !activeProvider} onSummarize={summarizeMemoryNow} onSummarizeExperiences={summarizeCharacterExperiencesNow} onChange={(memory) => updateGame(activeGame.id, (game) => ({ ...game, memory, updatedAt: Date.now() }))} onClose={() => setMemoryOpen(false)} />}
      {rollbackConfirmOpen && <RollbackConfirmDialog onCancel={() => setRollbackConfirmOpen(false)} onConfirm={() => { setRollbackConfirmOpen(false); rollbackTurn() }} />}
      {onboardingPromptOpen && <OnboardingPrompt onAnswer={(accepted) => { setOnboardingPromptSeen(true); setOnboardingPromptOpen(false); void writeLocalFlag(ONBOARDING_PROMPT_SEEN_KEY); if (accepted) setOnboardingOpen(true) }} />}
      {onboardingOpen && <OnboardingGuide onFinish={() => setOnboardingOpen(false)} />}
    </div>
  )
}

function EmptyLibraryScreen({ loading, onOpenLibrary, drawerProps }: {
  loading: boolean
  onOpenLibrary: () => void
  drawerProps: GameDrawerProps
}) {
  return (
    <div className="app-shell empty-library-shell">
      <header className="topbar">
        <button className="icon-button" onClick={onOpenLibrary} title="RPG目录"><Menu size={21} /></button>
        <div className="brand-block"><span className="brand">RPGBox</span><span className="chapter">RPG 目录</span></div>
      </header>
      <main className="empty-library-main">
        {loading ? (
          <section className="library-state" aria-live="polite">
            <RefreshCw className="library-state-spinner" size={28} aria-hidden="true" />
            <h1>正在加载 RPG 数据</h1>
            <p>请稍候</p>
          </section>
        ) : (
          <section className="library-state">
            <BookOpen size={30} aria-hidden="true" />
            <h1>尚未创建 RPG</h1>
            <p>请创建或导入 RPG</p>
            <button type="button" className="primary-button" onClick={onOpenLibrary}><Menu size={17} />打开 RPG 目录</button>
          </section>
        )}
      </main>
      <GameDrawer {...drawerProps} />
    </div>
  )
}

function RollbackConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-layer" role="alertdialog" aria-modal="true" aria-labelledby="rollback-confirm-title" aria-describedby="rollback-confirm-description">
      <button className="backdrop" onClick={onCancel} aria-label="取消回滚" />
      <section className="modal rollback-confirm-modal">
        <div className="rollback-confirm-content">
          <AlertTriangle size={25} aria-hidden="true" />
          <div><h2 id="rollback-confirm-title">撤销最近一次对话？</h2><p id="rollback-confirm-description">确认后将撤销最近一轮用户指令和 AI 回复，并恢复当时的剧情状态。如有记忆变动，也会自动回滚。</p></div>
        </div>
        <div className="modal-footer"><span>此操作不会修改 RPG 设置或人物资料。</span><div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="danger-button rollback-confirm-button" onClick={onConfirm}><RotateCcw size={16} />确认撤销</button></div></div>
      </section>
    </div>
  )
}

type MemoryTab = 'primary' | 'distant' | 'experiences' | 'rules'

function MemoryDialog({ game, summarizing, actionsDisabled, onSummarize, onSummarizeExperiences, onChange, onClose }: {
  game: GameSession
  summarizing: string | null
  actionsDisabled: boolean
  onSummarize: (kind: 'chapter' | 'history', completedChapter?: ChapterMemory) => Promise<void>
  onSummarizeExperiences: (chapter: ChapterMemory, characterIds: string[]) => Promise<void>
  onChange: (memory: MemoryState) => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<MemoryTab>('primary')
  const [primaryView, setPrimaryView] = useState<'recent' | 'archived'>('recent')
  const [pendingAction, setPendingAction] = useState<{ kind: 'chapter'; chapter?: ChapterMemory } | { kind: 'history' } | { kind: 'experience' } | null>(null)
  const [experienceSummaryOpen, setExperienceSummaryOpen] = useState(false)
  const memory = normalizeMemoryState(game.memory)
  const recent = recentChapterMemories(memory)
  const archived = archivedChapterMemories(memory)
  const pendingArchivedIds = new Set(memory.pendingDistantChapterIds ?? [])
  const pendingArchivedCount = pendingArchivedIds.size
  const currentTitle = game.narrative.chapter.title.trim()
  const currentSummary = currentChapterSummary(memory)
  const hasCurrentMemory = Boolean(currentTitle && currentSummary.trim())

  function patchRecentChapter(id: string, summary: string) {
    onChange({
      ...memory,
      recentChapters: recent.map((chapter) => chapter.id === id ? { ...chapter, summary } : chapter),
    })
  }

  function removeRecentChapter(id: string) {
    onChange({
      ...memory,
      recentChapters: recent.filter((chapter) => chapter.id !== id),
    })
  }

  function patchArchivedChapter(id: string, summary: string) {
    onChange({
      ...memory,
      archivedChapters: archived.map((chapter) => chapter.id === id ? { ...chapter, summary } : chapter),
      pendingDistantChapterIds: Array.from(new Set([...(memory.pendingDistantChapterIds ?? []), id])),
    })
  }

  function removeArchivedChapter(id: string) {
    onChange({
      ...memory,
      archivedChapters: archived.filter((chapter) => chapter.id !== id),
      pendingDistantChapterIds: memory.pendingDistantChapterIds?.filter((chapterId) => chapterId !== id),
    })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="backdrop" onClick={onClose} aria-label="关闭" />
      <section className="modal memory-modal">
        <div className="modal-head"><div><span className="eyebrow">NARRATIVE MEMORY</span><h2>记忆</h2></div><button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button></div>
        <nav className="memory-tabs" aria-label="记忆分类">
          {([['primary', '主记忆'], ['distant', '远期记忆'], ['experiences', '角色经历'], ['rules', '记忆规则']] as const).map(([id, label]) => (
            <button type="button" className={activeTab === id ? 'active' : ''} aria-selected={activeTab === id} onClick={() => setActiveTab(id)} key={id}>{label}</button>
          ))}
        </nav>
        <div className="memory-tab-content">
          {activeTab === 'primary' && (!memory.chapterMemoryEnabled ? <div className="empty-memory">此功能未启用，请在“设置 → RPG规则 → 记忆规则”中启用。</div> : <section className="memory-primary-editor">
            <span className="memory-editor-head"><span className="memory-heading-group"><span>{primaryView === 'recent' ? <>主记忆 <small>{recent.length}/{memory.recentChapterLimit ?? 5}</small></> : <>已归档主记忆 <small>{archived.length}</small></>}</span>{archived.length > 0 && <button type="button" className="secondary-button compact memory-view-toggle" onClick={() => setPrimaryView((view) => view === 'recent' ? 'archived' : 'recent')}>{primaryView === 'recent' ? `查看已归档（${archived.length}）` : '返回主记忆'}</button>}</span>{primaryView === 'recent' && <button type="button" className="secondary-button compact" onClick={() => setPendingAction({ kind: 'chapter' })} disabled={Boolean(summarizing) || actionsDisabled || !currentTitle}><Brain size={14} />{summarizing === 'chapter' ? '总结中' : '总结当前章节'}</button>}</span>
            <p className="memory-capacity-note">{primaryView === 'recent' ? '这些记忆会随每次剧情请求发送。超出上限后，最早的章节会移入归档，并用于整理远期记忆。' : `这些记忆不会随剧情请求发送。${pendingArchivedCount ? `其中 ${pendingArchivedCount} 条正在等待整理进远期记忆。` : '当前归档均已整理进远期记忆。'}`}</p>
            <div className="recent-memory-list">
              {primaryView === 'recent' && <>{currentTitle ? <div className="memory-entry"><div className="memory-entry-head"><span>当前：{currentTitle}</span>{hasCurrentMemory && <button type="button" className="danger-icon memory-delete-button" onClick={() => onChange({ ...memory, currentChapterSummary: '' })} title={`删除“${currentTitle}”的主记忆`} aria-label={`删除“${currentTitle}”的主记忆`}><Trash2 size={15} /></button>}</div><DeferredTextarea aria-label={`${currentTitle}的当前章节记忆`} value={currentSummary} onCommit={(currentChapterSummary) => onChange({ ...memory, currentChapterSummary })} placeholder="当前章节尚未总结" /></div> : <div className="empty-memory">当前处于章节间过渡，不生成章节记忆。</div>}{recent.map((chapter) => <div className="memory-entry" key={chapter.id}><div className="memory-entry-head"><span>{chapter.title}</span><span className="memory-entry-actions"><button type="button" className="secondary-button compact" onClick={() => setPendingAction({ kind: 'chapter', chapter })} disabled={Boolean(summarizing) || actionsDisabled} title={`重新总结“${chapter.title}”`}><RefreshCw size={13} />{summarizing === chapter.id ? '总结中' : '重新总结'}</button><button type="button" className="danger-icon memory-delete-button" onClick={() => removeRecentChapter(chapter.id)} title={`删除“${chapter.title}”的主记忆`} aria-label={`删除“${chapter.title}”的主记忆`}><Trash2 size={15} /></button></span></div><DeferredTextarea aria-label={`${chapter.title}的章节记忆`} value={chapter.summary} onCommit={(summary) => patchRecentChapter(chapter.id, summary)} placeholder="自动总结失败时可手工编辑或重新总结" /></div>)}{!currentTitle && !recent.length && <div className="empty-memory">暂无主记忆。</div>}</>}
              {primaryView === 'archived' && archived.map((chapter) => <div className="memory-entry" key={chapter.id}><div className="memory-entry-head"><span>{chapter.title} <small className={pendingArchivedIds.has(chapter.id) ? 'memory-archive-pending' : 'memory-archive-processed'}>{pendingArchivedIds.has(chapter.id) ? '等待整理' : '已整理进远期记忆'}</small></span><button type="button" className="danger-icon memory-delete-button" onClick={() => removeArchivedChapter(chapter.id)} title={`删除归档“${chapter.title}”`} aria-label={`删除归档“${chapter.title}”`}><Trash2 size={15} /></button></div><DeferredTextarea aria-label={`${chapter.title}的归档主记忆`} value={chapter.summary} onCommit={(summary) => patchArchivedChapter(chapter.id, summary)} /></div>)}
            </div>
          </section>)}
          {activeTab === 'distant' && (!memory.distantMemoryEnabled ? <div className="empty-memory">此功能未启用，请在“设置 → RPG规则 → 记忆规则”中启用。</div> : <label className="distant-memory-editor"><span className="memory-editor-head"><span>远期记忆</span><button type="button" className="secondary-button compact" onClick={() => setPendingAction({ kind: 'history' })} disabled={Boolean(summarizing) || actionsDisabled || (!memory.historicalSummary.trim() && !pendingArchivedCount)}><Brain size={14} />{summarizing ? '记忆处理中' : pendingArchivedCount ? `整理归档（${pendingArchivedCount}）` : '压缩现有内容'}</button></span><DeferredTextarea value={memory.historicalSummary} onCommit={(historicalSummary) => onChange({ ...memory, historicalSummary })} placeholder="更早章节压缩后写入此处" /></label>)}
          {activeTab === 'experiences' && (!memory.characterExperienceEnabled ? <div className="empty-memory">此功能未启用，请在“设置 → RPG规则 → 记忆规则”中启用。</div> : <CharacterExperienceEditor game={game} memory={memory} summarizing={summarizing} onSummarize={onSummarizeExperiences} onChange={onChange} onRequestSummary={() => setPendingAction({ kind: 'experience' })} summaryOpen={experienceSummaryOpen} setSummaryOpen={setExperienceSummaryOpen} />)}
          {activeTab === 'rules' && <div className="memory-rules" aria-label="记忆整理规则">
            <section className="memory-rule-section">
              <h3>主记忆总结规则</h3>
              <div className="memory-default-rule"><span>内置系统提示词</span><div>{CHAPTER_SUMMARY_SYSTEM_PROMPT}</div></div>
              <label><span>追加要求</span><DeferredTextarea value={memory.chapterSummaryInstructions ?? ''} onCommit={(chapterSummaryInstructions) => onChange({ ...memory, chapterSummaryInstructions })} placeholder="例如：重点保留主角与各角色的关系变化（可留空）" /></label>
            </section>
            <section className="memory-rule-section">
              <h3>角色经历整理规则</h3>
              <div className="memory-default-rule"><span>内置系统提示词</span><div>{CHARACTER_EXPERIENCE_SYSTEM_PROMPT}</div></div>
              <label><span>追加要求</span><DeferredTextarea value={memory.characterExperienceInstructions ?? ''} onCommit={(characterExperienceInstructions) => onChange({ ...memory, characterExperienceInstructions })} placeholder="例如：重点保留与主角的承诺和关系转折（可留空）" /></label>
            </section>
            <section className="memory-rule-section">
              <h3>远期记忆总结规则</h3>
              <div className="memory-default-rule"><span>内置系统提示词</span><div>{DISTANT_SUMMARY_SYSTEM_PROMPT}</div></div>
              <label><span>追加要求</span><DeferredTextarea value={memory.distantSummaryInstructions ?? ''} onCommit={(distantSummaryInstructions) => onChange({ ...memory, distantSummaryInstructions })} placeholder="例如：优先保留会影响后续选择的承诺与情报（可留空）" /></label>
            </section>
          </div>}
        </div>
        <div className="modal-footer"><span>最近章节 {recent.length} / {memory.recentChapterLimit ?? 5} · 可回滚 {game.rollbackLog?.length ?? 0} 轮</span><button className="primary-button" onClick={onClose}>完成</button></div>
      </section>
      {pendingAction && <MemoryActionConfirmDialog action={pendingAction} onCancel={() => setPendingAction(null)} onConfirm={() => {
        const action = pendingAction
        setPendingAction(null)
        if (action.kind === 'experience') { setExperienceSummaryOpen(true); return }
        void onSummarize(action.kind === 'history' ? 'history' : 'chapter', action.kind === 'chapter' ? action.chapter : undefined)
      }} />}
    </div>
  )
}

function OnboardingPrompt({ onAnswer }: { onAnswer: (accepted: boolean) => void }) {
  return <div className="modal-layer onboarding-prompt-layer" role="alertdialog" aria-modal="true" aria-labelledby="onboarding-prompt-title"><button className="backdrop" onClick={() => onAnswer(false)} aria-label="暂不查看" /><section className="modal onboarding-prompt"><div className="modal-head"><div><span className="eyebrow">QUICK START</span><h2 id="onboarding-prompt-title">是否用30秒快速了解RPGBox？</h2></div></div><div className="onboarding-prompt-copy">艾莉西亚将带您快速认识主要功能。</div><div className="modal-footer"><span>之后可从RPG目录再次打开</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => onAnswer(false)}>否</button><button className="primary-button" onClick={() => onAnswer(true)}>是</button></div></div></section></div>
}
function MemoryActionConfirmDialog({ action, onCancel, onConfirm }: { action: { kind: 'chapter'; chapter?: ChapterMemory } | { kind: 'history' } | { kind: 'experience' }; onCancel: () => void; onConfirm: () => void }) {
  const experience = action.kind === 'experience'
  const title = experience ? '手工抽取经历' : action.kind === 'history' ? '压缩所有远期记忆？' : action.chapter ? `重新总结“${action.chapter.title}”？` : '总结当前章节？'
  const scenario = experience ? '章节结束后的自动角色经历抽取失败，或某个角色没有成功生成经历时使用。' : action.kind === 'history' ? '章节归档后的自动远期记忆整理失败，或远期记忆没有成功压缩时使用。' : '章节结束后的自动章节总结失败，或生成的章节摘要质量不符合预期时使用。'
  const input = experience ? '选择的章节摘要、选定 NPC 当前已有的角色经历。' : action.kind === 'history' ? '现有远期记忆、尚未整理的归档主记忆和远期记忆追加规则。' : '该章节的原始对话记录和现有章节摘要。'
  const output = experience ? '只更新选定 NPC 的角色经历；主记忆和远期记忆不会改变。' : action.kind === 'history' ? '用新的压缩结果替换远期记忆；归档章节仍会保留供查看，并标记为已整理。' : '只替换这一章的章节摘要，不会自动整理远期记忆或角色经历。'
  return <div className="modal-layer" role="alertdialog" aria-modal="true" aria-labelledby="memory-action-confirm-title"><button className="backdrop" onClick={onCancel} aria-label="取消" /><section className="modal memory-action-confirm-modal"><div className="modal-head"><div><span className="eyebrow">MEMORY ACTION</span><h2 id="memory-action-confirm-title">{title}</h2></div><button className="icon-button" onClick={onCancel} title="关闭"><X size={20} /></button></div><div className="memory-action-confirm-content"><p><strong>常用场景</strong>{scenario}</p><p><strong>发送给 LLM</strong>{input}</p><p><strong>LLM 返回后</strong>{output}</p><p>确认继续后才会调用 LLM，可以随时取消。</p></div><div className="modal-footer"><span>不会删除现有对话记录</span><div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={onCancel}>放弃</button><button type="button" className="primary-button" onClick={onConfirm}><Brain size={15} />{experience ? '继续选择' : '继续'}</button></div></div></section></div>
}

function CharacterExperienceEditor({ game, memory, summarizing, onSummarize, onChange, onRequestSummary, summaryOpen, setSummaryOpen }: { game: GameSession; memory: MemoryState; summarizing: string | null; onSummarize: (chapter: ChapterMemory, characterIds: string[]) => Promise<void>; onChange: (memory: MemoryState) => void; onRequestSummary: () => void; summaryOpen: boolean; setSummaryOpen: (open: boolean) => void }) {
  const entries = game.characters.filter((character) => Object.prototype.hasOwnProperty.call(memory.characterExperiences, character.id))
  const candidates = game.characters.filter((character) => !Object.prototype.hasOwnProperty.call(memory.characterExperiences, character.id))
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '')
  const [addId, setAddId] = useState(candidates[0]?.id ?? '')
  const currentSummary = currentChapterSummary(memory).trim()
  const currentTitle = game.narrative.chapter.title.trim()
  const availableChapters = [
    ...recentChapterMemories(memory),
    ...(currentTitle && currentSummary ? [{
      id: `current:${game.narrative.chapter.id}`,
      title: currentTitle,
      summary: currentSummary,
      completedAt: 0,
    }] : []),
  ].filter((chapter) => chapter.summary.trim())
  const npcs = game.characters.filter((character) => character.role === 'npc')
  useEffect(() => { if (!entries.some((character) => character.id === selectedId)) setSelectedId(entries[0]?.id ?? '') }, [entries, selectedId])
  useEffect(() => { if (!candidates.some((character) => character.id === addId)) setAddId(candidates[0]?.id ?? '') }, [candidates, addId])
  const selected = entries.find((character) => character.id === selectedId)
  return <section className="memory-primary-editor character-experience-editor">
    <span className="memory-editor-head"><span>角色经历</span><button type="button" className="secondary-button compact" disabled={Boolean(summarizing) || !availableChapters.length || !npcs.length} onClick={onRequestSummary} title={!availableChapters.length ? '暂无有内容的章节记忆' : '选择章节记忆和角色进行抽取'}><Brain size={14} />手工抽取经历</button></span>
    <p className="memory-capacity-note">这里只显示已有角色经历的角色。角色完成包含其足够出场内容的章节后才会生成经历，因此显示数量可能少于登场人物总数。</p>
    <div className="character-experience-editor-body">
      {candidates.length > 0 && <div className="memory-entry-actions character-experience-add-row">
        <select aria-label="选择要添加经历的角色" value={addId} onChange={(event) => setAddId(event.target.value)}>
          {candidates.map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}
        </select>
        <button type="button" className="secondary-button compact" onClick={() => {
          if (!addId) return
          onChange({ ...memory, characterExperiences: { ...memory.characterExperiences, [addId]: '' } })
          setSelectedId(addId)
        }}><Plus size={14} />添加角色经历</button>
      </div>}
      {!entries.length ? <div className="empty-memory">暂无角色经历，可从上方选择角色后手工添加。</div> : <div className="character-experience-content">
        <nav className="character-experience-tabs" aria-label="角色经历人物选择">{entries.map((character) => <button type="button" className={character.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(character.id)} key={character.id}>{character.name}</button>)}</nav>
        {selected && <label className="distant-memory-editor"><span className="memory-editor-head"><span>{selected.name}的角色经历</span></span><DeferredTextarea key={selected.id} value={characterExperience(memory, selected.id)} onCommit={(value) => onChange({ ...memory, characterExperiences: { ...memory.characterExperiences, [selected.id]: value } })} placeholder="手工记录该角色的重要经历、承诺和关系变化" /></label>}
      </div>}
    </div>
    {summaryOpen && <CharacterExperienceSummaryDialog chapters={availableChapters} characters={npcs} summarizing={summarizing} onCancel={() => setSummaryOpen(false)} onConfirm={async (chapter, characterIds) => { await onSummarize(chapter, characterIds); setSummaryOpen(false) }} />}
  </section>
}

function CharacterExperienceSummaryDialog({ chapters, characters, summarizing, onCancel, onConfirm }: { chapters: ChapterMemory[]; characters: CharacterProfile[]; summarizing: string | null; onCancel: () => void; onConfirm: (chapter: ChapterMemory, characterIds: string[]) => Promise<void> }) {
  const [chapterId, setChapterId] = useState(chapters[chapters.length - 1]?.id ?? '')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const chapter = chapters.find((item) => item.id === chapterId)
  const working = Boolean(summarizing)
  const toggleCharacter = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  return <div className="modal-layer character-experience-summary-layer" role="dialog" aria-modal="true" aria-labelledby="character-experience-summary-title">
    <button className="backdrop" onClick={working ? undefined : onCancel} aria-label="关闭" />
    <section className="modal character-experience-summary-modal">
      <div className="modal-head"><div><span className="eyebrow">CHARACTER EXPERIENCE</span><h2 id="character-experience-summary-title">手工抽取经历</h2></div><button className="icon-button" onClick={onCancel} disabled={working} title="关闭"><X size={20} /></button></div>
      <div className="character-experience-summary-content">
        <label><span>章节记忆</span><select value={chapterId} onChange={(event) => setChapterId(event.target.value)} disabled={working}>{chapters.map((item) => <option value={item.id} key={item.id}>{item.title}{item.id.startsWith('current:') ? '（当前章节）' : ''}</option>)}</select></label>
        <fieldset disabled={working}><legend>要总结的 NPC（可复选）</legend><div className="character-experience-summary-characters">{characters.map((character) => <label key={character.id}><input type="checkbox" checked={selectedIds.includes(character.id)} onChange={() => toggleCharacter(character.id)} /><span>{character.name}</span></label>)}</div></fieldset>
      </div>
      <div className="modal-footer"><span>将结合所选角色的已有经历重新整理。</span><div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={working}>取消</button><button type="button" className="primary-button" disabled={!chapter || !selectedIds.length || working} onClick={() => chapter && void onConfirm(chapter, selectedIds)}><Brain size={15} />{working ? '总结中' : '开始总结'}</button></div></div>
    </section>
  </div>
}

interface StatusViewProps {
  viewedStatusCharacterId: string | null
  onViewStatus: (characterId: string | null) => void
  statusRulesEnabled: boolean
  characterExperiences: Record<string, string>
  characterExperienceEnabled: boolean
}

function DialogueScene({ segment, characters, actors, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, characterExperiences, characterExperienceEnabled, streaming = false }: { segment: StorySegment; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean } & StatusViewProps) {
  const character = characters.find((item) => item.id === segment.characterId)
    ?? characters.find((item) => item.name === segment.characterName)
  const { portrait, displayExpression } = resolveCharacterExpression(character, segment.expression, mode)
  const color = character?.color || '#d3ab61'
  const speakerName = character?.role === 'player'
    ? `${character.name}（你）`
    : character?.name || segment.characterName || segment.characterId
  return (
    <StoryScene
      actors={actors.length ? actors : portrait && character ? [{ character, expression: segment.expression ?? '', position: 0, enteredAt: 0 }] : []}
      activeCharacterId={portrait ? character?.id : undefined}
      mode={mode}
      viewedStatusCharacterId={viewedStatusCharacterId}
      onViewStatus={onViewStatus}
      statusRulesEnabled={statusRulesEnabled}
      characterExperiences={characterExperiences}
      characterExperienceEnabled={characterExperienceEnabled}
    >
      <div className={`dialogue-box ${streaming ? 'streaming' : ''}`} style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 14%, rgba(18, 19, 17, 0.96))` }}>
        <div className="speaker-line"><strong style={{ color }}>{speakerName}</strong><span>{displayExpression}</span></div>
        <p><CharacterText text={segment.text} characters={characters} /></p>
      </div>
    </StoryScene>
  )
}

function NarrationScene({ text, characters, actors, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, characterExperiences, characterExperienceEnabled, streaming = false }: { text: string; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean } & StatusViewProps) {
  return (
    <StoryScene actors={actors} mode={mode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={onViewStatus} statusRulesEnabled={statusRulesEnabled} characterExperiences={characterExperiences} characterExperienceEnabled={characterExperienceEnabled}>
      <div className={`narration-panel ${streaming ? 'streaming' : ''}`}><p><CharacterText text={text} characters={characters} narration /></p></div>
    </StoryScene>
  )
}

function ChoiceScene({ choices, selectedChoices, actors, characters, narrativeModes, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, characterExperiences, characterExperienceEnabled, changedStatusCharacterIds, onToggle, onCloseChapter, showContinuation, onContinue }: { choices: Choice[]; selectedChoices: string[]; actors: StageActor[]; characters: CharacterProfile[]; narrativeModes: GameSession['narrativeModes']; mode: PortraitGroup; changedStatusCharacterIds: Set<string>; onToggle: (choice: Choice) => void; onCloseChapter: () => void; showContinuation: boolean; onContinue: () => void } & StatusViewProps) {
  return (
    <StoryScene actors={actors} mode={mode} className="choice-scene" viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={onViewStatus} statusRulesEnabled={statusRulesEnabled} characterExperiences={characterExperiences} characterExperienceEnabled={characterExperienceEnabled} changedStatusCharacterIds={changedStatusCharacterIds}>
      <section className="choice-overlay" aria-label="剧情选项" onClick={(event) => event.stopPropagation()}>
        <div className="selection-heading">
          {showContinuation && <button type="button" className="continue-response-button choice-continuation-button" onClick={onContinue}><RefreshCw size={14} />从截断处补全</button>}
          <div className="selection-prompt">请选择</div>
          <button type="button" className="close-chapter-button" onClick={onCloseChapter} title="要求 AI 收尾当前章节并推进新剧情"><Flag size={15} />收尾本章节</button>
        </div>
        <div className="choice-list">{choices.map((choice) => {
          const selected = selectedChoices.includes(choice.id)
          const endsChapter = choice.text.includes(CHAPTER_END_MARKER)
          const changesState = choice.targetContentMode && choice.targetContentMode !== mode
          const targetMode = choice.targetContentMode ? narrativeModeById(narrativeModes, choice.targetContentMode) : undefined
          return <button className={`choice-button ${selected ? 'selected' : ''}`} key={choice.id} onClick={() => onToggle(choice)}><span>{selected ? <Check size={15} /> : choice.id}</span><span className="choice-text"><CharacterText text={choiceActionText(choice.text)} characters={characters} />{(changesState || endsChapter) && <span className="choice-labels">{changesState && targetMode && <small className="choice-state-transition" style={{ '--narrative-mode-color': targetMode.color } as React.CSSProperties}>切换至 {targetMode.name}</small>}{endsChapter && <small className="choice-chapter-end">结束章节</small>}</span>}</span></button>
        })}</div>
      </section>
    </StoryScene>
  )
}

function StoryScene({ actors, activeCharacterId, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, characterExperiences, characterExperienceEnabled, changedStatusCharacterIds = new Set<string>(), className = '', children }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup; changedStatusCharacterIds?: Set<string>; className?: string; children: React.ReactNode } & StatusViewProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const lastTouchYRef = useRef(0)
  const dragDistanceRef = useRef(0)
  const suppressClickRef = useRef(false)

  function scrollTarget() {
    return contentRef.current?.querySelector<HTMLElement>('.narration-panel, .dialogue-box, .choice-list')
  }

  return (
    <div className={`story-scene ${className}`}>
      <div
        data-onboarding-target="portrait"
        className="portrait-zone"
        onTouchStart={(event) => {
          lastTouchYRef.current = event.touches[0]?.clientY ?? 0
          dragDistanceRef.current = 0
          suppressClickRef.current = false
        }}
        onTouchMove={(event) => {
          const currentY = event.touches[0]?.clientY
          if (currentY === undefined) return
          const delta = lastTouchYRef.current - currentY
          lastTouchYRef.current = currentY
          dragDistanceRef.current += Math.abs(delta)
          if (dragDistanceRef.current > 8) suppressClickRef.current = true
          const target = scrollTarget()
          if (target && target.scrollHeight > target.clientHeight) {
            target.scrollTop += delta
            event.preventDefault()
          }
        }}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return
          event.preventDefault()
          event.stopPropagation()
          suppressClickRef.current = false
        }}
      >
        <StagePortraits actors={actors} activeCharacterId={activeCharacterId} mode={mode} onViewStatus={onViewStatus} changedStatusCharacterIds={changedStatusCharacterIds} />
        {viewedStatusCharacterId && <CharacterStatusOverlay character={actors.find((actor) => actor.character.id === viewedStatusCharacterId)?.character} characterExperiences={characterExperiences} characterExperienceEnabled={characterExperienceEnabled} statusRulesEnabled={statusRulesEnabled} onClose={() => onViewStatus(null)} />}
      </div>
      <div className="content-zone" data-onboarding-target="content" ref={contentRef}>{children}</div>
    </div>
  )
}

function StagePortraits({ actors, activeCharacterId, mode, onViewStatus, changedStatusCharacterIds }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup; onViewStatus: (characterId: string) => void; changedStatusCharacterIds: Set<string> }) {
  // Keep the physical left/right slots stable; recency only controls stacking order.
  const visibleActors = actors.slice().sort((left, right) => left.position - right.position).flatMap((actor) => {
    const resolved = resolveCharacterExpression(actor.character, actor.expression, mode)
    return resolved.portrait ? [{ ...actor, portrait: resolved.portrait }] : []
  })
  const stackOrder = visibleActors
    .map((actor, index) => ({ id: actor.character.id, index, spokenAt: actor.lastSpokenAt ?? actor.enteredAt }))
    .sort((left, right) => left.spokenAt - right.spokenAt || left.index - right.index)
  const zIndexById = new Map(stackOrder.map((item, index) => [item.id, index + 1]))
  return (
    <div className={`stage-portrait-layer count-${visibleActors.length}`}>
      {visibleActors.map(({ character, portrait }, index) => {
        const active = activeCharacterId === character.id
        const inactive = Boolean(activeCharacterId) && !active
        return <div className={`stage-portrait slot-${index + 1} has-image ${active ? 'active' : ''} ${inactive ? 'inactive' : ''}`} key={character.id}>
          <img src={portraitSource(portrait.uri)} alt="" />
        </div>
      })}
      {visibleActors.map(({ character }, index) => (
        <div className={`character-status-control slot-${index + 1}`} style={{ zIndex: 100 + (zIndexById.get(character.id) ?? 1) }} key={`status-${character.id}`}>
          <button type="button" className={`character-status-button ${changedStatusCharacterIds.has(character.id) ? 'status-changed' : ''}`} onClick={(event) => { event.stopPropagation(); onViewStatus(character.id) }} title={`查看${character.name}的状态和经历`} aria-label={`查看${character.name}的状态和经历`}><ClipboardList size={18} /></button>
        </div>
      ))}
    </div>
  )
}

function CharacterStatusOverlay({ character, statusRulesEnabled, characterExperiences, characterExperienceEnabled, onClose }: { character?: CharacterProfile; statusRulesEnabled: boolean; characterExperiences: Record<string, string>; characterExperienceEnabled: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'status' | 'experience'>('status')
  if (!character) return null
  const status = character.statusBar?.trim()
  const experience = characterExperiences[character.id]?.trim() ?? ''
  return (
    <div className="character-status-overlay" onClick={(event) => { event.stopPropagation(); onClose() }} role="presentation">
      <section className="character-status-window" style={{ borderColor: character.color }} role="dialog" aria-label={`${character.name}的状态和经历`} onClick={(event) => event.stopPropagation()}>
        <header><span className="character-status-icon" style={{ color: character.color }}><ClipboardList size={19} /></span><strong style={{ color: character.color }}>{character.name}</strong><span className="character-status-tabs"><button type="button" className={tab === 'status' ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setTab('status') }}>状态</button><button type="button" className={tab === 'experience' ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setTab('experience') }}>经历</button></span></header>
        {tab === 'status' ? (statusRulesEnabled ? (status ? <div className="character-status-content">{status}</div> : <div className="character-status-empty">暂无状态记录</div>) : <div className="character-status-empty">状态栏功能未启用。</div>) : characterExperienceEnabled ? <div className="character-status-content">{experience}</div> : <div className="character-status-empty">角色经历功能未启用。</div>}
      </section>
    </div>
  )
}

function CharacterText({ text, characters, narration = false }: { text: string; characters: CharacterProfile[]; narration?: boolean }) {
  const tokens = narration ? tokenizeNarrationText(text, characters) : tokenizeCharacterNames(text, characters)
  return <>{tokens.map((token, index) => token.character
    ? <strong className="character-name-inline" style={{ color: token.character.color }} key={`${index}-${token.text}`}>{token.text}</strong>
    : token.text)}</>
}

function HistoryDialog({ lines, characters, onResetStory, onClose }: { lines: ReturnType<typeof buildHistoryLines>; characters: CharacterProfile[]; onResetStory: () => void; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [])

  function jumpToEdge(edge: 'top' | 'bottom') {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: edge === 'top' ? 0 : container.scrollHeight, behavior: 'smooth' })
  }

  function jumpTurn(direction: -1 | 1) {
    const container = scrollRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const offsets = Array.from(container.querySelectorAll<HTMLElement>('[data-turn-start="true"]')).map((element) =>
      Math.max(0, container.scrollTop + element.getBoundingClientRect().top - containerTop - 12),
    )
    const current = container.scrollTop
    const target = direction < 0
      ? [...offsets].reverse().find((offset) => offset < current - 10)
      : offsets.find((offset) => offset > current + 10)
    container.scrollTo({ top: target ?? (direction < 0 ? 0 : container.scrollHeight), behavior: 'smooth' })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="历史记录">
      <button className="backdrop" onClick={onClose} aria-label="关闭历史记录" />
      <section className="modal history-modal">
        <div className="modal-head">
          <div><span className="eyebrow">STORY LOG</span><div className="history-title-line"><h2>历史记录</h2><button className="danger-button history-reset-button" onClick={() => { if (window.confirm('清空本RPG的全部对话、历史记忆和场景状态，并使用当前设置重新开始？')) onResetStory() }}><Trash2 size={14} />清空剧情并重新开始</button></div></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button>
        </div>
        <div className="history-scroll" ref={scrollRef}>
          {lines.length ? lines.map((line) => {
            const character = line.type === 'dialogue'
              ? characters.find((item) => item.id === line.characterId) ?? characters.find((item) => item.name === line.speaker)
              : undefined
            const color = character?.color
            return <p className={`history-line ${line.type}`} data-turn-start={line.type === 'player' ? 'true' : undefined} key={line.id} style={color ? { color, borderLeftColor: color } : undefined}>
              {line.speaker && <strong style={color ? { color } : undefined}>{line.speaker}：</strong>}
              {line.type === 'narration' ? <CharacterText text={line.text} characters={characters} narration /> : line.text}
            </p>
          }) : <p className="history-empty">尚无历史内容</p>}
        </div>
        <nav className="history-jump-controls" aria-label="历史记录快速跳转">
          <button onClick={() => jumpToEdge('top')} title="跳到顶端"><ChevronsUp size={18} /></button>
          <button onClick={() => jumpTurn(-1)} title="上一轮对话"><ChevronUp size={18} /></button>
          <button onClick={() => jumpTurn(1)} title="下一轮对话"><ChevronDown size={18} /></button>
          <button onClick={() => jumpToEdge('bottom')} title="跳到底端"><ChevronsDown size={18} /></button>
        </nav>
      </section>
    </div>
  )
}

type DebugTab = 'input' | 'output' | 'memory' | 'experience'

function RawResponseDialog({ requestSegments, content, repairContent, memorySummaryEntries, inputTokens, outputTokens, characters, contentMode, onClose }: { requestSegments: DebugPromptSegment[]; content: string; repairContent?: string; memorySummaryEntries: MemorySummaryDebugEntry[]; inputTokens?: number; outputTokens?: number; characters: CharacterProfile[]; contentMode?: PortraitGroup; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<DebugTab>('input')
  const promptGroups = groupDebugPromptSegments(requestSegments)
  const experienceEntries = memorySummaryEntries.filter((entry) => entry.label.startsWith('角色经历整理：'))
  const memoryEntries = memorySummaryEntries.filter((entry) => !entry.label.startsWith('角色经历整理：'))
  const memoryInputTokens = memoryEntries.reduce<number | undefined>((total, entry) => entry.inputTokens === undefined ? total : (total ?? 0) + entry.inputTokens, undefined)
  const memoryOutputTokens = memoryEntries.reduce<number | undefined>((total, entry) => entry.outputTokens === undefined ? total : (total ?? 0) + entry.outputTokens, undefined)
  const memoryRequest = memoryEntries.map((entry) => `===== ${entry.label} =====\n${entry.request}`).join('\n\n')
  const memoryResponse = memoryEntries.map((entry) => `===== ${entry.label} =====\n${entry.response || '（尚未返回）'}`).join('\n\n')
  const experienceRequest = experienceEntries.map((entry) => `===== ${entry.label} =====\n${entry.request}`).join('\n\n')
  const experienceResponse = experienceEntries.map((entry) => `===== ${entry.label} =====\n${entry.response || '（尚未返回）'}`).join('\n\n')
  const anomalyIndexes = protocolAnomalyLineIndexes(content, { characters, contentMode })
  const anomalyRanges = protocolAnomalyExpressionRanges(content, { characters, contentMode })
  const shownInputTokens = activeTab === 'memory' ? memoryInputTokens : activeTab === 'experience' ? experienceEntries.reduce<number | undefined>((total, entry) => entry.inputTokens === undefined ? total : (total ?? 0) + entry.inputTokens, undefined) : inputTokens
  const shownOutputTokens = activeTab === 'memory' ? memoryOutputTokens : activeTab === 'experience' ? experienceEntries.reduce<number | undefined>((total, entry) => entry.outputTokens === undefined ? total : (total ?? 0) + entry.outputTokens, undefined) : outputTokens
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="对话 Debug">
      <button className="backdrop" onClick={onClose} aria-label="关闭对话 Debug" />
      <section className="modal debug-modal">
        <div className="modal-head">
          <div><span className="eyebrow">REQUEST / RESPONSE</span><h2>对话 Debug</h2></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button>
        </div>
        <nav className="debug-tabs" aria-label="Debug 内容">
          {([['input', '输入'], ['output', '输出'], ['memory', '记忆总结'], ['experience', '经历总结']] as const).map(([id, label]) => (
            <button type="button" className={activeTab === id ? 'active' : ''} aria-selected={activeTab === id} onClick={() => setActiveTab(id)} key={id}>{label}</button>
          ))}
        </nav>
        <div className="debug-tab-content">
          <div className="debug-token-usage" aria-label="Token 使用量">
            <div><span>输入 Token</span><strong>{shownInputTokens ?? '未提供'}</strong></div>
            <div><span>输出 Token</span><strong>{shownOutputTokens ?? '未提供'}</strong></div>
          </div>
          {activeTab === 'input' && <div className="debug-prompt-list">
            {promptGroups.length ? promptGroups.map((group) => <details className="debug-prompt-group" open={group.id === 'current'} key={group.id}>
              <summary><span>{group.title}</span><small>{group.segments.length} 段</small><ChevronDown size={16} /></summary>
              <div className="debug-prompt-group-content">{group.segments.map((segment, index) => <section className="debug-prompt-segment" key={`${index}-${segment.title}`}>
                <header><h3>{segment.title}</h3><span className={`debug-role ${segment.role}`}>{segment.role}</span></header>
                <pre className="debug-response">{segment.content}</pre>
              </section>)}</div>
            </details>) : <p className="debug-empty">当前RPG还没有请求记录。</p>}
          </div>}
          {activeTab === 'output' && <section className="debug-section debug-output-section">
            <h3>LLM 返回的原始输出（红色为异常格式）</h3>
            <pre className="debug-response">{content ? content.split(/\n/).map((line, index, lines) => { const ranges = anomalyRanges.filter((range) => range.line === index); const parts = ranges.length ? [line.slice(0, ranges[0].start), <span className="debug-anomaly-line" key="anomaly">{line.slice(ranges[0].start, ranges[0].end)}</span>, line.slice(ranges[0].end)] : [line]; return <span className={anomalyIndexes.includes(index) && !ranges.length ? 'debug-anomaly-line' : undefined} key={`${index}-${line}`}>{parts}{index < lines.length - 1 ? '\n' : ''}</span> }) : '当前RPG还没有 LLM 返回内容。'}{repairContent ? `\n\n===== 自动补选项返回原文 =====\n${repairContent}` : ''}</pre>
          </section>}
          {activeTab === 'memory' && <div className="debug-memory-sections">
            <section className="debug-section"><h3>发送给记忆总结 LLM 的要求</h3><pre className="debug-response">{memoryRequest || '本轮对话没有触发记忆总结。'}</pre></section>
            <section className="debug-section"><h3>记忆总结 LLM 返回的原文</h3><pre className="debug-response">{memoryResponse || '本轮对话没有触发记忆总结。'}</pre></section>
          </div>}
          {activeTab === 'experience' && <div className="debug-memory-sections">
            <section className="debug-section"><h3>发送给角色经历整理 LLM 的要求</h3><pre className="debug-response">{experienceRequest || '本轮对话没有触发角色经历整理。'}</pre></section>
            <section className="debug-section"><h3>角色经历整理 LLM 返回的原文</h3><pre className="debug-response">{experienceResponse || '本轮对话没有触发角色经历整理。'}</pre></section>
          </div>}
        </div>
      </section>
    </div>
  )
}

function LlmSpecialInstructionsDialog({ value, repairDisabled, onRepair, onChange, onClose }: {
  value: LlmSpecialInstructions
  repairDisabled: boolean
  onRepair: () => void
  onChange: (value: LlmSpecialInstructions) => void
  onClose: () => void
}) {
  const patch = (next: Partial<LlmSpecialInstructions>) => onChange({ ...value, ...next })
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="LLM特殊指令">
      <button className="backdrop" onClick={onClose} aria-label="关闭 LLM特殊指令" />
      <section className="modal llm-special-instructions-modal">
        <div className="modal-head">
          <div><span className="eyebrow">NEXT TURN CONTROL</span><h2>LLM特殊指令</h2></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button>
        </div>
        <div className="llm-special-instructions-content">
          <div className="llm-special-instructions-section">
            <p>以下功能用于对当前轮对话进行处理，点击即生效</p>
            <button type="button" className="secondary-button llm-format-repair-button" onClick={onRepair} disabled={repairDisabled}><RefreshCw size={16} />尝试修正格式</button>
          </div>
          <div className="llm-special-instructions-section">
            <p>以下功能用于对LLM格式进行控制，将在下一轮对话中生效</p>
            <div className="llm-special-instructions-options">
              <label><input type="checkbox" checked={value.preferEroticChoices} onChange={(event) => patch({ preferEroticChoices: event.target.checked })} /><span>优先输出色情选项</span></label>
              <label><input type="checkbox" checked={value.increaseLength} onChange={(event) => patch({ increaseLength: event.target.checked })} /><span>增加单次篇幅</span></label>
              <label><input type="checkbox" checked={value.decreaseLength} onChange={(event) => patch({ decreaseLength: event.target.checked })} /><span>减少单次篇幅</span></label>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

export default App
