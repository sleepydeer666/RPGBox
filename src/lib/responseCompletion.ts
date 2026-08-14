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

export function inspectLatestResponseCompletion(game: GameSession): ResponseCompletionState {
  const assistantIndex = game.messages.map((message) => message.role).lastIndexOf('assistant')
  const assistant = game.messages[assistantIndex]
  const canContinue = assistantIndex > 0 && game.messages[assistantIndex - 1]?.role === 'user'
  const parsed = parseAssistantResponse(assistant?.content ?? '', { characters: game.characters })
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
  const missingStatusCharacterIds = [...presentNpcIds].filter((id) => !updatedIds.has(id))
  const statusesComplete = missingStatusCharacterIds.length === 0
  const statusRulesEnabled = Boolean(game.statusRulesPrompt?.trim())
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

export function mergeContinuationResponse(original: string, continuation: string): string {
  const base = original.replace(/\r\n?/g, '\n').trimEnd()
  const addition = continuation.replace(/\r\n?/g, '\n').trimStart()
  if (!base) return addition
  if (!addition) return base

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
