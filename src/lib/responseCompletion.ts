import type { GameSession } from '../types'
import { parseAssistantResponse } from './parser'

export interface ResponseCompletionState {
  canContinue: boolean
  complete: boolean
  hasChoices: boolean
  choicesComplete: boolean
  statusesComplete: boolean
  expectedChoiceCount: number
  missingStatusCharacterIds: string[]
}

export interface ContinuationMergeResult {
  text: string
  aligned: boolean
  spliceOffset?: number
}

export function responseContinuationInstruction(completion: ResponseCompletionState): string {
  const instructions = [
    ...(!completion.choicesComplete ? ['按要求补全选项'] : []),
    ...(!completion.statusesComplete ? ['按要求输出状态栏更新'] : []),
  ]
  return instructions.join('，并') || '继续输出完整'
}

export function inspectLatestResponseCompletion(game: GameSession): ResponseCompletionState {
  const assistantIndex = game.messages.map((message) => message.role).lastIndexOf('assistant')
  const assistant = game.messages[assistantIndex]
  const canContinue = assistantIndex > 0 && game.messages[assistantIndex - 1]?.role === 'user'
  const parsed = parseAssistantResponse(assistant?.rawContent ?? assistant?.content ?? '', { characters: game.characters })
  const expectedChoiceCount = 4
  const choiceIds = new Set(parsed.choices.map((choice) => choice.id.toUpperCase()))
  const choicesComplete = Array.from({ length: expectedChoiceCount }, (_, index) => String.fromCharCode(65 + index))
    .every((id) => choiceIds.has(id))

  const reportedPresentIds = parsed.chapterBoundaryIndexes.length
    ? []
    : parsed.gameData?.statePatch?.presentCharacterIds
  const presentIds = Array.isArray(reportedPresentIds)
    ? reportedPresentIds.filter((id): id is string => typeof id === 'string')
    : game.gameState.presentCharacterIds ?? []
  const presentNpcIds = new Set(game.characters
    .filter((character) => character.role === 'npc' && presentIds.includes(character.id))
    .map((character) => character.id))
  const updatedIds = new Set(parsed.characterStatusUpdates.map((update) => update.characterId))
  const statusRulesEnabled = Boolean(game.statusRulesPrompt?.trim())
  const missingStatusCharacterIds = statusRulesEnabled
    ? [...presentNpcIds].filter((id) => !updatedIds.has(id))
    : []
  const statusesComplete = missingStatusCharacterIds.length === 0
  const complete = choicesComplete && (!statusRulesEnabled || statusesComplete)

  return {
    canContinue,
    complete,
    hasChoices: parsed.choices.length > 0,
    choicesComplete,
    statusesComplete,
    expectedChoiceCount,
    missingStatusCharacterIds,
  }
}

export function mergeContinuationResponseResult(
  original: string,
  continuation: string,
  options: { final?: boolean; spliceOffset?: number } = {},
): ContinuationMergeResult {
  const base = original.replace(/\r\n?/g, '\n').trimEnd()
  const addition = continuation.replace(/\r\n?/g, '\n').trimStart()
  if (!base) return { text: addition, aligned: true, spliceOffset: 0 }
  if (!addition) return { text: base, aligned: false }

  if (options.spliceOffset !== undefined) {
    const spliceOffset = Math.min(Math.max(0, options.spliceOffset), base.length)
    return { text: `${base.slice(0, spliceOffset)}${addition}`, aligned: true, spliceOffset }
  }

  const firstLineBreak = addition.indexOf('\n')
  const firstLine = firstLineBreak >= 0
    ? addition.slice(0, firstLineBreak)
    : options.final
      ? addition
      : undefined
  if (firstLine !== undefined) {
    if (firstLine) {
      const lines = linesWithOffsets(base)
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const oldLine = lines[index]
        if (oldLine.text && firstLine.startsWith(oldLine.text)) {
          return {
            text: `${base.slice(0, oldLine.offset)}${addition}`,
            aligned: true,
            spliceOffset: oldLine.offset,
          }
        }
      }
    }
  } else {
    return { text: base, aligned: false }
  }

  return { text: mergeByCharacterOverlap(base, addition), aligned: false }
}

export function mergeContinuationResponse(original: string, continuation: string): string {
  return mergeContinuationResponseResult(original, continuation, { final: true }).text
}

function linesWithOffsets(text: string): Array<{ text: string; offset: number }> {
  const lines: Array<{ text: string; offset: number }> = []
  let offset = 0
  for (const line of text.split('\n')) {
    lines.push({ text: line, offset })
    offset += line.length + 1
  }
  return lines
}

function mergeByCharacterOverlap(base: string, addition: string): string {

  const maximum = Math.min(base.length, addition.length)
  let overlap = 0
  for (let length = maximum; length >= 2; length -= 1) {
    if (base.endsWith(addition.slice(0, length))) {
      overlap = length
      break
    }
  }

  const remainder = addition.slice(overlap)
  if (!remainder) return base
  const separator = overlap || base.endsWith('\n') || remainder.startsWith('\n') || shouldJoinTruncatedLine(base, remainder) ? '' : '\n'
  return `${base}${separator}${remainder}`
}

function shouldJoinTruncatedLine(base: string, continuation: string): boolean {
  const lastLine = base.split('\n').at(-1)?.trim() ?? ''
  const startsNewProtocolLine = /^(?:\[|[^（()：:\n]{1,30}[（(][^）)\n]{1,30}[）)]\s*[：:]|(?:你|我|主角)\s*[：:]|[A-Z][.、:：])/u.test(continuation)
  const isProtocolLine = /^(?:\[状态\]|\[旁白\]|\[选项\s*[A-Z]\]|\[[^\]\n]{1,30}\]\s*状态\s*[：:]|[^（()：:\n]{1,30}[（(][^）)\n]{1,30}[）)]\s*[：:]|(?:你|我|主角)\s*[：:])/u.test(lastLine)
  return isProtocolLine && !/[。！？!?；;]$/u.test(lastLine) && !startsNewProtocolLine
}
