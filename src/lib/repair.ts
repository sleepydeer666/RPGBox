import { extractTextChoices } from './parser'

export function mergeStructureRepair(original: string, repairResponse: string): string | null {
  const choices = extractTextChoices(repairResponse)
  if (choices.length < 4) return null

  const optionLines = choices.slice(0, 4).map((choice, index) =>
    `[选项${String.fromCharCode(65 + index)}] ${choice.text}`,
  )
  return `${original.trim()}\n${optionLines.join('\n')}`
}
