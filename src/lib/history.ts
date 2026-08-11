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
        text: expandSelectedChoices(message.content.trim(), previousChoices),
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

function expandSelectedChoices(content: string, choices: Choice[]): string {
  const match = content.match(/^([A-Z]+)(，但是[\s\S]*)?$/)
  if (!match) return content

  const choiceMap = new Map(choices.map((choice) => [choice.id.toUpperCase(), choice.text]))
  const selectedTexts = [...match[1]].map((id) => choiceMap.get(id))
  if (selectedTexts.some((text) => !text)) return content

  return `${selectedTexts.join('；')}${match[2] ?? ''}`
}
