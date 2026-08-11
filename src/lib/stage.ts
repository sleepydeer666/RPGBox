import type { CharacterProfile, PortraitGroup, StorySegment } from '../types'

export interface StageActor {
  character: CharacterProfile
  expression: string
}

export interface StageTurn {
  segments: StorySegment[]
  sceneChanged?: boolean
}

export function collectRecentActors(
  turns: StageTurn[],
  characters: CharacterProfile[],
  limit: number,
  mode: PortraitGroup = 'normal',
): StageActor[] {
  const actors: StageActor[] = []
  const recency: string[] = []
  for (const turn of turns) {
    if (turn.sceneChanged) actors.length = 0
    if (turn.sceneChanged) recency.length = 0
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
