import { AlertTriangle, Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronUp, ChevronsDown, ChevronsUp, CircleStop, Clock3, Flag, History, MapPin, Menu, RotateCcw, Send, Server, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import GameDrawer from './components/GameDrawer'
import GameSettingsDialog from './components/GameSettingsDialog'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'
import { createBlankGame, createInitialGame } from './game'
import { tokenizeCharacterNames, tokenizeNarrationText } from './lib/characterText'
import { resolveCharacterExpression } from './lib/expressions'
import { buildHistoryLines } from './lib/history'
import { currentChapterSummary, normalizeMemoryState, partitionRecentChapterMemories, recentChapterMemories } from './lib/memory'
import { parseAssistantResponse, visibleStory } from './lib/parser'
import { completeStreamingLines, resolvePlayback } from './lib/playback'
import { portraitSource } from './lib/portraits'
import { deletePortraitFile } from './lib/portraits'
import { cloneGameSession, exportRpgbox, importRpgbox, type RpgExportOptions } from './lib/rpgPackage'
import { buildStructureRepairMessages, buildSystemPrompt, takeRecentConversationTurns, toApiMessages } from './lib/prompt'
import { mergeStructureRepair } from './lib/repair'
import { appendRollbackSnapshot, createRollbackSnapshot, restoreLastRollback } from './lib/rollback'
import { applyStatePatch } from './lib/state'
import { collectRecentActors, type StageActor, type StageTurn } from './lib/stage'
import { streamCompletion } from './services/openai'
import { createInitialProviderState, loadState, saveState } from './storage'
import type { ChapterMemory, CharacterProfile, ChatMessage, Choice, GameSession, MemoryState, PortraitGroup, ProviderProfile, StorySegment } from './types'

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const CLOSE_CHAPTER_INSTRUCTION = '尽快收尾本章节，然后开启一段过渡剧情为新章节做准备；如果前后章节紧密连贯，也可以直接开始新章节。'

function App() {
  const defaults = createInitialProviderState()
  const initialGame = createInitialGame()
  const [providers, setProviders] = useState<ProviderProfile[]>(defaults.providers)
  const [activeProviderId, setActiveProviderId] = useState(defaults.activeProviderId)
  const [globalJailbreakPrompt, setGlobalJailbreakPrompt] = useState('')
  const [games, setGames] = useState<GameSession[]>([initialGame])
  const [activeGameId, setActiveGameId] = useState(initialGame.id)
  const [segmentPositions, setSegmentPositions] = useState<Record<string, number>>({ [initialGame.id]: 0 })
  const [selectedChoices, setSelectedChoices] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')
  const [gameDrawerOpen, setGameDrawerOpen] = useState(false)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summarizingMemory, setSummarizingMemory] = useState<'chapter' | 'history' | null>(null)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const activeGame = games.find((game) => game.id === activeGameId) ?? games[0]
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
  const latestAssistant = [...activeGame.messages].reverse().find((message) => message.role === 'assistant')
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
  const previousStageTurns = useMemo(() => activeGame.messages.flatMap((message): StageTurn[] => {
    if (message.role !== 'assistant' || message.id === latestAssistant?.id) return []
    const parsed = parseAssistantResponse(message.content, { characters: activeGame.characters })
    return [{ segments: parsed.segments, sceneChanged: parsed.sceneChanged }]
  }), [activeGame.characters, activeGame.messages, latestAssistant?.id])
  const currentStageParse = busy ? streamingParsed : latestParsed
  const displayGameState = applyStatePatch(activeGame.gameState, currentStageParse.gameData?.statePatch)
  const displayChapterTitle = currentStageParse.chapterTitle !== undefined
    ? currentStageParse.chapterTitle.trim()
    : activeGame.narrative.chapter.title.trim()
  const dialogueActors = collectRecentActors([
    ...previousStageTurns,
    { segments: playback.segments.slice(0, segmentIndex + 1), sceneChanged: currentStageParse.sceneChanged },
  ], activeGame.characters, 2, displayGameState.contentMode)
  const choiceActors = collectRecentActors([
    ...previousStageTurns,
    { segments: latestParsed.segments, sceneChanged: latestParsed.sceneChanged },
  ], activeGame.characters, 4, displayGameState.contentMode)
  const historyLines = useMemo(
    () => buildHistoryLines(activeGame.messages, busy ? latestAssistant?.id : undefined, activeGame.characters),
    [activeGame.characters, activeGame.messages, busy, latestAssistant?.id],
  )

  useEffect(() => {
    void loadState().then((saved) => {
      if (saved.providers?.length) setProviders(saved.providers)
      if (saved.activeProviderId) setActiveProviderId(saved.activeProviderId)
      if (saved.globalJailbreakPrompt) setGlobalJailbreakPrompt(saved.globalJailbreakPrompt)
      if (saved.games?.length) setGames(saved.games)
      if (saved.activeGameId) setActiveGameId(saved.activeGameId)
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => void saveState({ providers, activeProviderId, globalJailbreakPrompt, games, activeGameId }), 250)
    return () => window.clearTimeout(timer)
  }, [activeGameId, activeProviderId, games, globalJailbreakPrompt, hydrated, providers])

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

  async function createGame(title: string, importFile: string) {
    const blank = createBlankGame(games.length + 1, configuredProvider)
    const imported = importFile ? await importRpgbox(importFile, blank) : blank
    const game = { ...imported, title: title.trim() || blank.title, updatedAt: Date.now() }
    setGames((current) => [...current, game])
    setActiveGameId(game.id)
    const latest = [...game.messages].reverse().find((message) => message.role === 'assistant')
    const parsed = parseAssistantResponse(latest?.content ?? '', { characters: game.characters })
    setSegmentPositions((current) => ({ ...current, [game.id]: Math.max(0, parsed.segments.length - 1) }))
    setSelectedChoices([])
    setCustomInput('')
    setGameDrawerOpen(false)
  }

  async function deleteGame(gameId: string) {
    const target = games.find((game) => game.id === gameId)
    if (!target) return
    await Promise.all(target.characters.flatMap((character) => character.portraits.map((portrait) => deletePortraitFile(portrait.uri))))
    const remaining = games.filter((game) => game.id !== gameId)
    const nextGames = remaining.length ? remaining : [createBlankGame(1, configuredProvider)]
    setGames(nextGames)
    if (activeGameId === gameId) {
      setActiveGameId(nextGames[0].id)
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

  function updateRpgMetadata(gameId: string, title: string, note: string) {
    updateGame(gameId, (game) => ({ ...game, title: title.trim() || '未命名RPG', note: note.trim(), updatedAt: Date.now() }))
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

  function chapterMessages(game: GameSession, messages: ChatMessage[], chapterTitle = game.narrative.chapter.title) {
    const start = messages.findIndex((message) => message.id === game.narrative.chapter.startedAtMessageId)
    const range = start >= 0 ? messages.slice(start) : messages
    return range.filter((message) => message.chapterTitle === undefined || message.chapterTitle === chapterTitle)
  }

  function memoryTranscript(messages: ChatMessage[]) {
    return messages.map((message) => `${message.role === 'user' ? '用户指令' : '剧情'}：${message.role === 'assistant' ? parseAssistantResponse(message.content).story : message.content}`).join('\n\n')
  }

  async function summarizeChapterMemory(game: GameSession, sourceMessages: ChatMessage[], chapterTitle: string, signal: AbortSignal) {
    if (!activeProvider || !chapterTitle.trim()) return undefined
    const transcript = memoryTranscript(chapterMessages(game, sourceMessages, chapterTitle))
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    return (await streamCompletion({ provider, signal, messages: [
      { role: 'system', content: '你负责总结短篇RPG中一个已经完成或正在进行的章节。只记录本章节实际发生的新事件、获得的情报和经验、人物心态或关系变化，以及值得以后回调的场面。世界观、故事总背景、人物固定身份、外貌、性格、服饰、口癖、能力等既有人物设定，以及系统规则和玩法说明都可由系统提示词重建，禁止写入记忆。删除引子、章节间过渡、普通对话、流水账和短期状态，不续写剧情，只输出简洁的中文章节摘要。' },
      { role: 'user', content: `章节名称：${chapterTitle}\n\n已有的本章摘要：\n${currentChapterSummary(game.memory) || '无'}\n\n本章剧情：\n${transcript}` },
    ] })).trim()
  }

  async function summarizeDistantMemory(existing: string, chapters: ChapterMemory[], signal: AbortSignal) {
    if (!activeProvider) return undefined
    const provider = { ...activeProvider, temperature: 0.2, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: Math.min(1600, activeProvider.maxTokens) }
    return (await streamCompletion({ provider, signal, messages: [
      { role: 'system', content: '你负责维护短篇RPG的远期记忆。把既有远期记忆与移出的旧章节摘要统一压缩，只保留跨章节仍有价值的重大事件、持久关系或心态变化、重要经验和少数值得偶尔回忆的亮点。禁止写入世界背景、固定人物设定、系统规则、普通过程和短期状态。不要续写剧情，只输出精简的中文远期记忆。' },
      { role: 'user', content: `既有远期记忆：\n${existing || '无'}\n\n移出的旧章节：\n${chapters.map((chapter) => `### ${chapter.title}\n${chapter.summary}`).join('\n\n') || '无，仅整理既有远期记忆'}` },
    ] })).trim()
  }

  async function summarizeMemoryNow(kind: 'chapter' | 'history') {
    if (busy || summarizingMemory || !activeProvider) return
    setSummarizingMemory(kind)
    setError('')
    try {
      const signal = new AbortController().signal
      const result = kind === 'chapter'
        ? await summarizeChapterMemory(activeGame, activeGame.messages, activeGame.narrative.chapter.title, signal)
        : await summarizeDistantMemory(activeGame.memory.historicalSummary, [], signal)
      if (result) updateGame(activeGame.id, (game) => ({
        ...game,
        memory: kind === 'chapter'
          ? { ...normalizeMemoryState(game.memory), currentChapterSummary: result }
          : { ...normalizeMemoryState(game.memory), historicalSummary: result },
        updatedAt: Date.now(),
      }))
    } catch (summaryError) {
      setError(`手工总结失败：${toErrorMessage(summaryError)}`)
    } finally {
      setSummarizingMemory(null)
    }
  }

  async function sendTurn(forcedInput?: string) {
    const choiceText = selectedChoices.join('')
    const supplement = customInput.trim()
    const input = forcedInput?.trim() || [choiceText, supplement].filter(Boolean).join('，但是')
    if (!input || busy || summarizingMemory || !activeProvider) return

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
    const requestMessages = [...gameSnapshot.messages, userMessage]
    const rollbackSnapshot = createRollbackSnapshot(gameSnapshot, newId('rollback'))
    updateGame(gameId, (game) => ({ ...game, messages: [...requestMessages, pendingAssistant], rollbackLog: appendRollbackSnapshot(game.rollbackLog, rollbackSnapshot), updatedAt: Date.now() }))

    try {
      let fullText = await streamCompletion({
        provider: activeProvider,
        messages: toApiMessages(
          buildSystemPrompt(gameSnapshot, globalJailbreakPrompt),
          takeRecentConversationTurns(requestMessages, gameSnapshot.aiSettings.contextTurns),
        ),
        signal: controller.signal,
        onToken: (content) => updateGame(gameId, (game) => ({ ...game, messages: [...requestMessages, { ...pendingAssistant, content }], updatedAt: Date.now() })),
      })
      const rawContent = fullText
      let repairContent: string | undefined
      let parsed = parseAssistantResponse(fullText, { characters: gameSnapshot.characters })
      if (!parsed.choices.length && visibleStory(fullText)) {
        try {
          const repairResponse = await streamCompletion({
            provider: {
              ...activeProvider,
              temperature: 0.2,
              topP: 1,
              presencePenalty: 0,
              frequencyPenalty: 0,
              maxTokens: Math.min(1600, activeProvider.maxTokens),
            },
            messages: buildStructureRepairMessages(gameSnapshot, globalJailbreakPrompt, visibleStory(fullText)),
            signal: controller.signal,
          })
          repairContent = repairResponse
          const repaired = mergeStructureRepair(fullText, repairResponse)
          if (repaired) {
            fullText = repaired
            parsed = parseAssistantResponse(fullText, { characters: gameSnapshot.characters })
          } else {
            setError('剧情已保存，但模型未能生成有效选项；仍可输入自定义行动。')
          }
        } catch {
          if (!controller.signal.aborted) setError('剧情已保存，但自动补全选项失败；仍可输入自定义行动。')
        }
      }
      const legacyChapterStart = [...parsed.progressEvents].reverse().find((event) => event.type === 'chapter_start')
      const legacyChapterEnd = parsed.progressEvents.some((event) => event.type === 'chapter_end')
      const reportedChapter = parsed.chapterTitle !== undefined
        ? parsed.chapterTitle.trim()
        : legacyChapterStart?.title?.trim() ?? (legacyChapterEnd ? '' : undefined)
      const previousChapter = gameSnapshot.narrative.chapter.title.trim()
      const turnChapter = reportedChapter === undefined ? previousChapter : reportedChapter
      const chapterChanged = reportedChapter !== undefined && turnChapter !== previousChapter
      const completedUser = { ...userMessage, chapterTitle: turnChapter }
      const completedAssistant = { ...pendingAssistant, content: fullText, rawContent, repairContent, chapterTitle: turnChapter }
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
      const draftMemory: ChapterMemory | undefined = chapterChanged && previousChapter && draftSummary ? {
        id: gameSnapshot.narrative.chapter.id,
        title: previousChapter,
        summary: draftSummary,
        completedAt: Date.now(),
      } : undefined
      const memoryAfterBoundary = chapterChanged ? {
        ...normalizedMemory,
        currentChapterSummary: '',
        recentChapters: draftMemory
          ? [...recentChapterMemories(normalizedMemory).filter((chapter) => chapter.id !== draftMemory.id), draftMemory]
          : recentChapterMemories(normalizedMemory),
      } : normalizedMemory
      const statusUpdates = gameSnapshot.statusRulesPrompt?.trim()
        ? new Map(parsed.characterStatusUpdates.map((update) => [update.characterId, update.status]))
        : new Map<string, string>()
      updateGame(gameId, (game) => ({
        ...game,
        messages: completeMessages,
        gameState: applyStatePatch(game.gameState, parsed.gameData?.statePatch),
        characters: statusUpdates.size
          ? game.characters.map((character) => statusUpdates.has(character.id)
            ? { ...character, statusBar: statusUpdates.get(character.id) }
            : character)
          : game.characters,
        narrative: nextNarrative,
        memory: memoryAfterBoundary,
        updatedAt: Date.now(),
      }))

      if (chapterChanged && previousChapter) {
        try {
          const summary = await summarizeChapterMemory(gameSnapshot, gameSnapshot.messages, previousChapter, controller.signal)
          if (summary) {
            const completedChapter: ChapterMemory = {
              id: gameSnapshot.narrative.chapter.id,
              title: previousChapter,
              summary,
              completedAt: Date.now(),
            }
            const recent = [...recentChapterMemories(normalizedMemory).filter((chapter) => chapter.id !== completedChapter.id), completedChapter]
            const { overflow, retained: retainedWithinLimit } = partitionRecentChapterMemories(recent, normalizedMemory.recentChapterLimit)
            let historicalSummary = normalizedMemory.historicalSummary
            let retained = recent
            if (overflow.length) {
              const distant = await summarizeDistantMemory(historicalSummary, overflow, controller.signal)
              if (distant) {
                historicalSummary = distant
                retained = retainedWithinLimit
              }
            }
            updateGame(gameId, (game) => ({
              ...game,
              memory: {
                ...normalizeMemoryState(game.memory),
                currentChapterSummary: '',
                recentChapters: retained,
                historicalSummary,
              },
              updatedAt: Date.now(),
            }))
          }
        } catch (summaryError) {
          if (!controller.signal.aborted) setError(`章节已切换，但上一章节总结失败：${toErrorMessage(summaryError)}`)
        }
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
            <span className={`content-mode ${displayGameState.contentMode}`}>{displayGameState.contentMode === 'nsfw' ? 'NSFW' : '常规'}</span>
          </div>
          {choicesVisible ? (
            <ChoiceScene choices={latestParsed.choices} selectedChoices={selectedChoices} actors={choiceActors} characters={activeGame.characters} mode={displayGameState.contentMode} onToggle={toggleChoice} onCloseChapter={() => void sendTurn(CLOSE_CHAPTER_INSTRUCTION)} />
          ) : busy && currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueActors} mode={displayGameState.contentMode} streaming />
          ) : busy ? (
            <NarrationScene text={currentSegment?.text || '正在生成'} characters={activeGame.characters} actors={dialogueActors} mode={displayGameState.contentMode} streaming />
          ) : currentSegment?.type === 'dialogue' ? (
            <DialogueScene segment={currentSegment} characters={activeGame.characters} actors={dialogueActors} mode={displayGameState.contentMode} />
          ) : (
            <NarrationScene text={currentSegment?.text || '...'} characters={activeGame.characters} actors={dialogueActors} mode={displayGameState.contentMode} />
          )}
        </div>

        <footer className={`interaction-dock ${!busy && segmentsComplete ? 'composer-mode' : 'playback-mode'}`}>
          {error && <div className="error-banner">{error}<button onClick={() => setError('')} title="关闭"><X size={15} /></button></div>}
          <div className="dock-main">
            <button className="rewind-button" onClick={rewindSegment} disabled={busy || segmentIndex <= 0} title="返回上一段"><ChevronLeft size={21} /></button>
            {busy ? (
              <div className="playback-info">
                <div className="narrative-position">{displayChapterTitle || '章节间过渡'}</div>
                <div className="generation-status" aria-live="polite">
                  <span>{streamingParsed.segments.length ? `${segmentIndex + 1} / ${streamingParsed.segments.length}` : '0 / 0'} · <span className="generation-label">生成中</span></span>
                  <button className="send-button stop" onClick={() => { abortRef.current?.abort(); setBusy(false) }} title="停止生成"><CircleStop size={20} /></button>
                </div>
              </div>
            ) : segmentsComplete ? (
              <div className="composer"><textarea value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendTurn() } }} placeholder={selectedChoices.length ? '补充行动（可选）' : '输入自定义行动'} rows={1} /><button className="send-button" onClick={() => void sendTurn()} disabled={!customInput.trim() && !selectedChoices.length} title="发送行动"><Send size={19} /></button></div>
            ) : (
              <div className="playback-info">
                <div className="narrative-position">{displayChapterTitle || '章节间过渡'}</div>
                <div className="playback-status">{latestParsed.segments.length ? `${segmentIndex + 1} / ${latestParsed.segments.length} · 完成` : '等待剧情'}</div>
              </div>
            )}
          </div>
        </footer>
      </main>

      <GameDrawer open={gameDrawerOpen} games={games} activeGameId={activeGame.id} onClose={() => setGameDrawerOpen(false)} onSelect={selectGame} onCreate={createGame} onUpdateMetadata={updateRpgMetadata} onDelete={deleteGame} onClone={cloneGame} onExport={exportGame} onOpenSettings={() => { setGameDrawerOpen(false); setGlobalSettingsOpen(true) }} />
      {gameSettingsOpen && <GameSettingsDialog game={activeGame} providers={providers} fullSystemPrompt={buildSystemPrompt(activeGame, globalJailbreakPrompt)} onClose={() => setGameSettingsOpen(false)} onChange={(nextGame) => updateGame(activeGame.id, () => nextGame)} />}
      {globalSettingsOpen && <GlobalSettingsDialog providers={providers} activeProviderId={activeProviderId} globalJailbreakPrompt={globalJailbreakPrompt} onClose={() => setGlobalSettingsOpen(false)} onChangeProviders={setProviders} onChangeActive={setActiveProviderId} onChangeGlobalJailbreakPrompt={setGlobalJailbreakPrompt} />}
      {historyOpen && <HistoryDialog lines={historyLines} characters={activeGame.characters} onResetStory={resetStory} onClose={() => setHistoryOpen(false)} />}
      {debugOpen && <RawResponseDialog content={latestAssistant?.rawContent ?? latestAssistant?.content ?? ''} repairContent={latestAssistant?.repairContent} onClose={() => setDebugOpen(false)} />}
      {memoryOpen && <MemoryDialog game={activeGame} summarizing={summarizingMemory} onSummarize={summarizeMemoryNow} onChange={(memory) => updateGame(activeGame.id, (game) => ({ ...game, memory, updatedAt: Date.now() }))} onClose={() => setMemoryOpen(false)} />}
      {rollbackConfirmOpen && <RollbackConfirmDialog onCancel={() => setRollbackConfirmOpen(false)} onConfirm={() => { setRollbackConfirmOpen(false); rollbackTurn() }} />}
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
  summarizing: 'chapter' | 'history' | null
  onSummarize: (kind: 'chapter' | 'history') => Promise<void>
  onChange: (memory: MemoryState) => void
  onClose: () => void
}) {
  const memory = normalizeMemoryState(game.memory)
  const recent = recentChapterMemories(memory)
  const currentTitle = game.narrative.chapter.title.trim()

  function patchRecentChapter(id: string, summary: string) {
    onChange({
      ...memory,
      recentChapters: recent.map((chapter) => chapter.id === id ? { ...chapter, summary } : chapter),
    })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="backdrop" onClick={onClose} aria-label="关闭" />
      <section className="modal memory-modal">
        <div className="modal-head"><div><span className="eyebrow">NARRATIVE MEMORY</span><h2>主记忆与远期记忆</h2></div><button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button></div>
        <div className="memory-editors">
          <section className="memory-primary-editor">
            <span className="memory-editor-head"><span>主记忆</span><button type="button" className="secondary-button compact" onClick={() => void onSummarize('chapter')} disabled={Boolean(summarizing) || !currentTitle}><Brain size={14} />{summarizing === 'chapter' ? '总结中' : '总结当前章节'}</button></span>
            <div className="recent-memory-list">
              {currentTitle ? <label><span>当前：{currentTitle}</span><textarea value={currentChapterSummary(memory)} onChange={(event) => onChange({ ...memory, currentChapterSummary: event.target.value })} placeholder="当前章节尚未总结" /></label> : <div className="empty-memory">当前处于章节间过渡，不生成章节记忆。</div>}
              {recent.map((chapter) => <label key={chapter.id}><span>{chapter.title}</span><textarea value={chapter.summary} onChange={(event) => patchRecentChapter(chapter.id, event.target.value)} /></label>)}
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

function DialogueScene({ segment, characters, actors, mode, streaming = false }: { segment: StorySegment; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean }) {
  const character = characters.find((item) => item.id === segment.characterId)
    ?? characters.find((item) => item.name === segment.characterName)
  const { portrait, displayExpression } = resolveCharacterExpression(character, segment.expression, mode)
  const color = character?.color || '#d3ab61'
  const speakerName = character?.role === 'player'
    ? `${character.name}（你）`
    : character?.name || segment.characterName || segment.characterId
  return (
    <StoryScene
      actors={actors.length ? actors : portrait && character ? [{ character, expression: segment.expression ?? '' }] : []}
      activeCharacterId={portrait ? character?.id : undefined}
      mode={mode}
    >
      <div className={`dialogue-box ${streaming ? 'streaming' : ''}`} style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 14%, rgba(18, 19, 17, 0.96))` }}>
        <div className="speaker-line"><strong style={{ color }}>{speakerName}</strong><span>{displayExpression}</span></div>
        <p><CharacterText text={segment.text} characters={characters} /></p>
      </div>
    </StoryScene>
  )
}

function NarrationScene({ text, characters, actors, mode, streaming = false }: { text: string; characters: CharacterProfile[]; actors: StageActor[]; mode: PortraitGroup; streaming?: boolean }) {
  return (
    <StoryScene actors={actors} mode={mode}>
      <div className={`narration-panel ${streaming ? 'streaming' : ''}`}><p><CharacterText text={text} characters={characters} narration /></p></div>
    </StoryScene>
  )
}

function ChoiceScene({ choices, selectedChoices, actors, characters, mode, onToggle, onCloseChapter }: { choices: Choice[]; selectedChoices: string[]; actors: StageActor[]; characters: CharacterProfile[]; mode: PortraitGroup; onToggle: (choice: Choice) => void; onCloseChapter: () => void }) {
  return (
    <StoryScene actors={actors} mode={mode} className="choice-scene">
      <section className="choice-overlay" aria-label="剧情选项" onClick={(event) => event.stopPropagation()}>
        <div className="selection-heading">
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

function StoryScene({ actors, activeCharacterId, mode, className = '', children }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup; className?: string; children: React.ReactNode }) {
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
      ><StagePortraits actors={actors} activeCharacterId={activeCharacterId} mode={mode} /></div>
      <div className="content-zone" ref={contentRef}>{children}</div>
    </div>
  )
}

function StagePortraits({ actors, activeCharacterId, mode }: { actors: StageActor[]; activeCharacterId?: string; mode: PortraitGroup }) {
  const visibleActors = actors.flatMap((actor) => {
    const resolved = resolveCharacterExpression(actor.character, actor.expression, mode)
    return resolved.portrait ? [{ ...actor, portrait: resolved.portrait }] : []
  })
  return (
    <div className={`stage-portrait-layer count-${visibleActors.length}`} aria-hidden="true">
      {visibleActors.map(({ character, portrait }, index) => {
        const active = activeCharacterId === character.id
        const inactive = Boolean(activeCharacterId) && !active
        return <div className={`stage-portrait slot-${index + 1} has-image ${active ? 'active' : ''} ${inactive ? 'inactive' : ''}`} key={character.id}>
          <img src={portraitSource(portrait.uri)} alt="" />
        </div>
      })}
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

function RawResponseDialog({ content, repairContent, onClose }: { content: string; repairContent?: string; onClose: () => void }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="AI 返回原文">
      <button className="backdrop" onClick={onClose} aria-label="关闭 AI 返回原文" />
      <section className="modal debug-modal">
        <div className="modal-head">
          <div><span className="eyebrow">RAW RESPONSE</span><h2>AI 返回原文</h2></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button>
        </div>
        <pre className="debug-response">{content || '当前RPG还没有 AI 返回内容。'}{repairContent ? `\n\n===== 自动补选项返回原文 =====\n${repairContent}` : ''}</pre>
      </section>
    </div>
  )
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

export default App
