import type { CharacterProfile, Choice, GameSession } from '../types'

export function selectTurnPortraitCharacters(
  game: Pick<GameSession, 'characters' | 'gameState' | 'narrative'>,
  choices: Choice[],
  selectedChoiceIds: string[],
  customInput: string,
  startsNewTransition: boolean,
): CharacterProfile[] {
  if (startsNewTransition || game.narrative.chapterPhase !== 'active') return game.characters

  const includedIds = new Set([
    ...(game.gameState.presentCharacterIds ?? []),
    ...game.characters.filter((character) => character.role === 'player').map((character) => character.id),
  ])
  const selectedIds = new Set(selectedChoiceIds.map((id) => id.toUpperCase()))
  const selectedChoiceText = choices
    .filter((choice) => selectedIds.has(choice.id.toUpperCase()))
    .map((choice) => choice.text)
    .join('\n')
  const userText = `${selectedChoiceText}\n${customInput}`

  for (const character of game.characters) {
    const name = character.name.trim()
    if (name && userText.includes(name)) includedIds.add(character.id)
  }

  return game.characters.filter((character) => includedIds.has(character.id))
}
