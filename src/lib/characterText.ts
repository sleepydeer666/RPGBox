import type { CharacterProfile } from '../types'

export interface CharacterTextToken {
  text: string
  character?: Pick<CharacterProfile, 'id' | 'name' | 'color'>
}

export function tokenizeCharacterNames(
  text: string,
  characters: Pick<CharacterProfile, 'id' | 'name' | 'color'>[],
): CharacterTextToken[] {
  const namedCharacters = characters
    .filter((character) => character.name.trim())
    .sort((left, right) => right.name.length - left.name.length)
  if (!namedCharacters.length) return [{ text }]

  const byName = new Map(namedCharacters.map((character) => [character.name, character]))
  const pattern = new RegExp(`(${namedCharacters.map((character) => escapeRegExp(character.name)).join('|')})`, 'g')
  return text.split(pattern).filter(Boolean).map((part) => ({ text: part, character: byName.get(part) }))
}

export function tokenizeNarrationText(
  text: string,
  characters: Pick<CharacterProfile, 'id' | 'name' | 'color' | 'role'>[],
): CharacterTextToken[] {
  const playerId = characters.find((character) => character.role === 'player')?.id
  return tokenizeCharacterNames(text, characters).map((token) =>
    token.character?.id === playerId ? { ...token, text: '你' } : token,
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
