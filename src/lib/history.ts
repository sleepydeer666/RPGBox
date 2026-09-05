import { parseAssistantResponse } from './parser'
import type { CharacterProfile, ChatMessage, Choice } from '../types'

export interface HistoryLine {
  id: string
  type: 'narration' | 'dialogue' | 'player'
  speaker?: string
  characterId?: string
  text: string
}

export function buildHistoryLines(messages: ChatMessage[], excludedMessageId?: string, characters: (Pick<CharacterProfile, 'id' | 'name'> & Partial<Pick<CharacterProfile, 'role'>>)[] = []): HistoryLine[] {
  const lines: HistoryLine[] = []
  let previousChoices: Choice[] = []

  for (const message of messages) {
    if (message.id === excludedMessageId || !message.content.trim()) continue
    if (message.role === 'user') {
      lines.push({
        id: message.id,
        type: 'player',
        speaker: '用户指令',
        characterId: undefined,
        text: formatUserInput(message, previousChoices),
      })
      continue
    }
    if (message.role !== 'assistant') continue

    const parsed = parseAssistantResponse(message.content, { characters })
    previousChoices = parsed.choices
    parsed.segments.forEach((segment, index) => {
      const character = segment.type === 'dialogue'
        ? characters.find((item) => item.id === segment.characterId || item.name === segment.characterName)
        : undefined
      lines.push({
        id: `${message.id}-${index}`,
        type: segment.type,
        speaker: segment.type === 'dialogue'
          ? character?.role === 'player' ? `${character.name}（你）` : (segment.characterName || segment.characterId || '未知角色')
          : undefined,
        characterId: segment.type === 'dialogue' ? segment.characterId : undefined,
        text: segment.text,
      })
    })
  }

  return lines
}

function formatUserInput(message: ChatMessage, choices: Choice[]): string {
  const selectedIds = message.selectedChoiceIds ?? []
  const supplement = message.customInput?.trim() ?? ''
  if (message.selectedChoiceIds !== undefined || message.customInput !== undefined) {
    const selectedText = resolveSelectedChoices(selectedIds, choices, message.selectedChoiceTexts)
    if (selectedText || !selectedIds.length) {
      if (!selectedIds.length) return supplement || message.content.trim()
      return [selectedText, supplement ? `补充指令：${supplement}` : ''].filter(Boolean).join('；') || message.content.trim()
    }
  }

  return expandLegacySelectedChoices(message.content.trim(), choices)
}

function expandLegacySelectedChoices(content: string, choices: Choice[]): string {
  const match = content.match(/^([A-Z]+)(，但是[\s\S]*)?$/)
  if (!match) return content

  const selectedText = resolveSelectedChoices([...match[1]], choices)
  if (!selectedText) return content

  const supplement = match[2]?.replace(/^，但是/, '').trim()
  return [selectedText, supplement ? `补充指令：${supplement}` : ''].filter(Boolean).join('；')
}

function resolveSelectedChoices(selectedIds: string[], choices: Choice[], storedTexts: Record<string, string> = {}): string {
  const choiceMap = new Map(choices.map((choice) => [choice.id.toUpperCase(), choice.text]))
  const selectedTexts = selectedIds.map((id) => {
    const normalizedId = id.toUpperCase()
    const text = storedTexts[normalizedId] || choiceMap.get(normalizedId)
    return text ? `${normalizedId}：${text}` : ''
  })
  return selectedTexts.every(Boolean) ? selectedTexts.join('；') : ''
}
