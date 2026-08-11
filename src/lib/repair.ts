import { extractTextChoices } from './parser'

export function mergeStructureRepair(original: string, repairResponse: string, newStoryChoiceCount = 4): string | null {
  const choices = extractTextChoices(repairResponse)
  const normalizedCount = Number.isFinite(newStoryChoiceCount)
    ? Math.min(10, Math.max(4, Math.round(newStoryChoiceCount)))
    : 4
  if (choices.length !== 4 && choices.length !== normalizedCount) return null

  const optionLines = choices.map((choice, index) =>
    `[选项${String.fromCharCode(65 + index)}] ${choice.text}`,
  )
  return `${original.trim()}\n${optionLines.join('\n')}`
}
