import type { CharacterProfile, CharacterStatusUpdate, Choice, GameData, ParsedResponse, ProgressEvent, StorySegment } from '../types'
import { resolveCharacterExpression } from './expressions'

const GAME_DATA_PATTERN = /<game-data>\s*([\s\S]*?)\s*<\/game-data>/i
const CHOICE_LINE_PATTERN = /^\s*(?:\[选项\s*([A-Z])\]|\[([A-Z])\]|([A-Z])[.、:：])\s*(.+?)\s*$/gmi
const CHOICE_LINE_SINGLE_PATTERN = /^\s*(?:\[选项\s*([A-Z])\]|\[([A-Z])\]|([A-Z])[.、:：])\s*(.+?)\s*$/i
const DIALOGUE_LINE_PATTERN = /^\s*([^（()：:\n]{1,30})[（(]([^）)\n]{1,30})[）)]\s*[：:]\s*(.+?)\s*$/u
const PLAYER_DIALOGUE_LINE_PATTERN = /^\s*(你|我|主角)\s*[：:]\s*(.+?)\s*$/u
const NARRATION_LINE_PATTERN = /^\s*\[旁白\]\s*(.+?)\s*$/u
const SCENE_LINE_PATTERN = /^\s*\[场景\]\s*地点[：:]\s*(.+?)\s*[；;]\s*时间[：:]\s*(.+?)\s*$/u
const STATUS_LINE_PATTERN = /^\s*\[状态\]\s*(.*?)\s*$/iu
const STATUS_FIELD_PATTERN = /(?:^|[；;|｜])\s*(模式|地点|时间|章节|场景)\s*[：:]\s*([^；;|｜]*)/giu
const CHARACTER_STATUS_LINE_PATTERN = /^\s*\[([^\]\n]{1,30})\]\s*状态\s*[：:]\s*(.+?)\s*$/u
const CHAPTER_START_PATTERN = /^\s*\[篇章开始\]\s*(.+?)\s*$/u
const CHAPTER_END_PATTERN = /^\s*\[篇章结束\]\s*$/u
const UNIT_START_PATTERN = /^\s*\[单元开始\]\s*(.+?)\s*$/u

function normalizeChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return []
    return [{ id: candidate.id.toUpperCase(), text: candidate.text }]
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
  contentMode?: 'normal' | 'nsfw'
}

interface ParsedStatusLine {
  mode?: 'normal' | 'nsfw'
  location?: string
  time?: string
  chapter?: string
  scene?: '延续' | '切换'
}

function parseStatusLine(line: string): ParsedStatusLine | undefined {
  const status = line.match(STATUS_LINE_PATTERN)
  if (!status) return undefined
  const parsed: ParsedStatusLine = {}
  for (const field of status[1].matchAll(STATUS_FIELD_PATTERN)) {
    const key = field[1]
    const value = field[2].trim()
    if (key === '模式' && /^(常规|NSFW)$/iu.test(value)) parsed.mode = value.toLocaleUpperCase() === 'NSFW' ? 'nsfw' : 'normal'
    if (key === '地点' && value) parsed.location = value
    if (key === '时间' && value) parsed.time = value
    if (key === '章节') parsed.chapter = value
    if (key === '场景' && (value === '延续' || value === '切换')) parsed.scene = value
  }
  return parsed
}

function findCharacter(context: ResponseParseContext, suppliedName: string) {
  const direct = context.characters?.find((item) => item.name === suppliedName || item.id === suppliedName)
  if (direct) return direct
  return /^(你|我|主角)$/u.test(suppliedName)
    ? context.characters?.find((item) => item.role === 'player')
    : undefined
}

function isProgressLine(line: string): boolean {
  return CHAPTER_START_PATTERN.test(line) || CHAPTER_END_PATTERN.test(line) || UNIT_START_PATTERN.test(line)
}

function isStateLine(line: string): boolean {
  return Boolean(parseStatusLine(line)) || SCENE_LINE_PATTERN.test(line) || CHARACTER_STATUS_LINE_PATTERN.test(line)
}

function extractCharacterStatusUpdates(story: string, context: ResponseParseContext): CharacterStatusUpdate[] {
  const updates = new Map<string, CharacterStatusUpdate>()
  for (const line of story.split(/\n+/)) {
    const match = line.match(CHARACTER_STATUS_LINE_PATTERN)
    if (!match) continue
    const character = findCharacter(context, match[1].trim())
    const status = match[2].trim()
    if (!character || !status) continue
    updates.set(character.id, { characterId: character.id, characterName: character.name, status })
  }
  return Array.from(updates.values())
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
  for (const line of story.split(/\n+/).map((text) => text.trim()).filter(Boolean)) {
    if (CHOICE_LINE_SINGLE_PATTERN.test(line) || isStateLine(line) || isProgressLine(line)) continue
    const narration = line.match(NARRATION_LINE_PATTERN)
    if (narration) {
      segments.push({ type: 'narration', text: narration[1].trim() })
      continue
    }
    const playerDialogue = line.match(PLAYER_DIALOGUE_LINE_PATTERN)
    const player = playerDialogue ? context.characters?.find((item) => item.role === 'player') : undefined
    if (playerDialogue && player) {
      segments.push({
        type: 'dialogue',
        characterId: player.id,
        characterName: player.name,
        expression: '',
        text: playerDialogue[2].trim(),
      })
      continue
    }
    const dialogue = line.match(DIALOGUE_LINE_PATTERN)
    if (!dialogue) {
      segments.push({ type: 'narration', text: line })
      continue
    }
    const suppliedName = dialogue[1].trim()
    const character = findCharacter(context, suppliedName)
    segments.push({
      type: 'dialogue',
      characterId: character?.id ?? suppliedName.toLocaleLowerCase().replace(/\s+/g, '-'),
      characterName: character?.name ?? suppliedName,
      expression: dialogue[2].trim(),
      text: dialogue[3].trim(),
    })
  }
  return segments
}

function normalizeDialogueExpressions(segments: StorySegment[], context: ResponseParseContext, mode: 'normal' | 'nsfw'): StorySegment[] {
  return segments.map((segment) => {
    if (segment.type !== 'dialogue') return segment
    const character = context.characters?.find((item) => item.id === segment.characterId || item.name === segment.characterName)
    if (!character?.portraits?.length) return segment
    const hasActivePortraits = character.portraits.some((portrait) =>
      (portrait.groups?.length ? portrait.groups : ['normal']).includes(mode))
    if (!hasActivePortraits) return segment
    return {
      ...segment,
      expression: resolveCharacterExpression(character, segment.expression, mode).displayExpression,
    }
  })
}

function deriveStatePatch(story: string): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {}
  const status = story.split(/\n+/).map(parseStatusLine).find(Boolean)
  if (status) {
    if (status.mode) patch.contentMode = status.mode
    if (status.location) patch.location = status.location
    if (status.time) patch.time = status.time
  }
  const scene = story.split(/\n+/).map((line) => line.match(SCENE_LINE_PATTERN)).find(Boolean)
  if (scene && !status) {
    patch.location = scene[1].trim()
    patch.time = scene[2].trim()
  }
  return Object.keys(patch).length ? patch : undefined
}

export function visibleStory(raw: string): string {
  const marker = raw.search(/<game-data>/i)
  return (marker >= 0 ? raw.slice(0, marker) : raw).trim()
}

export function parseAssistantResponse(raw: string, context: ResponseParseContext = {}): ParsedResponse {
  const match = raw.match(GAME_DATA_PATTERN)
  let gameData: GameData | null = null

  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as GameData
      gameData = {
        ...parsed,
        choices: normalizeChoices(parsed.choices),
        segments: normalizeSegments(parsed.segments, context),
      }
    } catch {
      gameData = null
    }
  }

  const story = raw.replace(GAME_DATA_PATTERN, '').trim()
  const status = story.split(/\n+/).map(parseStatusLine).find(Boolean)
  const sceneChanged = status?.scene === '切换' || story.split(/\n+/).some((line) => SCENE_LINE_PATTERN.test(line))
  const progressEvents = extractProgressEvents(story)
  const characterStatusUpdates = extractCharacterStatusUpdates(story, context)
  const choices = gameData?.choices?.length ? gameData.choices : extractTextChoices(story)
  const storyWithoutFallbackChoices = story
    .split(/\n+/)
    .filter((line) => !CHOICE_LINE_SINGLE_PATTERN.test(line) && !isStateLine(line) && !isProgressLine(line))
    .map((line) => line.match(NARRATION_LINE_PATTERN)?.[1]?.trim() ?? line)
    .join('\n')
    .trim()

  const parsedSegments = gameData?.segments?.length
    ? gameData.segments
    : extractSimpleSegments(story, context)
  const segments = normalizeDialogueExpressions(parsedSegments, context, status?.mode ?? context.contentMode ?? 'normal')

  if (!gameData) {
    gameData = { segments, choices, statePatch: deriveStatePatch(story), chapterTitle: status?.chapter }
  } else {
    gameData.segments = segments
    if (status && Object.hasOwn(status, 'chapter')) gameData.chapterTitle = status.chapter
  }

  return { story: storyWithoutFallbackChoices, segments, choices, gameData, sceneChanged, progressEvents, chapterTitle: status?.chapter, characterStatusUpdates }
}

export function extractTextChoices(text: string): Choice[] {
  const choices: Choice[] = []
  for (const match of text.matchAll(CHOICE_LINE_PATTERN)) {
    choices.push({ id: (match[1] ?? match[2] ?? match[3]).toUpperCase(), text: match[4].trim() })
  }
  return choices
}
