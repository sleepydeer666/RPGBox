import type { GameSession } from '../types'
import { parseAssistantResponse } from './parser'

export interface ResponseCompletionState {
  canContinue: boolean
  complete: boolean
  hasChoices: boolean
  choiceSectionStarted: boolean
  choicesComplete: boolean
  missingChoiceIds: string[]
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
  if (completion.choicesComplete) return '继续输出完整'
  const missingChoices = completion.missingChoiceIds.join('、')
  if (completion.choiceSectionStarted) {
    return `上一条回复因输出长度限制在选项部分被截断。不要重复已完整输出的剧情或选项。若最后一行是不完整选项，先从该行开头完整重写该选项；然后按顺序仅补齐缺失的选项（${missingChoices}）。每个新增选项仍须遵守本轮输出契约。只输出续写部分。`
  }
  return '上一条回复因输出长度限制在剧情部分被截断。请从最后一个未完成的剧情行开始续写：若最后一行不完整，先从该行开头完整重写；不要重复此前已完整输出的内容。补完剧情后，严格按本轮输出契约输出完整的A-D选项。只输出续写部分。'
}

export function inspectLatestResponseCompletion(game: GameSession): ResponseCompletionState {
  const assistantIndex = game.messages.map((message) => message.role).lastIndexOf('assistant')
  const assistant = game.messages[assistantIndex]
  const canContinue = assistantIndex > 0 && game.messages[assistantIndex - 1]?.role === 'user'
  const parsed = parseAssistantResponse(assistant?.rawContent ?? assistant?.content ?? '', {
    characters: game.characters,
    contentMode: assistant?.rpgStateId ?? game.gameState.contentMode,
    initialContentMode: assistant?.initialRpgStateId ?? assistant?.rpgStateId ?? game.gameState.contentMode,
    narrativeModes: game.narrativeModes,
  })
  const expectedChoiceCount = 4
  const choiceIds = new Set(parsed.choices.map((choice) => choice.id.toUpperCase()))
  const expectedChoiceIds = Array.from({ length: expectedChoiceCount }, (_, index) => String.fromCharCode(65 + index))
  const missingChoiceIds = expectedChoiceIds.filter((id) => !choiceIds.has(id))
  const choicesComplete = missingChoiceIds.length === 0
  const raw = assistant?.rawContent ?? assistant?.content ?? ''
  const choiceSectionStarted = parsed.choices.length > 0 || raw.split(/\r?\n/u).some((line) =>
    /^\s*(?:\[选项\s*[A-D]?|\[[A-D](?:\]|\s)|[A-D]\s*[.、:：])/iu.test(line))

  const missingStatusCharacterIds: string[] = []
  const statusesComplete = true
  const complete = choicesComplete

  return {
    canContinue,
    complete,
    hasChoices: parsed.choices.length > 0,
    choiceSectionStarted,
    choicesComplete,
    missingChoiceIds,
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
