import { describe, expect, it } from 'vitest'
import { collectRecentActors } from './stage'
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
  it('returns the most recent unique characters with portraits in stage order', () => {
    const segments: StorySegment[] = [
      { type: 'dialogue', characterId: 'a', characterName: 'A', expression: '平静', text: '一' },
      { type: 'dialogue', characterId: 'b', characterName: 'B', expression: '开心', text: '二' },
      { type: 'dialogue', characterId: 'a', characterName: 'A', expression: '生气', text: '三' },
      { type: 'dialogue', characterId: 'c', characterName: 'C', expression: '紧张', text: '四' },
    ]

    const actors = collectRecentActors([{ segments }], characters, 2)
    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'c'])
    expect(actors[0].expression).toBe('生气')
  })

  it('keeps actors across turns and clears them on a scene change', () => {
    const actors = collectRecentActors([
      { segments: [{ type: 'dialogue', characterId: 'a', text: '一' }] },
      { segments: [{ type: 'dialogue', characterId: 'b', text: '二' }] },
      { sceneChanged: true, segments: [{ type: 'dialogue', characterId: 'c', text: '三' }] },
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
  })

  it('reuses an evicted character slot for a newcomer', () => {
    const actors = collectRecentActors([{ segments: [
      { type: 'dialogue', characterId: 'a', text: '一' },
      { type: 'dialogue', characterId: 'b', text: '二' },
      { type: 'dialogue', characterId: 'a', text: '三' },
      { type: 'dialogue', characterId: 'c', text: '四' },
    ] }], characters, 2)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'c'])
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

  it('adds a present character even before that character speaks', () => {
    const actors = collectRecentActors([
      { segments: [{ type: 'narration', text: '两人走进房间。' }], presentCharacterIds: ['a', 'b'] },
    ], characters, 4, 'normal', true)

    expect(actors.map((actor) => actor.character.id)).toEqual(['a', 'b'])
  })
})
