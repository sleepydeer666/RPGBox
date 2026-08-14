import type { CharacterProfile, PortraitGroup, StorySegment } from '../types'

export interface StageActor {
  character: CharacterProfile
  expression: string
  /** Stable visual slot: 0 is left, 1 is right. */
  position: 0 | 1
  /** Monotonic order used to evict the earliest actor. */
  enteredAt: number
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
  let enteredAt = 0
  for (const turn of turns) {
    if (turn.sceneChanged) actors.length = 0
    const present = turn.presentCharacterIds
    if (present) {
      const speakingIds = new Set(turn.segments.filter((segment) => segment.type === 'dialogue').map((segment) => findCharacter(segment, characters)?.id).filter(Boolean))
      for (let index = actors.length - 1; index >= 0; index -= 1) {
        if (!present.includes(actors[index].character.id) && !speakingIds.has(actors[index].character.id)) actors.splice(index, 1)
      }
    }
    for (const segment of turn.segments) {
      if (segment.type !== 'dialogue') continue
      const character = findCharacter(segment, characters)
      if (!character || !hasPortraitForMode(character, mode)) continue
      const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
      if (existingIndex >= 0) {
        actors[existingIndex] = { ...actors[existingIndex], character, expression: segment.expression ?? '' }
      } else {
        const slot = actors.length < limit ? actors.length : oldestActorIndex(actors)
        const position = actors.length < limit ? availablePosition(actors) : actors[slot].position
        const actor = { character, expression: segment.expression ?? '', position, enteredAt: enteredAt++ }
        if (actors.length < limit) actors.push(actor)
        else actors[slot] = actor
      }
    }
    for (const characterId of includePresentCharacters ? present ?? [] : []) {
      if (actors.length >= limit) break
      if (actors.some((actor) => actor.character.id === characterId)) continue
      const character = characters.find((item) => item.id === characterId)
      if (!character || !hasPortraitForMode(character, mode)) continue
      actors.push({ character, expression: '', position: availablePosition(actors), enteredAt: enteredAt++ })
    }
    if (present) {
      for (let index = actors.length - 1; index >= 0; index -= 1) {
        if (!present.includes(actors[index].character.id)) actors.splice(index, 1)
      }
    }
  }
  return actors.sort((left, right) => left.position - right.position)
}

export function includeActiveSpeaker(
  actors: StageActor[],
  segment: StorySegment | undefined,
  characters: CharacterProfile[],
  mode: PortraitGroup = 'normal',
  limit = 2,
): StageActor[] {
  if (segment?.type !== 'dialogue') return actors
  const character = findCharacter(segment, characters)
  if (!character || !hasPortraitForMode(character, mode)) return actors
  const speaker = { character, expression: segment.expression ?? '' }
  const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
  if (existingIndex >= 0) {
    return actors.map((actor, index) => index === existingIndex ? { ...actor, expression: speaker.expression } : actor)
  }
  const next = actors.slice(0, limit)
  const slot = next.length < limit ? next.length : oldestActorIndex(next)
  const position = next.length < limit ? availablePosition(next) : next[slot].position
  const actor = {
    character,
    expression: speaker.expression,
    position,
    enteredAt: Math.max(-1, ...next.map((actor) => actor.enteredAt)) + 1,
  }
  if (next.length < limit) next.push(actor)
  else next[slot] = actor
  return next.sort((left, right) => left.position - right.position)
}

export function collectTurnActors(
  segments: StorySegment[],
  characters: CharacterProfile[],
  presentCharacterIds: string[] | undefined = undefined,
  limit = 4,
  mode: PortraitGroup = 'normal',
): StageActor[] {
  const actors: StageActor[] = []
  const presentIds = presentCharacterIds ? new Set(presentCharacterIds) : undefined
  for (const segment of segments) {
    if (segment.type !== 'dialogue') continue
    const character = findCharacter(segment, characters)
    if (!character || (presentIds && !presentIds.has(character.id)) || !hasPortraitForMode(character, mode)) continue
    const existingIndex = actors.findIndex((actor) => actor.character.id === character.id)
    const actor = { character, expression: segment.expression ?? '', position: (actors.length === 0 ? 0 : 1) as 0 | 1, enteredAt: actors.length }
    if (existingIndex >= 0) actors[existingIndex] = actor
    else if (actors.length < limit) actors.push(actor)
  }
  for (const characterId of presentCharacterIds ?? []) {
    if (actors.length >= limit || actors.some((actor) => actor.character.id === characterId)) continue
    const character = characters.find((item) => item.id === characterId)
    if (!character || !hasPortraitForMode(character, mode)) continue
    actors.push({ character, expression: '', position: (actors.length === 0 ? 0 : 1) as 0 | 1, enteredAt: actors.length })
  }
  return actors
}

function oldestActorIndex(actors: StageActor[]): number {
  return actors.reduce((oldest, actor, index) => (actor.enteredAt ?? index) < (actors[oldest].enteredAt ?? oldest) ? index : oldest, 0)
}

function availablePosition(actors: StageActor[]): 0 | 1 {
  return actors.some((actor) => actor.position === 0) ? 1 : 0
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
