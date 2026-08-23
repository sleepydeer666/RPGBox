import type { Choice, NarrativeMode, PortraitGroup } from '../types'
import { CHAPTER_END_MARKER } from './chapterTurns'
import { availableNarrativeModes, DEFAULT_NARRATIVE_MODES, normalizeNarrativeModes } from './narrativeModes'

export const CONTENT_MODE_LABELS: Record<string, string> = {
  normal: '正常',
  nsfw: 'NSFW',
}

const STATE_TRANSITION_PATTERN = /（后续叙事模式[：:]\s*([^（）\n]+?)\s*）(?=\s*(?:（结束章节）)?\s*$)/iu
export const NARRATIVE_MODE_SWITCH_PATTERN = /^\s*\[叙事模式切换\]\s*(.+?)\s*$/u

export function narrativeModeLabel(id: PortraitGroup, modes: NarrativeMode[] = DEFAULT_NARRATIVE_MODES): string {
  return normalizeNarrativeModes(modes).find((mode) => mode.id === id)?.name ?? CONTENT_MODE_LABELS[id] ?? id
}

export function parseChoiceStateTransition(text: string, modes: NarrativeMode[] = DEFAULT_NARRATIVE_MODES): PortraitGroup | undefined {
  const match = text.match(STATE_TRANSITION_PATTERN)
  if (!match) return undefined
  const label = match[1].trim()
  const normalized = normalizeNarrativeModes(modes)
  return normalized.find((mode) => mode.name.toLocaleLowerCase() === label.toLocaleLowerCase())?.id
}

export function choiceActionText(text: string): string {
  return text.replace(STATE_TRANSITION_PATTERN, '').replace(CHAPTER_END_MARKER, '').replace(/\s{2,}/gu, ' ').trim()
}

export function narrativeModeSwitchLine(mode: PortraitGroup, modes: NarrativeMode[] = DEFAULT_NARRATIVE_MODES): string {
  return `[叙事模式切换] ${narrativeModeLabel(mode, modes)}`
}

export function parseNarrativeModeSwitchLine(line: string, expectedMode: PortraitGroup, modes: NarrativeMode[] = DEFAULT_NARRATIVE_MODES): PortraitGroup | undefined {
  const label = line.match(NARRATIVE_MODE_SWITCH_PATTERN)?.[1]?.trim()
  if (!label) return undefined
  const expectedLabel = narrativeModeLabel(expectedMode, modes)
  return label.toLocaleLowerCase() === expectedLabel.toLocaleLowerCase() ? expectedMode : undefined
}

export function resolveTurnContentMode(
  currentMode: PortraitGroup,
  locked: boolean,
  choices: Choice[],
  selectedChoiceIds: string[],
  endsChapter = false,
  defaultMode: PortraitGroup = 'normal',
): PortraitGroup {
  if (endsChapter) return defaultMode
  if (locked) return currentMode
  const selectedIds = new Set(selectedChoiceIds.map((id) => id.toUpperCase()))
  return choices.find((choice) => selectedIds.has(choice.id.toUpperCase()) && choice.targetContentMode)?.targetContentMode
    ?? currentMode
}

export function buildTurnStateInstruction(currentMode: PortraitGroup, locked: boolean, narrativeModes: NarrativeMode[] = DEFAULT_NARRATIVE_MODES): string {
  const availableModes = availableNarrativeModes({ narrativeModes })
  const modes = availableModes.map((mode) => mode.name).join('、')
  const lockRule = locked ? '；本轮叙事模式锁定' : ''
  const formatRule = `每个选项末尾必须标记一个后续叙事模式，格式为“（后续叙事模式：模式名）”，模式名只能是：${modes}。`
  return `当前叙事模式：${narrativeModeLabel(currentMode, availableModes)}${lockRule}；后续叙事模式：${modes}；可选章节操作：结束章节。
${formatRule}结束当前章节的选项还要在后续叙事模式标签之后标记“（结束章节）”。`
}
