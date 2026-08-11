import type { GameSession } from '../types'

export function migrateLegacyNpcIds(game: GameSession, createId: () => string = createNpcId): GameSession {
  const legacyCharacters = game.characters.filter((character) => character.role === 'npc' && character.id === 'lia')
  if (!legacyCharacters.length) return game

  const usedIds = new Set(game.characters.map((character) => character.id))
  const replacements = new Map<string, string>()
  for (const character of legacyCharacters) {
    let nextId = createId()
    while (usedIds.has(nextId)) nextId = createId()
    replacements.set(character.id, nextId)
    usedIds.add(nextId)
  }

  return {
    ...game,
    characters: game.characters.map((character) => ({ ...character, id: replacements.get(character.id) ?? character.id })),
    messages: game.messages.map((message) => ({
      ...message,
      content: replaceStructuredCharacterIds(message.content, replacements),
    })),
    updatedAt: Date.now(),
  }
}

export function createNpcId(): string {
  return `npc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function replaceStructuredCharacterIds(content: string, replacements: Map<string, string>): string {
  let next = content
  for (const [legacyId, newId] of replacements) {
    const escaped = legacyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp(`("characterId"\\s*:\\s*")${escaped}(")`, 'g'), `$1${newId}$2`)
  }
  return next
}
