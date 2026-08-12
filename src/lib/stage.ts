import type { CharacterProfile, PortraitGroup, StorySegment } from '../types'

export interface StageActor {
  character: CharacterProfile
  expression: string
}

export interface StageTurn {
  segments: StorySegment[]
  sceneChanged?: boolean
  presentCharacterIds?: string[]
}

export function collectRecentActors(
  turns: StageTurn[],
  characters: CharacterProfile[],
  limit: number,
  mode: PortraitGroup = 'normal',
  includePresentCharacters = false,
): StageActor[] {
  const actors: StageActor[] = []
  const recency: string[] = []
  for (const turn of turns) {
    if (turn.sceneChanged) actors.length = 0
    if (turn.sceneChanged) recency.length = 0
    const present = turn.presentCharacterIds
    if (present) {
      for (let index = actors.length - 1; index >= 0; index -= 1) {
        if (!present.includes(actors[index].character.id)) actors.splice(index, 1)
      }
      for (let index = recency.length - 1; index >= 0; index -= 1) {
        if (!present.includes(recency[index])) recency.splice(index, 1)
      }
    }
    for (const segment of turn.segments) {
      if (segment.type !== 'dialogue') continue
      const character = findCharacter(segment, characters)
      if (!character || !hasPortraitForMode(character, mode)) continue
      const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
      if (existingIndex >= 0) {
        // Keep the character's visual slot stable; only update expression and eviction order.
        actors[existingIndex] = { character, expression: segment.expression ?? '' }
      } else {
        let slot = actors.length
        if (actors.length >= limit) {
          const evictedId = recency.shift()
          slot = evictedId ? actors.findIndex((actor) => actor.character.id === evictedId) : 0
          if (slot < 0) slot = 0
          actors[slot] = { character, expression: segment.expression ?? '' }
        } else {
          actors.push({ character, expression: segment.expression ?? '' })
        }
      }
      const recencyIndex = recency.indexOf(character.id)
      if (recencyIndex >= 0) recency.splice(recencyIndex, 1)
      recency.push(character.id)
    }
    for (const characterId of includePresentCharacters ? present ?? [] : []) {
      if (actors.some((actor) => actor.character.id === characterId)) continue
      const character = characters.find((item) => item.id === characterId)
      if (!character || !hasPortraitForMode(character, mode)) continue
      if (actors.length >= limit) {
        const evictedId = recency.shift()
        const slot = Math.max(0, evictedId ? actors.findIndex((actor) => actor.character.id === evictedId) : 0)
        actors[slot] = { character, expression: '' }
      } else {
        actors.push({ character, expression: '' })
      }
      recency.push(character.id)
    }
    if (present) {
      for (let index = actors.length - 1; index >= 0; index -= 1) {
        if (!present.includes(actors[index].character.id)) actors.splice(index, 1)
      }
    }
  }
  return actors
}

export function includeActiveSpeaker(
  actors: StageActor[],
  segment: StorySegment | undefined,
  characters: CharacterProfile[],
  mode: PortraitGroup = 'normal',
  limit = 4,
): StageActor[] {
  if (segment?.type !== 'dialogue') return actors
  const character = findCharacter(segment, characters)
  if (!character || !hasPortraitForMode(character, mode)) return actors
  const speaker = { character, expression: segment.expression ?? '' }
  const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
  if (existingIndex >= 0) return actors.map((actor, index) => index === existingIndex ? speaker : actor)
  return [...actors.slice(Math.max(0, actors.length - limit + 1)), speaker]
}

export function collectTurnActors(
  segments: StorySegment[],
  characters: CharacterProfile[],
  presentCharacterIds: string[] = [],
  limit = 4,
  mode: PortraitGroup = 'normal',
): StageActor[] {
  const actors: StageActor[] = []
  for (const segment of segments) {
    if (segment.type !== 'dialogue') continue
    const character = findCharacter(segment, characters)
    if (!character || !hasPortraitForMode(character, mode)) continue
    const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
    const actor = { character, expression: segment.expression ?? '' }
    if (existingIndex >= 0) actors[existingIndex] = actor
    else if (actors.length < limit) actors.push(actor)
  }
  for (const characterId of presentCharacterIds) {
    if (actors.length >= limit || actors.some((actor) => actor.character.id === characterId)) continue
    const character = characters.find((item) => item.id === characterId)
    if (!character || !hasPortraitForMode(character, mode)) continue
    actors.push({ character, expression: '' })
  }
  return actors
}

function hasPortraitForMode(character: CharacterProfile, mode: PortraitGroup): boolean {
  return character.portraits.some((portrait) =>
    (portrait.groups?.length ? portrait.groups : ['normal']).includes(mode),
  )
}

function findCharacter(segment: StorySegment, characters: CharacterProfile[]): CharacterProfile | undefined {
  return characters.find((item) => item.id === segment.characterId)
    ?? characters.find((item) => item.name === segment.characterName)
}
