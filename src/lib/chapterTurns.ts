import type { Choice, GameSession } from '../types'

export const CHAPTER_END_MARKER = '（结束章节）'
export const CHAPTER_ENDING_CHOICE_INSTRUCTION = `至少一个选项还必须在后续叙事模式标签之后标记${CHAPTER_END_MARKER}。`
export const CHAPTER_CONTINUE_INSTRUCTION = '当前尽量不要生成章节结束的选项，保持故事推进。'
export const PREFER_EROTIC_CHOICES_INSTRUCTION = '选项内容优先推动向色情方向发展。'
export const CHAPTER_NAMING_INSTRUCTION = '紧接“[状态]”行输出“[新章节] 章节名称”。'
const NEW_CHAPTER_DIRECTIONS_INSTRUCTION = '这些选项应涵盖不同角色、不同场景和不同故事方向。它们用于选择并开启下一章节，不是在结束章节；所有选项均不得添加“（结束章节）”标签。'

export function buildTurnChoiceInstruction(
  game: Pick<GameSession, 'messages' | 'newStoryChoiceCount' | 'narrative'>,
  startsNewTransition: boolean,
): string {
  const choiceCount = Math.min(10, Math.max(4, Math.round(Number(game.newStoryChoiceCount) || 4)))
  if (startsNewTransition && game.narrative.chapterPhase === 'transition') {
    return `继续章节间过渡，并生成${choiceCount}个新章节故事方向选项。${NEW_CHAPTER_DIRECTIONS_INSTRUCTION}`
  }
  if (startsNewTransition) {
    return `收尾上一章节，并生成${choiceCount}个新章节故事方向选项。${NEW_CHAPTER_DIRECTIONS_INSTRUCTION}`
  }
  if (game.narrative.chapterPhase === 'opening') {
    return `生成${choiceCount}个新章节故事方向选项。${NEW_CHAPTER_DIRECTIONS_INSTRUCTION}`
  }
  return '输出4个后续选项'
}

export function buildTurnInstructions(
  game: Pick<GameSession, 'messages' | 'newStoryChoiceCount' | 'narrative' | 'recommendedChapterTurnsEnabled' | 'recommendedChapterTurns' | 'chapterTransitionRules'>,
  startsNewTransition: boolean,
  preferEroticChoices = false,
): string[] {
  const isNewGame = !game.messages.some((message) => message.role === 'user')
  const instructions = [buildTurnChoiceInstruction(game, startsNewTransition)]
  if (!startsNewTransition && game.narrative.chapterPhase === 'active') {
    instructions.push(shouldSuggestChapterEnding(game)
      ? CHAPTER_ENDING_CHOICE_INSTRUCTION
      : CHAPTER_CONTINUE_INSTRUCTION)
  }
  if (preferEroticChoices) instructions.push(PREFER_EROTIC_CHOICES_INSTRUCTION)
  if (!startsNewTransition && shouldRequestNewChapterName(game)) instructions.push(CHAPTER_NAMING_INSTRUCTION)
  const transitionRules = (game.chapterTransitionRules ?? '').trim()
  if ((isNewGame || startsNewTransition) && transitionRules) {
    instructions.push(`章节切换规则：\n${transitionRules}`)
  }
  return instructions
}

export function shouldRequestNewChapterName(game: Pick<GameSession, 'narrative'>): boolean {
  return game.narrative.chapterPhase === 'transition'
}

export function buildChapterProgressInstruction(
  game: Pick<GameSession, 'messages' | 'narrative' | 'recommendedChapterTurnsEnabled' | 'recommendedChapterTurns'>,
): string {
  if (game.narrative.chapterPhase !== 'active' || !game.narrative.chapter.title.trim()) {
    return '当前章节：章节间过渡。'
  }
  const turns = currentChapterTurnCount(game)
  const maximum = game.recommendedChapterTurnsEnabled
    ? `/${Math.min(30, Math.max(10, Math.round(game.recommendedChapterTurns ?? 20)))}`
    : ''
  return `当前章节：${game.narrative.chapter.title.trim()}；本章进度：${turns}${maximum}轮。`
}

export function selectedChoiceEndsChapter(choices: Choice[], selectedChoiceIds: string[]): boolean {
  const selectedIds = new Set(selectedChoiceIds.map((id) => id.toUpperCase()))
  return choices.some((choice) => selectedIds.has(choice.id.toUpperCase()) && choice.text.includes(CHAPTER_END_MARKER))
}

export function acceptNewChapterTitle(value: string | undefined, authorized: boolean): string | undefined {
  if (!authorized) return undefined
  const title = value?.trim()
  return title || undefined
}

export function currentChapterTurnCount(game: Pick<GameSession, 'messages' | 'narrative'>): number {
  const chapterTitle = game.narrative.chapter.title.trim()
  if (!chapterTitle) return 0
  const startIndex = game.messages.findIndex((message) => message.id === game.narrative.chapter.startedAtMessageId)
  const chapterMessages = startIndex >= 0 ? game.messages.slice(startIndex) : game.messages
  return chapterMessages.filter((message) =>
    message.role === 'user'
    && (message.chapterTitle === undefined || message.chapterTitle === chapterTitle),
  ).length
}

export function chapterTurnCountBeforeLatestBoundary(
  game: Pick<GameSession, 'messages' | 'narrative' | 'rollbackLog'>,
  assistantIndex: number,
): number {
  const snapshot = [...(game.rollbackLog ?? [])].reverse().find((item) => item.messageCount === assistantIndex - 1)
  if (!snapshot?.narrative.chapter.title.trim()) return currentChapterTurnCount(game)
  return currentChapterTurnCount({
    messages: game.messages.slice(0, snapshot.messageCount),
    narrative: snapshot.narrative,
  }) + 1
}

export function shouldSuggestChapterEnding(game: Pick<GameSession, 'messages' | 'narrative' | 'recommendedChapterTurnsEnabled' | 'recommendedChapterTurns'>): boolean {
  if (game.narrative.chapterPhase !== 'active') return false
  if (!game.recommendedChapterTurnsEnabled) return false
  const threshold = Math.min(30, Math.max(10, Math.round(game.recommendedChapterTurns ?? 20)))
  return currentChapterTurnCount(game) >= threshold
}
