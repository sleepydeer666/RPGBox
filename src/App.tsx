import { AlertTriangle, BookOpen, Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronUp, ChevronsDown, ChevronsUp, CircleStop, ClipboardList, Clock3, Flag, History, MapPin, Menu, RefreshCw, RotateCcw, Send, Server, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import GameDrawer, { type GameDrawerProps } from './components/GameDrawer'
import GameSettingsDialog from './components/GameSettingsDialog'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'
import { createBlankGame } from './game'
import { tokenizeCharacterNames, tokenizeNarrationText } from './lib/characterText'
import { buildTurnInstructions, chapterTurnCountBeforeLatestBoundary, currentChapterTurnCount, reportedChapterTitle, selectedChoiceEndsChapter } from './lib/chapterTurns'
import { loadBundledDefaultPrompt, resolveGlobalJailbreakPrompt } from './lib/defaultPrompt'
import { latestDebugExchange } from './lib/debugExchange'
import { resolveCharacterExpression } from './lib/expressions'
import { buildHistoryLines } from './lib/history'
import { importBundledRpg, listBundledRpgPresets, type BundledRpgPreset } from './lib/bundledRpg'
import { closesChapter, currentChapterSummary, normalizeMemoryState, partitionRecentChapterMemories, recentChapterMemories } from './lib/memory'
import { CHAPTER_SUMMARY_SYSTEM_PROMPT, DISTANT_SUMMARY_SYSTEM_PROMPT, isValidChapterSummary, isValidDistantSummary, normalizeMemorySummaryOutput } from './lib/memorySummary'
import { normalizeProtocolResponse, parseAssistantResponse, standardResponse, visibleStory } from './lib/parser'
import { completeStreamingLines, reachedChapterBoundaryStart, resolvePlayback } from './lib/playback'
import { portraitSource } from './lib/portraits'
import { deletePortraitFile } from './lib/portraits'
import { cloneGameSession, exportRpgbox, importRpgbox, type RpgboxImportSource, type RpgExportOptions } from './lib/rpgPackage'
import { buildSystemPrompt, takeRecentConversationTurns, toApiMessages } from './lib/prompt'
import { inspectLatestResponseCompletion, mergeContinuationResponseResult } from './lib/responseCompletion'
import { appendRollbackSnapshot, changedStatusCharacterIds, createRollbackSnapshot, latestTurnPreviousStatuses, restoreLastRollback } from './lib/rollback'
import { applyRpgStatePatch } from './lib/state'
import { collectRecentActors, collectTurnActors, includeActiveSpeaker, type StageActor, type StageTurn } from './lib/stage'
import { streamCompletion } from './services/openai'
import { createInitialProviderState, loadState, saveState } from './storage'
import type { ChapterMemory, CharacterProfile, ChatMessage, Choice, GameSession, MemoryState, PortraitGroup, ProviderProfile, StorySegment } from './types'

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const CLOSE_CHAPTER_INSTRUCTION = '尽快收尾本章节，然后开启一段过渡剧情为新章节做准备；如果前后章节紧密连贯，也可以直接开始新章节。'
const EMPTY_RPG_PLACEHOLDER = '新的旅程尚未留下文字。'

function formatMemorySummaryDebug(
  label: string,
  messages: Array<{ role: string; content: string }>,
  responses: string[],
  error?: string,
) {
  const request = messages.map((message) => `===== ${message.role.toUpperCase()} =====\n${message.content}`).join('\n\n')
  const attempts = responses.map((response, index) => `===== 第 ${index + 1} 次 LLM 原始返回 =====\n${response || '（空响应）'}`).join('\n\n')
  return [`######## ${label} ########`, request, attempts, error ? `===== 错误 =====\n${error}` : ''].filter(Boolean).join('\n\n')
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
  const [selectedChoices, setSelectedChoices] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')
  const [gameDrawerOpen, setGameDrawerOpen] = useState(false)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [viewedStatusCharacterId, setViewedStatusCharacterId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [continuingResponse, setContinuingResponse] = useState(false)
  const [summarizingMemory, setSummarizingMemory] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const activeGame = games.find((game) => game.id === activeGameId) ?? games[0] ?? fallbackGame
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
  const chapterTurnCount = currentChapterTurnCount(activeGame)
  const effectiveGlobalJailbreakPrompt = resolveGlobalJailbreakPrompt(globalJailbreakPrompt, bundledDefaultPrompt)
  const latestAssistantIndex = activeGame.messages.map((message) => message.role).lastIndexOf('assistant')
  const latestAssistant = [...activeGame.messages].reverse().find((message) => message.role === 'assistant')
  const debugExchange = useMemo(() => latestDebugExchange(activeGame.messages), [activeGame.messages])
  const latestParsed = useMemo(() => parseAssistantResponse(latestAssistant?.content ?? '', {
    characters: activeGame.characters,
  }), [activeGame.characters, latestAssistant?.content])
  const streamingParsed = useMemo(
    () => parseAssistantResponse(visibleStory(completeStreamingLines(latestAssistant?.content ?? '')), {
      characters: activeGame.characters,
    }),
    [activeGame.characters, latestAssistant?.content],
  )
  const rawSegmentIndex = segmentPositions[activeGame.id] ?? 0
  const playback = resolvePlayback(busy, latestParsed.segments, streamingParsed.segments, rawSegmentIndex)
  const segmentIndex = playback.index
  const segmentsComplete = playback.complete
  const canAdvance = playback.canAdvance
  const currentSegment: StorySegment | undefined = playback.current
    ?? (busy ? { type: 'narration', text: '正在生成' } : undefined)
  const choicesVisible = !busy && segmentsComplete && latestParsed.choices.length > 0
  const responseCompletion = useMemo(() => inspectLatestResponseCompletion(activeGame), [activeGame])
  const needsContinuation = !busy && responseCompletion.canContinue && !responseCompletion.complete
  const showProgressContinuation = needsContinuation && !responseCompletion.hasChoices && segmentsComplete
  const showChoiceContinuation = needsContinuation && responseCompletion.hasChoices && choicesVisible
  const statusRulesEnabled = Boolean(activeGame.statusRulesPrompt?.trim())
  const hasStoryRecord = activeGame.messages.some((message) => message.role === 'user'
    || (message.role === 'assistant' && message.content.trim() && message.content.trim() !== EMPTY_RPG_PLACEHOLDER))
  const emptyRpg = !hasStoryRecord && !busy
  const previousStageTurns = useMemo(() => activeGame.messages.flatMap((message): StageTurn[] => {
    if (message.role !== 'assistant' || message.id === latestAssistant?.id) return []
    const parsed = parseAssistantResponse(message.content, { characters: activeGame.characters })
    const boundaryStart = parsed.chapterBoundaryIndexes.at(-1)
    return [{
      segments: parsed.segments.slice(boundaryStart ?? 0),
      sceneChanged: parsed.sceneChanged || boundaryStart !== undefined,
      presentCharacterIds: boundaryStart === undefined
        ? parsed.gameData?.statePatch?.presentCharacterIds as string[] | undefined
        : undefined,
    }]
  }), [activeGame.characters, activeGame.messages, latestAssistant?.id])
  const currentStageParse = busy ? streamingParsed : latestParsed
  const chapterBoundaryStart = reachedChapterBoundaryStart(
    currentStageParse.chapterBoundaryIndexes,
    segmentIndex,
    segmentsComplete,
  )
  const chapterBoundaryCrossed = chapterBoundaryStart !== undefined
  const patchedDisplayGameState = applyRpgStatePatch(activeGame.gameState, currentStageParse.gameData?.statePatch, activeGame.nsfwEnabled)
  const displayGameState = chapterBoundaryCrossed
    ? { ...patchedDisplayGameState, presentCharacterIds: [] }
    : patchedDisplayGameState
  const displayChapterTitle = chapterBoundaryCrossed
    ? ''
    : currentStageParse.chapterTitle !== undefined
    ? currentStageParse.chapterTitle.trim()
    : activeGame.narrative.chapter.title.trim()
  const displayChapterTurnCount = chapterBoundaryCrossed
    ? 0
    : currentStageParse.chapterBoundaryIndexes.length
      ? chapterTurnCountBeforeLatestBoundary(activeGame, latestAssistantIndex)
      : chapterTurnCount
  const currentPresentCharacterIds = chapterBoundaryCrossed
    ? undefined
    : currentStageParse.gameData?.statePatch?.presentCharacterIds as string[] | undefined
  const persistentDialogueActors = collectRecentActors([
    ...(chapterBoundaryCrossed ? [] : previousStageTurns),
    {
      segments: playback.segments.slice(chapterBoundaryStart ?? 0, segmentIndex + 1),
      sceneChanged: currentStageParse.sceneChanged || chapterBoundaryCrossed,
      presentCharacterIds: currentPresentCharacterIds,
    },
  ], activeGame.characters, 2, displayGameState.contentMode, true)
  const dialogueActors = includeActiveSpeaker(persistentDialogueActors, currentSegment, activeGame.characters, displayGameState.contentMode, 2)
  const choiceBoundaryStart = latestParsed.chapterBoundaryIndexes.at(-1)
  const choiceActors = collectTurnActors(
    latestParsed.segments.slice(choiceBoundaryStart ?? 0),
    activeGame.characters.filter((character) => character.role === 'npc'),
    latestParsed.gameData?.statePatch?.presentCharacterIds as string[] | undefined,
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

  useEffect(() => {
    void loadState().then((saved) => {
      if (saved.providers?.length) setProviders(saved.providers)
      if (saved.activeProviderId) setActiveProviderId(saved.activeProviderId)
      if (saved.globalJailbreakPrompt) setGlobalJailbreakPrompt(saved.globalJailbreakPrompt)
      setBundledRpgImportKeys(saved.bundledRpgImportKeys ?? [])
      setGames(saved.games ?? [])
      setActiveGameId(saved.activeGameId ?? saved.games?.[0]?.id ?? '')
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    void listBundledRpgPresets().then(setBundledRpgPresets)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => void saveState({ providers, activeProviderId, globalJailbreakPrompt, games, activeGameId, bundledRpgImportKeys }), 250)
    return () => window.clearTimeout(timer)
  }, [activeGameId, activeProviderId, bundledRpgImportKeys, games, globalJailbreakPrompt, hydrated, providers])

  useEffect(() => {
    setViewedStatusCharacterId(null)
  }, [activeGameId, activeGame.messages.length])

  useEffect(() => {
    if (viewedStatusCharacterId && (!statusRulesEnabled || !visibleStatusActors.some((actor) => actor.character.id === viewedStatusCharacterId))) {
      setViewedStatusCharacterId(null)
    }
  }, [statusRulesEnabled, viewedStatusCharacterId, visibleStatusActors])

  function updateGame(gameId: string, updater: (game: GameSession) => GameSession) {
    setGames((current) => current.map((game) => game.id === gameId ? updater(game) : game))
  }

  function selectGame(gameId: string) {
    if (busy || summarizingMemory) return
    setActiveGameId(gameId)
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
    nsfwEnabled: boolean,
    onPortraitProgress?: (completed: number, total: number) => void,
  ) {
    const blank = createBlankGame(games.length + 1, configuredProvider)
    const imported = importSource ? await importRpgbox(importSource, blank, { onPortraitProgress }) : blank
    const resolvedNsfwEnabled = nsfwEnabled || imported.nsfwEnabled
    const game = {
      ...imported,
      title: title.trim() || importSource?.name.replace(/\.rpgbox$/iu, '').trim() || blank.title,
      nsfwEnabled: resolvedNsfwEnabled,
      gameState: resolvedNsfwEnabled ? imported.gameState : { ...imported.gameState, contentMode: 'normal' as const },
      updatedAt: Date.now(),
    }
    setGames((current) => [...current, game])
    setActiveGameId(game.id)
    const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
    const parsed = parseAssistantResponse(latest?.content ?? '', { characters: game.characters })
    setSegmentPositions((current) => ({ ...current, [game.id]: Math.max(0, parsed.segments.length - 1) }))
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
    const parsed = parseAssistantResponse(latest?.content ?? '', { characters: game.characters })
    setSegmentPositions((current) => ({ ...current, [game.id]: Math.max(0, parsed.segments.length - 1) }))
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

  function updateRpgMetadata(gameId: string, title: string, nsfwEnabled: boolean) {
    updateGame(gameId, (game) => ({
      ...game,
      title: title.trim() || '未命名RPG',
      nsfwEnabled,
      gameState: nsfwEnabled ? game.gameState : { ...game.gameState, contentMode: 'normal' },
      updatedAt: Date.now(),
    }))
  }

  function advanceSegment() {
    if (!canAdvance) return
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: segmentIndex + 1 }))
  }

  function rewindSegment() {
    if (busy || segmentIndex <= 0) return
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: segmentIndex - 1 }))
  }

  function resetStory() {
    setViewedStatusCharacterId(null)
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    updateGame(activeGame.id, (game) => ({
      ...game,
      messages: [],
      gameState: { location: '未知之地', time: '序章', contentMode: 'normal', values: {} },
      narrative: {
        chapter: { id: `chapter-${stamp}`, title: '', startedAtMessageId: '' },
      },
      memory: normalizeMemoryState(undefined),
      characters: game.characters.map((character) => ({ ...character, statusBar: '' })),
      rollbackLog: [],
      updatedAt: Date.now(),
    }))
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: 0 }))
    setSelectedChoices([])
    setCustomInput('')
    setError('')
    setGameSettingsOpen(false)
    setHistoryOpen(false)
  }

  function toggleChoice(choice: Choice) {
    setSelectedChoices((current) => current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id].sort())
  }

  function rollbackTurn() {
    if (busy || summarizingMemory) return
    const restoredGame = restoreLastRollback(activeGame)
    if (!restoredGame) return
    setViewedStatusCharacterId(null)
    const messages = restoredGame.messages
    const latest = [...messages].reverse().find((message) => message.role === 'assistant')
    const restored = parseAssistantResponse(latest?.content ?? '', { characters: activeGame.characters })
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
    setSegmentPositions((current) => ({ ...current, [activeGame.id]: Math.max(0, restored.segments.length - 1) }))
    setSelectedChoices([])
    setCustomInput('')
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
    options: { sourceMessageIds?: string[]; existingSummary?: string; onDebug?: (content: string) => void } = {},
  ) {
    if (!activeProvider || !chapterTitle.trim()) return undefined
    const transcript = memoryTranscript(chapterMessages(game, sourceMessages, chapterTitle, options.sourceMessageIds))
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    const messages = [
      { role: 'system' as const, content: CHAPTER_SUMMARY_SYSTEM_PROMPT },
      { role: 'user' as const, content: `章节名称：${chapterTitle}\n\n已有的本章摘要（仅在内容确实是剧情摘要时参考；若包含网页、代码、任务分析或其他无关内容则完全忽略）：\n${(options.existingSummary ?? currentChapterSummary(game.memory)) || '无'}\n\n本章剧情：\n${transcript || '无可用剧情记录'}` },
    ]
    const responses: string[] = []
    options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, messages, responses))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let rawSummary = ''
      try {
        rawSummary = await streamCompletion({ provider, signal, messages: attempt
          ? [...messages, { role: 'user', content: '上次输出不符合章节记忆格式。请重新执行原任务，只输出以“本章摘要：”开头的单段中文事实摘要。' }]
          : messages })
      } catch (error) {
        const message = toErrorMessage(error)
        options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, messages, responses, message))
        throw error
      }
      responses.push(rawSummary)
      options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, messages, responses))
      const summary = normalizeMemorySummaryOutput(rawSummary)
      if (isValidChapterSummary(summary)) return summary
    }
    const error = '模型连续两次返回了无效的章节摘要'
    options.onDebug?.(formatMemorySummaryDebug(`章节记忆总结：${chapterTitle}`, messages, responses, error))
    throw new Error(error)
  }

  async function summarizeDistantMemory(existing: string, chapters: ChapterMemory[], signal: AbortSignal, onDebug?: (content: string) => void) {
    if (!activeProvider) return undefined
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    const messages = [
      { role: 'system' as const, content: DISTANT_SUMMARY_SYSTEM_PROMPT },
      { role: 'user' as const, content: `既有远期记忆：\n${existing || '无'}\n\n移出的旧章节：\n${chapters.map((chapter) => `章节：${chapter.title}\n${chapter.summary}`).join('\n\n') || '无，仅整理既有远期记忆'}` },
    ]
    const responses: string[] = []
    onDebug?.(formatMemorySummaryDebug('远期记忆整理', messages, responses))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let rawSummary = ''
      try {
        rawSummary = await streamCompletion({ provider, signal, messages: attempt
          ? [...messages, { role: 'user', content: '上次输出不符合远期记忆格式。请重新执行原任务，只输出以“远期记忆：”开头的单段中文事实摘要。' }]
          : messages })
      } catch (error) {
        const message = toErrorMessage(error)
        onDebug?.(formatMemorySummaryDebug('远期记忆整理', messages, responses, message))
        throw error
      }
      responses.push(rawSummary)
      onDebug?.(formatMemorySummaryDebug('远期记忆整理', messages, responses))
      const summary = normalizeMemorySummaryOutput(rawSummary)
      if (isValidDistantSummary(summary)) return summary
    }
    const error = '模型连续两次返回了无效的远期记忆'
    onDebug?.(formatMemorySummaryDebug('远期记忆整理', messages, responses, error))
    throw new Error(error)
  }

  async function summarizeMemoryNow(kind: 'chapter' | 'history', completedChapter?: ChapterMemory) {
    if (busy || summarizingMemory || !activeProvider) return
    const operationId = completedChapter?.id ?? kind
    setSummarizingMemory(operationId)
    setError('')
    try {
      const signal = new AbortController().signal
      const result = kind === 'chapter'
        ? await summarizeChapterMemory(
          activeGame,
          activeGame.messages,
          completedChapter?.title ?? activeGame.narrative.chapter.title,
          signal,
          completedChapter ? { sourceMessageIds: completedChapter.sourceMessageIds, existingSummary: completedChapter.summary } : {},
        )
        : await summarizeDistantMemory(activeGame.memory.historicalSummary, [], signal)
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
          : { ...normalizeMemoryState(game.memory), historicalSummary: result },
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
    const parseContext = { characters: gameSnapshot.characters }
    const originalRaw = normalizeProtocolResponse(assistantMessage.rawContent ?? assistantMessage.content, parseContext)
    const apiHistory = gameSnapshot.messages.map((message) => message.role === 'assistant'
      ? { ...message, content: message.id === assistantMessage.id ? originalRaw : normalizeProtocolResponse(message.content, parseContext) }
      : message)
    const continuationInstruction: ChatMessage = {
      id: newId('continuation'),
      role: 'user',
      content: '继续输出完整',
      createdAt: Date.now(),
    }
    const controller = new AbortController()
    abortRef.current = controller
    setViewedStatusCharacterId(null)
    setError('')
    setContinuingResponse(true)
    setBusy(true)
    let continuationSpliceOffset: number | undefined
    let soughtContinuationSplice = false
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
        messages: toApiMessages(
          buildSystemPrompt(gameSnapshot, requestGlobalJailbreakPrompt),
          [...takeRecentConversationTurns(apiHistory, gameSnapshot.aiSettings.contextTurns), continuationInstruction],
        ),
        signal: controller.signal,
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
              ? { ...message, content: standardResponse(merge.text, { characters: gameSnapshot.characters }), rawContent: merge.text }
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
      const parsed = parseAssistantResponse(mergedRaw, { characters: gameSnapshot.characters })
      const reportedChapter = reportedChapterTitle(parsed)
      const turnChapter = reportedChapter ?? assistantMessage.chapterTitle ?? gameSnapshot.narrative.chapter.title
      const statusUpdates = gameSnapshot.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()

      updateGame(gameId, (game) => ({
        ...game,
        messages: game.messages.map((message) => {
          if (message.id === assistantMessage.id) return { ...message, content: standardResponse(mergedRaw, { characters: gameSnapshot.characters }), rawContent: mergedRaw, chapterTitle: turnChapter }
          if (message.id === userMessage.id) return { ...message, chapterTitle: turnChapter }
          return message
        }),
        gameState: parsed.chapterBoundaryIndexes.length
          ? { ...applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch, game.nsfwEnabled), presentCharacterIds: [] }
          : applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch, game.nsfwEnabled),
        characters: statusUpdates.size
          ? game.characters.map((character) => statusUpdates.has(character.id)
            ? { ...character, statusBar: statusUpdates.get(character.id) }
            : character)
          : game.characters,
        narrative: reportedChapter !== undefined && reportedChapter !== game.narrative.chapter.title
          ? { chapter: { id: newId('chapter'), title: reportedChapter, startedAtMessageId: userMessage.id } }
          : game.narrative,
        updatedAt: Date.now(),
      }))
    } catch (continuationError) {
      if (!controller.signal.aborted) setError(`补全失败：${toErrorMessage(continuationError)}`)
    } finally {
      setBusy(false)
      setContinuingResponse(false)
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
    setError('')
    setBusy(true)
    setCustomInput('')
    setSelectedChoices([])
    setSegmentPositions((current) => ({ ...current, [gameId]: 0 }))
    const controller = new AbortController()
    abortRef.current = controller

    const userMessage: ChatMessage = { id: newId('user'), role: 'user', content: input, createdAt: Date.now() }
    const pendingAssistant: ChatMessage = { id: newId('assistant'), role: 'assistant', content: '', createdAt: Date.now() }
    const endsChapter = Boolean(gameSnapshot.narrative.chapter.title.trim()) && (
      forcedInput?.trim() === CLOSE_CHAPTER_INSTRUCTION
      || (!forcedInput && selectedChoiceEndsChapter(latestParsed.choices, selectedChoices))
    )
    const turnInstructions = buildTurnInstructions(gameSnapshot, endsChapter)
    const requestContent = `${input}\n\n${turnInstructions.join('\n')}`
    const storedUserMessage = { ...userMessage, requestContent }
    const requestMessages = [...gameSnapshot.messages, storedUserMessage]
    const parseContext = { characters: gameSnapshot.characters }
    const normalizedHistory = gameSnapshot.messages.map((message) => message.role === 'assistant'
      ? { ...message, content: normalizeProtocolResponse(message.content, parseContext) }
      : message)
    const apiRequestMessages = [
      ...normalizedHistory,
      { ...userMessage, content: requestContent },
    ]
    const rollbackSnapshot = createRollbackSnapshot(gameSnapshot, newId('rollback'))
    updateGame(gameId, (game) => ({ ...game, messages: [...requestMessages, pendingAssistant], rollbackLog: appendRollbackSnapshot(game.rollbackLog, rollbackSnapshot), updatedAt: Date.now() }))

    try {
      const fullText = await streamCompletion({
        provider: activeProvider,
        messages: toApiMessages(
          buildSystemPrompt(gameSnapshot, requestGlobalJailbreakPrompt),
          takeRecentConversationTurns(apiRequestMessages, gameSnapshot.aiSettings.contextTurns),
        ),
        signal: controller.signal,
        onToken: (content) => updateGame(gameId, (game) => ({
          ...game,
          messages: [...requestMessages, { ...pendingAssistant, content: standardResponse(content, { characters: gameSnapshot.characters }) }],
          updatedAt: Date.now(),
        })),
      })
      const rawContent = fullText
      const parsed = parseAssistantResponse(fullText, { characters: gameSnapshot.characters })
      const reportedChapter = reportedChapterTitle(parsed)
      const previousChapter = gameSnapshot.narrative.chapter.title.trim()
      const turnChapter = reportedChapter === undefined ? previousChapter : reportedChapter
      const chapterChanged = reportedChapter !== undefined && turnChapter !== previousChapter
      const chapterClosed = closesChapter(previousChapter, reportedChapter)
      const completedUser = { ...storedUserMessage, chapterTitle: turnChapter }
      const normalizedContent = standardResponse(fullText, { characters: gameSnapshot.characters })
      const completedAssistant = { ...pendingAssistant, content: normalizedContent, rawContent, chapterTitle: turnChapter }
      const completeMessages = [...gameSnapshot.messages, completedUser, completedAssistant]
      const nextNarrative = chapterChanged ? {
        chapter: {
          id: newId('chapter'),
          title: turnChapter,
          startedAtMessageId: completedUser.id,
        },
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
      const memoryAfterBoundary = chapterChanged ? {
        ...normalizedMemory,
        currentChapterSummary: '',
        recentChapters: pendingChapterMemory
          ? [...recentChapterMemories(normalizedMemory).filter((chapter) => chapter.id !== pendingChapterMemory.id), pendingChapterMemory]
          : recentChapterMemories(normalizedMemory),
      } : normalizedMemory
      const statusUpdates = gameSnapshot.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()
      updateGame(gameId, (game) => ({
        ...game,
        messages: completeMessages,
        gameState: parsed.chapterBoundaryIndexes.length
          ? { ...applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch, game.nsfwEnabled), presentCharacterIds: [] }
          : applyRpgStatePatch(game.gameState, parsed.gameData?.statePatch, game.nsfwEnabled),
        characters: statusUpdates.size
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
        void (async () => {
          let chapterSummaryDebug = ''
          const updateSummaryDebug = (content: string) => {
            chapterSummaryDebug = content
            updateGame(gameId, (game) => ({
              ...game,
              messages: game.messages.map((message) => message.id === completedAssistant.id
                ? { ...message, memorySummaryDebug: content }
                : message),
              updatedAt: Date.now(),
            }))
          }
          try {
            const summary = await summarizeChapterMemory(
              gameSnapshot,
              gameSnapshot.messages,
              previousChapter,
              summaryController.signal,
              {
                sourceMessageIds: pendingChapterMemory?.sourceMessageIds,
                existingSummary: draftSummary,
                onDebug: updateSummaryDebug,
              },
            )
            if (summary) {
              const completedChapter: ChapterMemory = {
                id: gameSnapshot.narrative.chapter.id,
                title: previousChapter,
                summary,
                completedAt: Date.now(),
                sourceMessageIds: pendingChapterMemory?.sourceMessageIds,
              }
              const recent = [...recentChapterMemories(normalizedMemory).filter((chapter) => chapter.id !== completedChapter.id), completedChapter]
              const { overflow, retained: retainedWithinLimit } = partitionRecentChapterMemories(recent, normalizedMemory.recentChapterLimit)
              let historicalSummary = normalizedMemory.historicalSummary
              let retained = recent
              if (overflow.length) {
                const distant = await summarizeDistantMemory(historicalSummary, overflow, summaryController.signal, (content) => {
                  updateSummaryDebug(`${chapterSummaryDebug}\n\n${content}`)
                })
                if (distant) {
                  historicalSummary = distant
                  retained = retainedWithinLimit
                }
              }
              updateGame(gameId, (game) => ({
                ...game,
                memory: {
                  ...normalizeMemoryState(game.memory),
                  recentChapters: retained,
                  historicalSummary,
                },
                updatedAt: Date.now(),
              }))
            }
          } catch (summaryError) {
            setError(`章节已切换，但上一章节总结失败：${toErrorMessage(summaryError)}`)
          }
        })()
      }
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(toErrorMessage(requestError))
        updateGame(gameId, (game) => ({ ...game, messages: gameSnapshot.messages, gameState: gameSnapshot.gameState, narrative: gameSnapshot.narrative, memory: gameSnapshot.memory, rollbackLog: gameSnapshot.rollbackLog ?? [], updatedAt: Date.now() }))
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
    }
    return <><EmptyLibraryScreen loading={!hydrated} onOpenLibrary={() => setGameDrawerOpen(true)} drawerProps={drawerProps} />{globalSettingsOpen && <GlobalSettingsDialog providers={providers} activeProviderId={activeProviderId} globalJailbreakPrompt={globalJailbreakPrompt} onClose={() => setGlobalSettingsOpen(false)} onChangeProviders={setProviders} onChangeActive={setActiveProviderId} onChangeGlobalJailbreakPrompt={setGlobalJailbreakPrompt} />}</>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button" onClick={() => setGameDrawerOpen(true)} title="RPG目录"><Menu size={21} /></button>
        <div className="brand-block"><span className="brand">RPGBox</span><span className="chapter">{displayChapterTitle || '章节间过渡'} · {activeGame.title}</span></div>
        <div className="topbar-actions">
          <button className="topbar-action-button" onClick={() => setGameSettingsOpen(true)} title={`RPG设置 · ${activeProvider?.model || activeProvider?.name || '未配置'}`}>{!hasUsableProvider && <span className="provider-warning-badge" aria-label="AI API 未完整配置">!</span>}<Server size={18} /><span>设置</span></button>
          <button className="topbar-action-button" onClick={() => setHistoryOpen(true)} title="历史记录"><History size={18} /><span>历史</span></button>
          <button className="topbar-action-button" onClick={() => setMemoryOpen(true)} title="主记忆与远期记忆"><Brain size={18} /><span>记忆</span></button>
          <button className="topbar-action-button" onClick={() => setRollbackConfirmOpen(true)} disabled={busy || Boolean(summarizingMemory) || !(activeGame.rollbackLog?.length)} title={`回滚上一轮（可用 ${activeGame.rollbackLog?.length ?? 0} / 5）`}><RotateCcw size={18} /><span>撤回</span></button>
          <button className="topbar-action-button" onClick={() => setDebugOpen(true)} title="AI 原文 Debug"><Bug size={18} /><span>Debug</span></button>
        </div>
      </header>

      <main className="rpg-stage-shell">
        <div
          className={`rpg-stage ${choicesVisible ? 'selection' : currentSegment?.type === 'dialogue' ? 'dialogue' : 'narration'}`}
          role={canAdvance ? 'button' : undefined}
          tabIndex={canAdvance ? 0 : undefined}
          onClick={advanceSegment}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') advanceSegment() }}
        >
          <div className="stage-context" aria-label="当前剧情状态">
            <span className="stage-context-item location"><MapPin size={14} /><strong>{displayGameState.location}</strong></span>
            <span className="stage-context-item"><Clock3 size={14} /><span>{displayGameState.time}</span></span>
            {activeGame.nsfwEnabled && <span className={`content-mode ${displayGameState.contentMode}`}>{displayGameState.contentMode === 'nsfw' ? 'NSFW' : '常规'}</span>}
          </div>
          {choicesVisible ? (
            <ChoiceScene choices={latestParsed.choices} selectedChoices={selectedChoices} actors={choiceActors} characters={activeGame.characters} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} changedStatusCharacterIds={changedStatusIds} onToggle={toggleChoice} onCloseChapter={() => void sendTurn(CLOSE_CHAPTER_INSTRUCTION)} showContinuation={showChoiceContinuation} onContinue={() => void continueTruncatedResponse()} />
          ) : busy && currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} streaming />
          ) : busy ? (
            <NarrationScene text={currentSegment?.text || '正在生成'} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} streaming />
          ) : currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} />
          ) : (
            <NarrationScene text={currentSegment?.text || '...'} characters={activeGame.characters} actors={dialogueStatusActors} mode={displayGameState.contentMode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={setViewedStatusCharacterId} statusRulesEnabled={statusRulesEnabled} />
          )}
        </div>

        <footer className={`interaction-dock ${emptyRpg ? 'empty-rpg-mode' : !busy && segmentsComplete && !showProgressContinuation ? 'composer-mode' : 'playback-mode'}`}>
          {error && <div className="error-banner">{error}<button onClick={() => setError('')} title="关闭"><X size={15} /></button></div>}
          {emptyRpg ? <div className="dock-main empty-rpg-dock"><button type="button" className="start-game-button" onClick={() => void sendTurn('开始新的一天')} disabled={!hasUsableProvider} title={!hasUsableProvider ? '请先完成 AI API 设置' : '开始游戏'}><Send size={18} />开始游戏</button></div> : <div className="dock-main">
            <button className="rewind-button" onClick={rewindSegment} disabled={busy || segmentIndex <= 0} title="返回上一段"><ChevronLeft size={21} /></button>
            {busy ? (
              <div className="playback-info">
                <div className="narrative-position">{displayChapterTitle || '章节间过渡'}-{displayChapterTurnCount}</div>
                <div className="generation-status" aria-live="polite">
                  <span>{streamingParsed.segments.length ? `${segmentIndex + 1} / ${streamingParsed.segments.length}` : '0 / 0'} · <span className="generation-label">{continuingResponse ? '补全中' : '生成中'}</span></span>
                  <button className="send-button stop" onClick={() => { abortRef.current?.abort(); setBusy(false) }} title="停止生成"><CircleStop size={20} /></button>
                </div>
              </div>
            ) : segmentsComplete && !showProgressContinuation ? (
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

      <GameDrawer open={gameDrawerOpen} games={games} activeGameId={activeGame.id} onClose={() => setGameDrawerOpen(false)} onSelect={selectGame} onReorder={reorderGames} onCreate={createGame} onUpdateMetadata={updateRpgMetadata} onDelete={deleteGame} onClone={cloneGame} onExport={exportGame} bundledRpgPresets={bundledRpgPresets} bundledRpgImportKeys={bundledRpgImportKeys} onImportBundledRpg={importPreset} onOpenSettings={() => { setGameDrawerOpen(false); setGlobalSettingsOpen(true) }} />
      {gameSettingsOpen && <GameSettingsDialog game={activeGame} games={games} providers={providers} fullSystemPrompt={buildSystemPrompt(activeGame, effectiveGlobalJailbreakPrompt)} onClose={() => setGameSettingsOpen(false)} onChange={(nextGame) => updateGame(activeGame.id, () => nextGame)} />}
      {globalSettingsOpen && <GlobalSettingsDialog providers={providers} activeProviderId={activeProviderId} globalJailbreakPrompt={globalJailbreakPrompt} onClose={() => setGlobalSettingsOpen(false)} onChangeProviders={setProviders} onChangeActive={setActiveProviderId} onChangeGlobalJailbreakPrompt={setGlobalJailbreakPrompt} />}
      {historyOpen && <HistoryDialog lines={historyLines} characters={activeGame.characters} onResetStory={resetStory} onClose={() => setHistoryOpen(false)} />}
      {debugOpen && <RawResponseDialog requestContent={debugExchange.requestContent} content={debugExchange.rawResponse} repairContent={debugExchange.repairContent} memorySummaryContent={debugExchange.memorySummaryContent} onClose={() => setDebugOpen(false)} />}
      {memoryOpen && <MemoryDialog game={activeGame} summarizing={summarizingMemory} onSummarize={summarizeMemoryNow} onChange={(memory) => updateGame(activeGame.id, (game) => ({ ...game, memory, updatedAt: Date.now() }))} onClose={() => setMemoryOpen(false)} />}
      {rollbackConfirmOpen && <RollbackConfirmDialog onCancel={() => setRollbackConfirmOpen(false)} onConfirm={() => { setRollbackConfirmOpen(false); rollbackTurn() }} />}
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

function MemoryDialog({ game, summarizing, onSummarize, onChange, onClose }: {
  game: GameSession
  summarizing: string | null
  onSummarize: (kind: 'chapter' | 'history', completedChapter?: ChapterMemory) => Promise<void>
  onChange: (memory: MemoryState) => void
  onClose: () => void
}) {
  const memory = normalizeMemoryState(game.memory)
  const recent = recentChapterMemories(memory)
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

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="backdrop" onClick={onClose} aria-label="关闭" />
      <section className="modal memory-modal">
        <div className="modal-head"><div><span className="eyebrow">NARRATIVE MEMORY</span><h2>主记忆与远期记忆</h2></div><button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button></div>
        <div className="memory-editors">
          <section className="memory-primary-editor">
            <span className="memory-editor-head"><span>主记忆 <small>{recent.length}/{memory.recentChapterLimit ?? 5}</small></span><button type="button" className="secondary-button compact" onClick={() => void onSummarize('chapter')} disabled={Boolean(summarizing) || !currentTitle}><Brain size={14} />{summarizing === 'chapter' ? '总结中' : '总结当前章节'}</button></span>
            <p className="memory-capacity-note">最多保留 {memory.recentChapterLimit ?? 5} 个已完成章节；超出后最早的章节会自动压缩进远期记忆。手动删除不会转入远期记忆，且不可恢复。</p>
            <div className="recent-memory-list">
              {currentTitle ? <div className="memory-entry"><div className="memory-entry-head"><span>当前：{currentTitle}</span>{hasCurrentMemory && <button type="button" className="danger-icon memory-delete-button" onClick={() => onChange({ ...memory, currentChapterSummary: '' })} title={`删除“${currentTitle}”的主记忆`} aria-label={`删除“${currentTitle}”的主记忆`}><Trash2 size={15} /></button>}</div><textarea aria-label={`${currentTitle}的当前章节记忆`} value={currentSummary} onChange={(event) => onChange({ ...memory, currentChapterSummary: event.target.value })} placeholder="当前章节尚未总结" /></div> : <div className="empty-memory">当前处于章节间过渡，不生成章节记忆。</div>}
              {recent.map((chapter) => <div className="memory-entry" key={chapter.id}><div className="memory-entry-head"><span>{chapter.title}</span><span className="memory-entry-actions"><button type="button" className="secondary-button compact" onClick={() => void onSummarize('chapter', chapter)} disabled={Boolean(summarizing)} title={`重新总结“${chapter.title}”`}><RefreshCw size={13} />{summarizing === chapter.id ? '总结中' : '重新总结'}</button><button type="button" className="danger-icon memory-delete-button" onClick={() => removeRecentChapter(chapter.id)} title={`删除“${chapter.title}”的主记忆`} aria-label={`删除“${chapter.title}”的主记忆`}><Trash2 size={15} /></button></span></div><textarea aria-label={`${chapter.title}的章节记忆`} value={chapter.summary} onChange={(event) => patchRecentChapter(chapter.id, event.target.value)} placeholder="自动总结失败时可手工编辑或重新总结" /></div>)}
              {!currentTitle && !recent.length && <div className="empty-memory">暂无主记忆。</div>}
            </div>
          </section>
          <label className="distant-memory-editor"><span className="memory-editor-head"><span>远期记忆</span><button type="button" className="secondary-button compact" onClick={() => void onSummarize('history')} disabled={Boolean(summarizing)}><Brain size={14} />{summarizing === 'history' ? '整理中' : '手工整理'}</button></span><textarea value={memory.historicalSummary} onChange={(event) => onChange({ ...memory, historicalSummary: event.target.value })} placeholder="更早章节压缩后写入此处" /></label>
        </div>
        <div className="modal-footer"><span>最近章节 {recent.length} / {memory.recentChapterLimit ?? 5} · 可回滚 {game.rollbackLog?.length ?? 0} 轮</span><button className="primary-button" onClick={onClose}>完成</button></div>
      </section>
    </div>
  )
}

interface StatusViewProps {
  viewedStatusCharacterId: string | null
  onViewStatus: (characterId: string | null) => void
  statusRulesEnabled: boolean
}

function DialogueScene({ segment, characters, actors, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, streaming = false }: { segment: StorySegment; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean } & StatusViewProps) {
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
    >
      <div className={`dialogue-box ${streaming ? 'streaming' : ''}`} style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 14%, rgba(18, 19, 17, 0.96))` }}>
        <div className="speaker-line"><strong style={{ color }}>{speakerName}</strong><span>{displayExpression}</span></div>
        <p><CharacterText text={segment.text} characters={characters} /></p>
      </div>
    </StoryScene>
  )
}

function NarrationScene({ text, characters, actors, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, streaming = false }: { text: string; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean } & StatusViewProps) {
  return (
    <StoryScene actors={actors} mode={mode} viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={onViewStatus} statusRulesEnabled={statusRulesEnabled}>
      <div className={`narration-panel ${streaming ? 'streaming' : ''}`}><p><CharacterText text={text} characters={characters} narration /></p></div>
    </StoryScene>
  )
}

function ChoiceScene({ choices, selectedChoices, actors, characters, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, changedStatusCharacterIds, onToggle, onCloseChapter, showContinuation, onContinue }: { choices: Choice[]; selectedChoices: string[]; actors: StageActor[]; characters: CharacterProfile[]; mode: PortraitGroup; changedStatusCharacterIds: Set<string>; onToggle: (choice: Choice) => void; onCloseChapter: () => void; showContinuation: boolean; onContinue: () => void } & StatusViewProps) {
  return (
    <StoryScene actors={actors} mode={mode} className="choice-scene" viewedStatusCharacterId={viewedStatusCharacterId} onViewStatus={onViewStatus} statusRulesEnabled={statusRulesEnabled} changedStatusCharacterIds={changedStatusCharacterIds}>
      <section className="choice-overlay" aria-label="剧情选项" onClick={(event) => event.stopPropagation()}>
        <div className="selection-heading">
          {showContinuation && <button type="button" className="continue-response-button choice-continuation-button" onClick={onContinue}><RefreshCw size={14} />从截断处补全</button>}
          <div className="selection-prompt">请选择</div>
          <button type="button" className="close-chapter-button" onClick={onCloseChapter} title="要求 AI 收尾当前章节并推进新剧情"><Flag size={15} />收尾本章节</button>
        </div>
        <div className="choice-list">{choices.map((choice) => {
          const selected = selectedChoices.includes(choice.id)
          return <button className={`choice-button ${selected ? 'selected' : ''}`} key={choice.id} onClick={() => onToggle(choice)}><span>{selected ? <Check size={15} /> : choice.id}</span><span className="choice-text"><CharacterText text={choice.text} characters={characters} /></span></button>
        })}</div>
      </section>
    </StoryScene>
  )
}

function StoryScene({ actors, activeCharacterId, mode, viewedStatusCharacterId, onViewStatus, statusRulesEnabled, changedStatusCharacterIds = new Set<string>(), className = '', children }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup; changedStatusCharacterIds?: Set<string>; className?: string; children: React.ReactNode } & StatusViewProps) {
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
        <StagePortraits actors={actors} activeCharacterId={activeCharacterId} mode={mode} onViewStatus={onViewStatus} statusRulesEnabled={statusRulesEnabled} changedStatusCharacterIds={changedStatusCharacterIds} />
        {statusRulesEnabled && viewedStatusCharacterId && <CharacterStatusOverlay character={actors.find((actor) => actor.character.id === viewedStatusCharacterId)?.character} onClose={() => onViewStatus(null)} />}
      </div>
      <div className="content-zone" ref={contentRef}>{children}</div>
    </div>
  )
}

function StagePortraits({ actors, activeCharacterId, mode, onViewStatus, statusRulesEnabled, changedStatusCharacterIds }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup; onViewStatus: (characterId: string) => void; statusRulesEnabled: boolean; changedStatusCharacterIds: Set<string> }) {
  const visibleActors = actors.flatMap((actor) => {
    const resolved = resolveCharacterExpression(actor.character, actor.expression, mode)
    return resolved.portrait ? [{ ...actor, portrait: resolved.portrait }] : []
  })
  return (
    <div className={`stage-portrait-layer count-${visibleActors.length}`}>
      {visibleActors.map(({ character, portrait }, index) => {
        const active = activeCharacterId === character.id
        const inactive = Boolean(activeCharacterId) && !active
        return <div className={`stage-portrait slot-${index + 1} has-image ${active ? 'active' : ''} ${inactive ? 'inactive' : ''}`} key={character.id}>
          <img src={portraitSource(portrait.uri)} alt="" />
        </div>
      })}
      {statusRulesEnabled && visibleActors.map(({ character }, index) => (
        <div className={`character-status-control slot-${index + 1}`} key={`status-${character.id}`}>
          <button type="button" className={`character-status-button ${changedStatusCharacterIds.has(character.id) ? 'status-changed' : ''}`} onClick={(event) => { event.stopPropagation(); onViewStatus(character.id) }} title={`查看${character.name}的状态`} aria-label={`查看${character.name}的状态`}><ClipboardList size={18} /></button>
        </div>
      ))}
    </div>
  )
}

function CharacterStatusOverlay({ character, onClose }: { character?: CharacterProfile; onClose: () => void }) {
  if (!character) return null
  const status = character.statusBar?.trim()
  return (
    <button type="button" className="character-status-overlay" onClick={(event) => { event.stopPropagation(); onClose() }} aria-label={`关闭${character.name}的状态栏`}>
      <section className="character-status-window" style={{ borderColor: character.color }} aria-label={`${character.name}的状态栏`}>
        <header><span className="character-status-icon" style={{ color: character.color }}><ClipboardList size={19} /></span><strong style={{ color: character.color }}>{character.name}</strong><span>状态</span></header>
        {status ? <div className="character-status-content">{status}</div> : <div className="character-status-empty">暂无状态记录</div>}
      </section>
    </button>
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

function RawResponseDialog({ requestContent, content, repairContent, memorySummaryContent, onClose }: { requestContent: string; content: string; repairContent?: string; memorySummaryContent?: string; onClose: () => void }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="对话 Debug">
      <button className="backdrop" onClick={onClose} aria-label="关闭对话 Debug" />
      <section className="modal debug-modal">
        <div className="modal-head">
          <div><span className="eyebrow">REQUEST / RESPONSE</span><h2>对话 Debug</h2></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button>
        </div>
        <div className="debug-sections">
          <section className="debug-section">
            <h3>客户端发送的用户提示词</h3>
            <pre className="debug-response">{requestContent || '当前RPG还没有用户提示词。'}</pre>
          </section>
          <section className="debug-section">
            <h3>LLM 返回的原始输出</h3>
            <pre className="debug-response">{content || '当前RPG还没有 LLM 返回内容。'}{repairContent ? `\n\n===== 自动补选项返回原文 =====\n${repairContent}` : ''}</pre>
          </section>
          <section className="debug-section">
            <h3>记忆总结调用</h3>
            <pre className="debug-response">{memorySummaryContent || '本轮对话没有触发记忆总结。'}</pre>
          </section>
        </div>
      </section>
    </div>
  )
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

export default App
