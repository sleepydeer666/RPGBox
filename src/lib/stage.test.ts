import { describe, expect, it } from 'vitest'
import { collectRecentActors, collectTurnActors, includeActiveSpeaker } from './stage'
import type { CharacterProfile, StorySegment } from '../types'

const characters: CharacterProfile[] = ['a', 'b', 'c'].map((id) => ({
  id,
  role: 'npc',
  name: id.toUpperCase(),
  gender: '',
  description: '',
  color: '#fff',
  portraits: [{ id: `${id}-normal`, expression: '平静', uri: `file:///${id}.png`, groups: ['normal'] }],
}))

describe('collectRecentActors', () => {
  it('keeps the newest two entrants and evicts the earliest entrant', () => {
    const segments: StorySegment[] = [
      { type: 'dialogue', characterId: 'a', characterName: 'A', expression: '平静', text: '一' },
      { type: 'dialogue', characterId: 'b', characterName: 'B', expression: '开心', text: '二' },
      { type: 'dialogue', characterId: 'a', characterName: 'A', expression: '生气', text: '三' },
      { type: 'dialogue', characterId: 'c', characterName: 'C', expression: '紧张', text: '四' },
    ]

    const actors = collectRecentActors([{ segments }], characters, 2)
    expect(actors.map((actor) => actor.character.id)).toEqual(['c', 'b'])
    expect(actors[0].expression).toBe('紧张')
  })

  it('keeps actors across turns and replaces them from the complete present-character list', () => {
    const actors = collectRecentActors([
      { segments: [{ type: 'dialogue', characterId: 'a', text: '一' }], presentCharacterIds: ['a'] },
      { segments: [{ type: 'dialogue', characterId: 'b', text: '二' }], presentCharacterIds: ['a', 'b'] },
      { segments: [{ type: 'dialogue', characterId: 'c', text: '三' }], presentCharacterIds: ['c'] },
    ], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['c'])
  })

  it('keeps visual slots stable while updating recency order', () => {
    const actors = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
      { type: 'dialogue', characterId: 'a', expression: '开心', text: '三' },
    ] }], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'b'])
    expect(actors[0].expression).toBe('开心')
    expect(actors.map((actor) => actor.position)).toEqual([0, 1])
  })

  it('keeps the surviving right actor on the right when the left actor is evicted', () => {
    const actors = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
      { type: 'dialogue', characterId: 'c', text: '三' },
    ] }], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['c', 'b'])
    expect(actors.map((actor) => actor.position)).toEqual([0, 1])
  })

  it('reuses the earliest entrant slot for a newcomer', () => {
    const actors = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
      { type: 'dialogue', characterId: 'a', text: '三' },
      { type: 'dialogue', characterId: 'c', text: '四' },
    ] }], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['c', 'b'])
  })

  it('treats the player and NPCs identically when they have portraits', () => {
    const player: CharacterProfile = {
      id: 'player', role: 'player', name: '主角', gender: '', description: '', color: '#fff',
      portraits: [{ id: 'player-normal', expression: '平静', uri: 'file:///player.png', groups: ['normal'] }],
    }
    const actors = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'player', text: '二' },
    ] }], [...characters, player], 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'player'])
  })

  it('does not reserve a slot for a character without a portrait in the current mode', () => {
    const noPortrait: CharacterProfile = {
      id: 'empty', role: 'player', name: '主角', gender: '', description: '', color: '#fff', portraits: [],
    }
    const nsfwOnly: CharacterProfile = {
      id: 'nsfw', role: 'npc', name: 'N', gender: '', description: '', color: '#fff',
      portraits: [{ id: 'nsfw-image', expression: '羞耻', uri: 'file:///nsfw.png', groups: ['nsfw'] }],
    }
    const segments: StorySegment[] = [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'empty', text: '二' },
      { type: 'dialogue', characterId: 'nsfw', text: '三' },
    ]

    expect(collectRecentActors([{ segments }], [...characters, noPortrait, nsfwOnly], 2, 'normal').map((actor) => actor.character.id)).toEqual(['a'])
    expect(collectRecentActors([{ segments }], [...characters, noPortrait, nsfwOnly], 2, 'nsfw').map((actor) => actor.character.id)).toEqual(['nsfw'])
  })

  it('removes characters explicitly reported as no longer present', () => {
    const actors = collectRecentActors([
      { segments: [
        { type: 'dialogue', characterId: 'a', text: '一' },
        { type: 'dialogue', characterId: 'b', text: '二' },
      ], presentCharacterIds: ['a', 'b'] },
      { segments: [{ type: 'dialogue', characterId: 'a', text: '三' }], presentCharacterIds: ['a'] },
    ], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a'])
  })

  it('keeps an absent speaker through her current dialogue, then removes her next turn', () => {
    const actors = collectRecentActors([
      { segments: [{ type: 'dialogue', characterId: 'a', text: '一' }, { type: 'dialogue', characterId: 'b', text: '二' }], presentCharacterIds: ['a', 'b'] },
      { segments: [{ type: 'dialogue', characterId: 'b', text: '三' }], presentCharacterIds: ['a'] },
      { segments: [{ type: 'narration', text: '四' }], presentCharacterIds: ['a'] },
    ], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a'])
  })

  it('adds a present character even before that character speaks', () => {
    const actors = collectRecentActors([
      { segments: [{ type: 'narration', text: '两人走进房间。' }], presentCharacterIds: ['a', 'b'] },
    ], characters, 4, 'normal', true)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'b'])
  })

  it('does not let four present characters restore an evicted actor during narration', () => {
    const extra = { ...characters[0], id: 'd', name: 'D', portraits: [{ id: 'd-normal', expression: '平静', uri: 'file:///d.png', groups: ['normal' as const] }] }
    const actors = collectRecentActors([
      { segments: [{ type: 'dialogue', characterId: 'c', text: '三' }, { type: 'dialogue', characterId: 'd', text: '四' }], presentCharacterIds: ['a', 'b', 'c', 'd'] },
      { segments: [{ type: 'dialogue', characterId: 'a', text: '一' }, { type: 'narration', text: '旁白' }], presentCharacterIds: ['a', 'b', 'c', 'd'] },
    ], [...characters, extra], 2, 'normal', true)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'd'])
    expect(actors.map((actor) => actor.position)).toEqual([0, 1])
  })
})

describe('temporary and choice actors', () => {
  it('temporarily adds the active speaker even when the character is not present', () => {
    const present = collectRecentActors([
      { segments: [], presentCharacterIds: ['a'] },
    ], characters, 2, 'normal', true)

    const speaking = includeActiveSpeaker(present, { type: 'dialogue', characterId: 'b', expression: '紧张', text: '等等。' }, characters)
    expect(speaking.map((actor) => actor.character.id)).toEqual(['a', 'b'])
    expect(speaking[1].expression).toBe('紧张')
    const afterSpeaking = includeActiveSpeaker(present, { type: 'narration', text: '话音落下。' }, characters)
    expect(afterSpeaking.map((actor) => actor.character.id)).toEqual(['a'])
  })

  it('replaces the earliest slot instead of creating a third dialogue portrait', () => {
    const present = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
    ] }], characters, 2)

    const speaking = includeActiveSpeaker(present, { type: 'dialogue', characterId: 'c', text: '三' }, characters)
    expect(speaking).toHaveLength(2)
    expect(speaking.map((actor) => actor.character.id)).toEqual(['c', 'b'])
    expect(speaking.map((actor) => actor.position)).toEqual([0, 1])
  })

  it('uses an explicit present list as the source of truth for choice portraits', () => {
    const extra = ['d', 'e'].map((id) => ({
      ...characters[0], id, name: id.toUpperCase(), portraits: [{ id: `${id}-normal`, expression: '平静', uri: `file:///${id}.png`, groups: ['normal' as const] }],
    }))
    const allCharacters = [...characters, ...extra]
    const actors = collectTurnActors([
      { type: 'dialogue', characterId: 'a', expression: '平静', text: '一' },
      { type: 'dialogue', characterId: 'b', expression: '开心', text: '二' },
      { type: 'dialogue', characterId: 'a', expression: '生气', text: '三' },
      { type: 'dialogue', characterId: 'c', expression: '紧张', text: '四' },
    ], allCharacters, ['a', 'c', 'd', 'e'], 4)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(actors[0].expression).toBe('生气')
  })

  it('includes the player portrait on the choice screen when the player is present', () => {
    const player: CharacterProfile = {
      id: 'player', role: 'player', name: '主角', gender: '', description: '', color: '#fff',
      portraits: [{ id: 'player-normal', expression: '平静', uri: 'file:///player.png', groups: ['normal'] }],
    }
    const actors = collectTurnActors([
      { type: 'dialogue', characterId: 'a', text: '准备好了吗？' },
      { type: 'dialogue', characterId: 'player', text: '走吧。' },
    ], [...characters, player], ['a', 'player'], 4)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'player'])
  })

  it('falls back to this turn speakers when no present list was reported', () => {
    const actors = collectTurnActors([
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
    ], characters, undefined, 4)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'b'])
  })
})
