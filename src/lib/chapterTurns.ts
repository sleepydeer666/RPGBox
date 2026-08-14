import type { Choice, GameSession, ParsedResponse } from '../types'

export const CHAPTER_END_MARKER = '（结束章节）'
export const CHAPTER_ENDING_CHOICE_INSTRUCTION = `在输出的选项中，提供至少一个用于推动本章节结束的选项，并标记${CHAPTER_END_MARKER}`
export const CHAPTER_ENDING_FORBIDDEN_INSTRUCTION = '当前处于游戏开场或章节过渡阶段，不存在可结束的当前章节。过渡过程中不会触发章节结束逻辑，因此不得输出“[章节结束]”，无需生成或标记任何“（结束章节）”选项；请直接建立新章节的剧情引子并输出普通后续选项。'
export const CHAPTER_NAMING_INSTRUCTION = '请在RPG状态中给新的章节命名'

export function buildTurnChoiceInstruction(
  game: Pick<GameSession, 'messages' | 'newStoryChoiceCount'>,
  endsChapter: boolean,
): string {
  const choiceCount = Math.min(10, Math.max(4, Math.round(Number(game.newStoryChoiceCount) || 4)))
  if (endsChapter) {
    return `结束本章节，并开启新章节的剧情引子。之后输出${choiceCount}个后续选项，具体要求需参考章节切换规则中的相应内容`
  }
  const isNewGame = !game.messages.some((message) => message.role === 'user')
  if (isNewGame) {
    return `输出${choiceCount}个后续选项，具体要求需参考章节切换规则中的相应内容`
  }
  return '输出4个后续选项'
}

export function buildTurnInstructions(
  game: Pick<GameSession, 'messages' | 'newStoryChoiceCount' | 'narrative' | 'recommendedChapterTurnsEnabled' | 'recommendedChapterTurns' | 'chapterTransitionRules'>,
  endsChapter: boolean,
): string[] {
  const isNewGame = !game.messages.some((message) => message.role === 'user')
  const instructions = [buildTurnChoiceInstruction(game, endsChapter)]
  if (!endsChapter && shouldSuggestChapterEnding(game)) instructions.push(CHAPTER_ENDING_CHOICE_INSTRUCTION)
  if (shouldRequestNewChapterName(game)) instructions.push(CHAPTER_NAMING_INSTRUCTION)
  const transitionRules = (game.chapterTransitionRules ?? '').trim()
  if ((isNewGame || endsChapter) && transitionRules) {
    instructions.push(`章节切换规则：\n${transitionRules}`)
  }
  if (!endsChapter && (isNewGame || !game.narrative.chapter.title.trim())) {
    instructions.push(CHAPTER_ENDING_FORBIDDEN_INSTRUCTION)
  }
  return instructions
}

export function shouldRequestNewChapterName(game: Pick<GameSession, 'messages'>): boolean {
  const recentAssistantMessages = game.messages
    .filter((message) => message.role === 'assistant' && message.chapterTitle !== undefined)
    .slice(-2)
  return recentAssistantMessages.length === 2
    && recentAssistantMessages.every((message) => !message.chapterTitle?.trim())
}

export function selectedChoiceEndsChapter(choices: Choice[], selectedChoiceIds: string[]): boolean {
  const selectedIds = new Set(selectedChoiceIds.map((id) => id.toUpperCase()))
  return choices.some((choice) => selectedIds.has(choice.id.toUpperCase()) && choice.text.includes(CHAPTER_END_MARKER))
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

export function reportedChapterTitle(parsed: ParsedResponse): string | undefined {
  const boundary = [...parsed.progressEvents].reverse().find((event) =>
    event.type === 'chapter_start' || event.type === 'chapter_end')
  if (boundary?.type === 'chapter_end') return ''
  if (boundary?.type === 'chapter_start') return boundary.title?.trim() ?? ''
  return parsed.chapterTitle?.trim()
}

export function shouldSuggestChapterEnding(game: Pick<GameSession, 'messages' | 'narrative' | 'recommendedChapterTurnsEnabled' | 'recommendedChapterTurns'>): boolean {
  if (!game.recommendedChapterTurnsEnabled) return false
  const threshold = Math.min(30, Math.max(10, Math.round(game.recommendedChapterTurns ?? 20)))
  return currentChapterTurnCount(game) >= threshold
}
