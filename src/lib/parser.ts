import type { CharacterProfile, CharacterStatusUpdate, Choice, GameData, NarrativeMode, ParsedResponse, PortraitGroup, ProgressEvent, StorySegment } from '../types'
import { resolveCharacterExpression } from './expressions'
import { NARRATIVE_MODE_SWITCH_PATTERN, parseNarrativeModeSwitchLine } from './rpgState'
import { parseChoiceStateTransition } from './rpgState'

const GAME_DATA_PATTERN = /<game-data>\s*([\s\S]*?)\s*<\/game-data>/i
const CHOICE_LINE_PATTERN = /^\s*(?:\[选项\s*([A-Z])\]|\[([A-Z])\]|([A-Z])[.、:：])\s*(.+?)\s*$/gmi
const CHOICE_LINE_SINGLE_PATTERN = /^\s*(?:\[选项\s*([A-Z])\]|\[([A-Z])\]|([A-Z])[.、:：])\s*(.+?)\s*$/i
const DIALOGUE_LINE_PATTERN = /^\s*([^（()：:\n]{1,30})[（(]([^）)\n]{1,30})[）)]\s*[：:]\s*(.+?)\s*$/u
const PLAYER_DIALOGUE_LINE_PATTERN = /^\s*(你|我|主角)\s*[：:]\s*(.+?)\s*$/u
const BARE_CHARACTER_DIALOGUE_LINE_PATTERN = /^\s*([^（()：:\n]{1,30})\s*[：:]\s*(.+?)\s*$/u
const NARRATION_LINE_PATTERN = /^\s*\[旁白\]\s*(.+?)\s*$/u
const SCENE_LINE_PATTERN = /^\s*\[场景\]\s*地点[：:]\s*(.+?)\s*[；;]\s*时间[：:]\s*(.+?)\s*$/u
const STATUS_LINE_PATTERN = /^\s*\[状态\]\s*(.*?)\s*$/iu
const STATUS_FIELD_PATTERN = /(?:^|[；;|｜])\s*(模式|地点|时间|章节|场景|在场人物|在场角色)\s*[：:]\s*([^；;|｜]*)/giu
const CHARACTER_STATUS_LINE_PATTERN = /^\s*\[([^\]\n]{1,30})\]\s*状态\s*[：:]\s*(.+?)\s*$/u
const CHAPTER_START_PATTERN = /^\s*\[篇章开始\]\s*(.+?)\s*$/u
const CHAPTER_END_PATTERN = /^\s*\[(?:篇章|章节)结束\]\s*$/u
const UNIT_START_PATTERN = /^\s*\[单元开始\]\s*(.+?)\s*$/u
const NEW_CHAPTER_PATTERN = /^\s*\[新章节\]\s*(.+?)\s*$/u
const VISUAL_BLANK_LINE_PATTERN = /^[\s\u200B\u200C\u200D\u2060\uFEFF]*$/u

function normalizeChoices(value: unknown, context: ResponseParseContext): Choice[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return []
    return [{
      id: candidate.id.toUpperCase(),
      text: candidate.text,
      targetContentMode: parseChoiceStateTransition(candidate.text, context.narrativeModes),
    }]
  })
}

function normalizeSegments(value: unknown, context: ResponseParseContext): StorySegment[] {
  if (!Array.isArray(value)) return []
  const segments: StorySegment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if ((candidate.type !== 'narration' && candidate.type !== 'dialogue') || typeof candidate.text !== 'string') continue
    if (candidate.type === 'dialogue') {
      if (typeof candidate.characterId !== 'string' || typeof candidate.expression !== 'string') continue
      const suppliedName = typeof candidate.characterName === 'string' ? candidate.characterName : candidate.characterId
      const character = context.characters?.find((item) => item.id === candidate.characterId || item.name === suppliedName)
      segments.push({
        type: 'dialogue' as const,
        text: candidate.text,
        characterId: character?.id ?? candidate.characterId,
        characterName: character?.name ?? suppliedName,
        expression: candidate.expression,
      })
      continue
    }
    segments.push({ type: 'narration', text: candidate.text })
  }
  return segments
}

export interface ResponseParseContext {
  characters?: (Pick<CharacterProfile, 'id' | 'name'> & Partial<Pick<CharacterProfile, 'role' | 'portraits' | 'defaultPortraitId' | 'defaultPortraitIds'>>)[]
  contentMode?: PortraitGroup
  initialContentMode?: PortraitGroup
  narrativeModes?: NarrativeMode[]
  treatMalformedLinesAsNarration?: boolean
}

interface ParsedStatusLine {
  mode?: 'normal' | 'nsfw'
  location?: string
  time?: string
  chapter?: string
  presentCharacters?: string[]
}

function parseStatusLine(line: string): ParsedStatusLine | undefined {
  const status = line.match(STATUS_LINE_PATTERN)
  if (!status) return undefined
  const parsed: ParsedStatusLine = {}
  for (const field of status[1].matchAll(STATUS_FIELD_PATTERN)) {
    const key = field[1]
    const value = field[2].trim()
    if (key === '模式' && /^(正常|NSFW)$/iu.test(value)) parsed.mode = value.toLocaleUpperCase() === 'NSFW' ? 'nsfw' : 'normal'
    if (key === '地点' && value) parsed.location = value
    if (key === '时间' && value) parsed.time = value
    if (key === '章节') parsed.chapter = value
    if (key === '在场人物' || key === '在场角色') {
      parsed.presentCharacters = /^(无|没有|无人在场)$/u.test(value)
        ? []
        : value.split(/[、,，/／|｜]/u).map((item) => item.trim()).filter(Boolean)
    }
  }
  return parsed
}

function recoverStatusAfterUnformattedPrefix(story: string): string {
  const statusOffset = story.indexOf('[状态]')
  if (statusOffset <= 0) return story
  const lineStart = story.lastIndexOf('\n', statusOffset - 1) + 1
  if (!story.slice(lineStart, statusOffset).trim()) return story
  const lineEnd = story.indexOf('\n', statusOffset)
  const statusLine = story.slice(statusOffset, lineEnd < 0 ? story.length : lineEnd).trim()
  const status = parseStatusLine(statusLine)
  const completeStatus = status?.location
    && status.time
    && Object.hasOwn(status, 'presentCharacters')
  return completeStatus ? story.slice(statusOffset) : story
}

function findCharacter(context: ResponseParseContext, suppliedName: string) {
  const direct = context.characters?.find((item) => item.name === suppliedName || item.id === suppliedName)
  if (direct) return direct
  return /^(你|我|主角)$/u.test(suppliedName)
    ? context.characters?.find((item) => item.role === 'player')
    : undefined
}

function parseDialogueLine(line: string, context: ResponseParseContext): StorySegment | undefined {
  const playerDialogue = line.match(PLAYER_DIALOGUE_LINE_PATTERN)
  const player = playerDialogue ? context.characters?.find((item) => item.role === 'player') : undefined
  if (playerDialogue && player) {
    return {
      type: 'dialogue',
      characterId: player.id,
      characterName: player.name,
      expression: '',
      text: playerDialogue[2].trim(),
    }
  }

  const bareDialogue = line.match(BARE_CHARACTER_DIALOGUE_LINE_PATTERN)
  const bareCharacter = bareDialogue ? findCharacter(context, bareDialogue[1].trim()) : undefined
  if (bareDialogue && bareCharacter) {
    return {
      type: 'dialogue',
      characterId: bareCharacter.id,
      characterName: bareCharacter.name,
      expression: '',
      text: bareDialogue[2].trim(),
    }
  }

  const dialogue = line.match(DIALOGUE_LINE_PATTERN)
  if (!dialogue) return undefined
  const suppliedName = dialogue[1].trim()
  const character = findCharacter(context, suppliedName)
  return {
    type: 'dialogue',
    characterId: character?.id ?? suppliedName.toLocaleLowerCase().replace(/\s+/g, '-'),
    characterName: character?.name ?? suppliedName,
    expression: dialogue[2].trim(),
    text: dialogue[3].trim(),
  }
}

function invalidExpressionRange(line: string, context: ResponseParseContext): { start: number; end: number } | undefined {
  const match = line.match(DIALOGUE_LINE_PATTERN)
  if (!match) return undefined
  const character = findCharacter(context, match[1].trim())
  if (!character?.portraits?.length) return undefined
  if (!context.contentMode) return undefined
  const allowed = new Set(character.portraits.filter((portrait) => (portrait.groups ?? ['normal']).includes(context.contentMode!)).flatMap((portrait) => portrait.tags?.length ? portrait.tags : [portrait.expression]).filter(Boolean).map((tag) => tag.trim().toLocaleLowerCase()))
  const requested = match[2].trim().split(/[、,，/\s]+/u).filter(Boolean)
  if (!requested.length || requested.every((tag) => allowed.has(tag.toLocaleLowerCase()))) return undefined
  const contentStart = match.index! + match[0].indexOf(match[2])
  return { start: contentStart, end: contentStart + match[2].length }
}

export function protocolAnomalyExpressionRanges(raw: string, context: ResponseParseContext = {}): Array<{ line: number; start: number; end: number }> {
  const story = visibleStory(raw)
  return story.split(/\n/).flatMap((line, lineIndex) => {
    const range = invalidExpressionRange(line, context)
    return range ? [{ line: lineIndex, ...range }] : []
  })
}

function isSegmentLine(line: string, context: ResponseParseContext): boolean {
  return NARRATION_LINE_PATTERN.test(line) || Boolean(parseDialogueLine(line, context))
}

function normalizeMalformedDialogueLine(line: string, context: ResponseParseContext): string {
  const candidate = line.trim()
  const wrappedName = candidate.match(/^\[([^\]\n]+)\]([（(][^）)\n]{1,30}[）)]\s*[：:]\s*.+?)$/u)
  if (wrappedName && findCharacter(context, wrappedName[1].trim())) {
    return `${wrappedName[1].trim()}${wrappedName[2]}`
  }
  const wrappedLine = candidate.match(/^\[([^\n]+)\]$/u)
  if (wrappedLine) {
    const dialogue = wrappedLine[1].match(DIALOGUE_LINE_PATTERN)
    if (dialogue && findCharacter(context, dialogue[1].trim())) return wrappedLine[1].trim()
  }
  return line
}

export function normalizeProtocolResponse(raw: string, context: ResponseParseContext = {}): string {
  const gameData = raw.match(GAME_DATA_PATTERN)?.[0]
  const originalStory = raw.replace(GAME_DATA_PATTERN, '')
  const story = recoverStatusAfterUnformattedPrefix(originalStory)
  if (!context.characters?.length && story === originalStory && !context.treatMalformedLinesAsNarration) return raw
  let normalized = context.characters?.length
    ? story.split(/\n/).map((line) => normalizeMalformedDialogueLine(line, context)).join('\n')
    : story
  if (context.treatMalformedLinesAsNarration) {
    let choicesStarted = false
    normalized = normalized.split(/\n/).map((line) => {
      const trimmed = line.trim()
      if (CHOICE_LINE_SINGLE_PATTERN.test(trimmed)) { choicesStarted = true; return line }
      if (choicesStarted) return line
      if (!trimmed || isProtocolLine(trimmed, context)) return line
      return `[旁白] ${trimmed}`
    }).join('\n')
  }
  return `${normalized}${gameData ? `\n${gameData}` : ''}`.trim()
}

function isProtocolLine(line: string, context: ResponseParseContext): boolean {
  return CHOICE_LINE_SINGLE_PATTERN.test(line) || isStateLine(line) || isProgressLine(line)
    || NARRATION_LINE_PATTERN.test(line) || Boolean(parseDialogueLine(line, context))
}

export function protocolAnomalyLineIndexes(raw: string, context: ResponseParseContext = {}): number[] {
  const story = visibleStory(normalizeProtocolResponse(raw, { ...context, treatMalformedLinesAsNarration: false }))
  let choicesStarted = false
  return story.split(/\n/).map((line, index) => {
    const trimmed = line.trim()
    if (CHOICE_LINE_SINGLE_PATTERN.test(trimmed)) { choicesStarted = true; return -1 }
    const invalid = choicesStarted
      ? !isLooseStatusLine(trimmed, context) && !isStateLine(trimmed) && !isProgressLine(trimmed)
      : !isProtocolLine(trimmed, context)
    return trimmed && invalid ? index : -1
  }).filter((index) => index >= 0)
}

function isProgressLine(line: string): boolean {
  return CHAPTER_START_PATTERN.test(line) || CHAPTER_END_PATTERN.test(line) || UNIT_START_PATTERN.test(line) || NEW_CHAPTER_PATTERN.test(line)
}

function isStateLine(line: string): boolean {
  return Boolean(parseStatusLine(line)) || SCENE_LINE_PATTERN.test(line) || CHARACTER_STATUS_LINE_PATTERN.test(line) || NARRATIVE_MODE_SWITCH_PATTERN.test(line)
}

function extractNarrativeModeSwitchIndexes(story: string, context: ResponseParseContext): number[] {
  const targetMode = context.contentMode
  const initialMode = context.initialContentMode ?? targetMode
  if (!targetMode || initialMode === targetMode) return []

  let segmentIndex = 0
  let accepted = false
  const indexes: number[] = []
  for (const line of story.split(/\n+/).map((text) => text.trim()).filter(Boolean)) {
    if (!accepted && parseNarrativeModeSwitchLine(line, targetMode, context.narrativeModes)) {
      accepted = true
      indexes.push(segmentIndex)
      continue
    }
    if (NARRATION_LINE_PATTERN.test(line)) {
      segmentIndex += 1
      continue
    }
    if (parseDialogueLine(line, context)) segmentIndex += 1
  }
  return indexes
}

function extractCharacterStatusUpdates(story: string, context: ResponseParseContext): CharacterStatusUpdate[] {
  const updates = new Map<string, CharacterStatusUpdate>()
  let choicesStarted = false
  for (const line of story.split(/\n+/)) {
    if (CHOICE_LINE_SINGLE_PATTERN.test(line)) {
      choicesStarted = true
      continue
    }
    if (choicesStarted) {
      const loose = parseLooseCharacterStatusLine(line, context)
      if (loose) updates.set(loose.characterId, loose)
      continue
    }
    const match = line.match(CHARACTER_STATUS_LINE_PATTERN)
    if (!match) continue
    const character = findCharacter(context, match[1].trim())
    const status = match[2].trim()
    if (!character || !status) continue
    updates.set(character.id, { characterId: character.id, characterName: character.name, status })
  }
  return Array.from(updates.values())
}

function parseLooseCharacterStatusLine(line: string, context: ResponseParseContext): CharacterStatusUpdate | undefined {
  const match = line.trim().match(/^(.+?)[：:]\s*(.+)$/u)
  if (!match) return undefined
  const label = match[1].trim()
  const status = match[2].trim()
  if (!label || !status) return undefined
  const character = context.characters?.filter((item) => label.includes(item.name) || label.includes(item.id)).sort((a, b) => b.name.length - a.name.length)[0]
  return character ? { characterId: character.id, characterName: character.name, status } : undefined
}

function isLooseStatusLine(line: string, context: ResponseParseContext): boolean {
  return Boolean(parseLooseCharacterStatusLine(line, context))
}

function extractProgressEvents(story: string): ProgressEvent[] {
  return story.split(/\n+/).flatMap((line): ProgressEvent[] => {
    const chapterStart = line.match(CHAPTER_START_PATTERN)
    if (chapterStart) return [{ type: 'chapter_start', title: chapterStart[1].trim() }]
    if (CHAPTER_END_PATTERN.test(line)) return [{ type: 'chapter_end' }]
    const unitStart = line.match(UNIT_START_PATTERN)
    if (unitStart) return [{ type: 'unit_start', title: unitStart[1].trim() }]
    return []
  })
}

function extractSimpleSegments(story: string, context: ResponseParseContext): StorySegment[] {
  const segments: StorySegment[] = []
  let choicesStarted = false
  for (const line of story.split(/\n+/).map((text) => text.trim()).filter(Boolean)) {
    if (CHOICE_LINE_SINGLE_PATTERN.test(line)) { choicesStarted = true; continue }
    if (choicesStarted || isStateLine(line) || isProgressLine(line)) continue
    const narration = line.match(NARRATION_LINE_PATTERN)
    if (narration) {
      segments.push({ type: 'narration', text: narration[1].trim() })
      continue
    }
    const dialogue = parseDialogueLine(line, context)
    if (dialogue) segments.push(dialogue)
  }
  return segments
}

function extractChapterBoundaryIndexes(story: string, context: ResponseParseContext): number[] {
  const indexes: number[] = []
  let segmentCount = 0
  for (const line of story.split(/\n+/).map((text) => text.trim()).filter(Boolean)) {
    if (CHAPTER_END_PATTERN.test(line)) {
      if (indexes.at(-1) !== segmentCount) indexes.push(segmentCount)
      continue
    }
    if (NARRATION_LINE_PATTERN.test(line)) {
      segmentCount += 1
      continue
    }
    if (parseDialogueLine(line, context)) segmentCount += 1
  }
  return indexes
}

function applyNarrativeModes(segments: StorySegment[], context: ResponseParseContext, switchIndexes: number[]): StorySegment[] {
  const targetMode = context.contentMode ?? 'normal'
  const initialMode = context.initialContentMode ?? targetMode
  const switchIndex = switchIndexes[0]
  return segments.map((segment, index) => {
    const mode = switchIndex !== undefined && index >= switchIndex ? targetMode : initialMode
    const modeMetadata = initialMode === targetMode ? {} : { rpgStateId: mode }
    if (segment.type !== 'dialogue') return { ...segment, ...modeMetadata }
    const character = context.characters?.find((item) => item.id === segment.characterId || item.name === segment.characterName)
    if (!character?.portraits?.length) return { ...segment, ...modeMetadata }
    const hasActivePortraits = character.portraits.some((portrait) =>
      (portrait.groups ?? ['normal']).includes(mode))
    if (!hasActivePortraits) return segment
    return {
      ...segment,
      ...modeMetadata,
      expression: resolveCharacterExpression(character, segment.expression, mode).displayExpression,
    }
  })
}

function deriveStatePatch(story: string, context: ResponseParseContext): Record<string, unknown> | undefined {
  return extractStatePatches(story, context).at(-1)
}

function statusPatch(status: ParsedStatusLine, context: ResponseParseContext): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (status.location) patch.location = status.location
  if (status.time) patch.time = status.time
  if (status.presentCharacters) {
    patch.presentCharacterIds = status.presentCharacters.flatMap((name) => {
      const character = findCharacter(context, name)
      return character ? [character.id] : []
    })
  }
  return patch
}

function extractStatePatches(story: string, context: ResponseParseContext): Array<Record<string, unknown>> {
  const patches: Array<Record<string, unknown>> = []
  for (const line of story.split(/\n+/)) {
    const status = parseStatusLine(line)
    if (status) {
      const patch = statusPatch(status, context)
      if (Object.keys(patch).length) patches.push(patch)
      continue
    }
    const scene = line.match(SCENE_LINE_PATTERN)
    if (scene) patches.push({ location: scene[1].trim(), time: scene[2].trim() })
  }
  return patches
}

function annotateSegmentState(segments: StorySegment[], story: string, context: ResponseParseContext): StorySegment[] {
  const stateLines = story.split(/\n+/).map((line) => ({ line: line.trim(), patch: parseStatusLine(line) ? statusPatch(parseStatusLine(line)!, context) : undefined }))
  let segmentIndex = 0
  let current: Record<string, unknown> | undefined
  const bySegment: Array<Record<string, unknown> | undefined> = []
  for (const item of stateLines) {
    if (item.patch && Object.keys(item.patch).length) current = item.patch
    if (isSegmentLine(item.line, context)) {
      bySegment[segmentIndex++] = current
    }
  }
  return segments.map((segment, index) => {
    const patch = bySegment[index]
    if (!patch) return segment
    const next = { ...segment }
    Object.defineProperty(next, 'statePatch', { value: patch, enumerable: false, configurable: true })
    if (Array.isArray(patch.presentCharacterIds)) Object.defineProperty(next, 'presentCharacterIds', { value: patch.presentCharacterIds as string[], enumerable: false, configurable: true })
    return next
  })
}

export function visibleStory(raw: string): string {
  const marker = raw.search(/<game-data>/i)
  return (marker >= 0 ? raw.slice(0, marker) : raw).trim()
}

export function hasProtocolAnomaly(raw: string, context: ResponseParseContext = {}): boolean {
  if (VISUAL_BLANK_LINE_PATTERN.test(raw)) return false
  if (GAME_DATA_PATTERN.test(raw)) return true
  const normalized = normalizeProtocolResponse(raw, context)
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter((line) => !VISUAL_BLANK_LINE_PATTERN.test(line))

  let narrativeModeSwitched = false
  let choicesStarted = false
  return lines.some((line, index) => {
    if (CHOICE_LINE_SINGLE_PATTERN.test(line)) { choicesStarted = true; return false }
    if (choicesStarted) return !isStateLine(line) && !isProgressLine(line) && !isLooseStatusLine(line, context)
    if (parseStatusLine(line)) return false
    if (NARRATIVE_MODE_SWITCH_PATTERN.test(line)) {
      const expected = context.contentMode
        && context.initialContentMode !== context.contentMode
        && parseNarrativeModeSwitchLine(line, context.contentMode, context.narrativeModes)
      if (!expected || narrativeModeSwitched) return true
      narrativeModeSwitched = true
      return false
    }
    if (CHAPTER_END_PATTERN.test(line) || NARRATION_LINE_PATTERN.test(line) || CHOICE_LINE_SINGLE_PATTERN.test(line)) return false
    const characterStatus = line.match(CHARACTER_STATUS_LINE_PATTERN)
    if (characterStatus) return Boolean(context.characters?.length) && !findCharacter(context, characterStatus[1].trim())
    if (PLAYER_DIALOGUE_LINE_PATTERN.test(line)) return true
    const bareDialogue = line.match(BARE_CHARACTER_DIALOGUE_LINE_PATTERN)
    if (bareDialogue && findCharacter(context, bareDialogue[1].trim())) return false
    const dialogue = line.match(DIALOGUE_LINE_PATTERN)
    if (!dialogue) return index !== lines.length - 1 || !isPlausiblyTruncatedProtocolLine(line, context)
    if (!context.characters?.length) return false
    if (!context.characters.some((item) => item.name === dialogue[1].trim())) return true
    return false
  })
}

function isPlausiblyTruncatedProtocolLine(line: string, context: ResponseParseContext): boolean {
  if (!line) return false
  const bracketed = line.match(/^\[([^\]\n]*)/u)
  if (bracketed) {
    const suppliedTag = bracketed[1]
    const protocolTags = ['状态', '旁白', '选项', '叙事模式切换', '新章节', '篇章开始', '篇章结束', '章节结束', '单元开始']
    const bracketClosed = line.includes(']')
    if (!bracketClosed && protocolTags.some((tag) => tag.startsWith(suppliedTag))) return true
    if (bracketClosed && (protocolTags.includes(suppliedTag) || /^选项\s*[A-Z]$/u.test(suppliedTag))) return true
    if (context.characters?.some((character) => {
      const prefix = `[${character.name.trim()}]状态`
      return prefix.startsWith(line) || line.startsWith(prefix)
    })) return true
  }
  return Boolean(context.characters?.some((character) => {
    const name = character.name.trim()
    return name && (line === name || line.startsWith(`${name}（`) || line.startsWith(`${name}(`))
  }))
}

export function standardResponse(raw: string, context: ResponseParseContext = {}): string {
  raw = normalizeProtocolResponse(raw, context)
  const gameData = raw.match(GAME_DATA_PATTERN)?.[0]
  const story = raw.replace(GAME_DATA_PATTERN, '')
  let choicesStarted = false
  const lines = story.split(/\n+/).map((line) => line.trim()).filter((line) => {
    if (!line) return false
    if (CHOICE_LINE_SINGLE_PATTERN.test(line)) { choicesStarted = true; return true }
    if (choicesStarted) return isLooseStatusLine(line, context) || isStateLine(line) || isProgressLine(line)
    return isStateLine(line) || isProgressLine(line) || NARRATION_LINE_PATTERN.test(line) || Boolean(parseDialogueLine(line, context))
  })
  return [...lines, ...(gameData ? [gameData] : [])].join('\n').trim()
}

export function parseAssistantResponse(raw: string, context: ResponseParseContext = {}): ParsedResponse {
  raw = normalizeProtocolResponse(raw, context)
  const match = raw.match(GAME_DATA_PATTERN)
  let gameData: GameData | null = null

  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as GameData
      gameData = {
        ...parsed,
        choices: normalizeChoices(parsed.choices, context),
        segments: normalizeSegments(parsed.segments, context),
      }
    } catch {
      gameData = null
    }
  }

  const story = raw.replace(GAME_DATA_PATTERN, '').trim()
  const status = story.split(/\n+/).map(parseStatusLine).find(Boolean)
  const progressEvents = extractProgressEvents(story)
  const characterStatusUpdates = extractCharacterStatusUpdates(story, context)
  const choices = gameData?.choices?.length ? gameData.choices : extractTextChoices(story, context.narrativeModes)
  const storyWithoutFallbackChoices = story
    .split(/\n+/)
    .filter((line) => !CHOICE_LINE_SINGLE_PATTERN.test(line) && !isStateLine(line) && !isProgressLine(line))
    .map((line) => line.match(NARRATION_LINE_PATTERN)?.[1]?.trim() ?? line)
    .join('\n')
    .trim()

  const textSegments = extractSimpleSegments(story, context)
  const parsedSegments = textSegments.length ? textSegments : gameData?.segments ?? []
  const narrativeModeSwitchIndexes = extractNarrativeModeSwitchIndexes(story, context)
  const segments = annotateSegmentState(applyNarrativeModes(parsedSegments, context, narrativeModeSwitchIndexes), story, context)
  const chapterBoundaryIndexes = extractChapterBoundaryIndexes(story, context)

  if (!gameData) {
    gameData = { segments, choices, statePatch: deriveStatePatch(story, context), chapterTitle: status?.chapter }
  } else {
    gameData.segments = segments
    if (status && Object.hasOwn(status, 'chapter')) gameData.chapterTitle = status.chapter
  }

  const newChapterTitle = story.split(/\n+/).map((line) => line.match(NEW_CHAPTER_PATTERN)?.[1]?.trim()).find(Boolean)
  return { story: storyWithoutFallbackChoices, segments, chapterBoundaryIndexes, choices, gameData, progressEvents, chapterTitle: status?.chapter, newChapterTitle, narrativeModeSwitchIndexes, characterStatusUpdates }
}

export function extractTextChoices(text: string, narrativeModes?: NarrativeMode[]): Choice[] {
  const choices: Choice[] = []
  for (const match of text.matchAll(CHOICE_LINE_PATTERN)) {
    const text = match[4].trim()
    choices.push({
      id: (match[1] ?? match[2] ?? match[3]).toUpperCase(),
      text,
      targetContentMode: parseChoiceStateTransition(text, narrativeModes),
    })
  }
  return choices
}
