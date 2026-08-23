import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import type { CharacterProfile, Choice } from '../types'
import { selectTurnPortraitCharacters } from './turnPortraits'

const characters: CharacterProfile[] = [
  { id: 'p', role: 'player', name: '主角', gender: '', description: '', color: '#fff', portraits: [] },
  { id: 'n1', role: 'npc', name: '人物1', gender: '', description: '', color: '#fff', portraits: [] },
  { id: 'n2', role: 'npc', name: '人物2', gender: '', description: '', color: '#fff', portraits: [] },
  { id: 'n3', role: 'npc', name: '人物3', gender: '', description: '', color: '#fff', portraits: [] },
  { id: 'n4', role: 'npc', name: '人物4', gender: '', description: '', color: '#fff', portraits: [] },
]

const choices: Choice[] = [
  { id: 'A', text: '继续和人物1交谈' },
  { id: 'D', text: '召唤人物3来解决问题（后续叙事模式：正常）' },
]

describe('turn portrait character selection', () => {
  it('sends every character during opening, transition, or a newly requested transition', () => {
    const game = createBlankGame(1)
    game.characters = characters

    expect(selectTurnPortraitCharacters(game, choices, [], '', false)).toEqual(characters)
    game.narrative.chapterPhase = 'transition'
    expect(selectTurnPortraitCharacters(game, choices, [], '', false)).toEqual(characters)
    game.narrative.chapterPhase = 'active'
    expect(selectTurnPortraitCharacters(game, choices, [], '', true)).toEqual(characters)
  })

  it('combines present characters with names from selected choices and custom input', () => {
    const game = createBlankGame(1)
    game.characters = characters
    game.narrative.chapterPhase = 'active'
    game.gameState.presentCharacterIds = ['n1', 'n2']

    expect(selectTurnPortraitCharacters(game, choices, ['D'], '让人物4也一起来', false).map((item) => item.id))
      .toEqual(['p', 'n1', 'n2', 'n3', 'n4'])
  })

  it('does not add characters mentioned only by unselected choices', () => {
    const game = createBlankGame(1)
    game.characters = characters
    game.narrative.chapterPhase = 'active'
    game.gameState.presentCharacterIds = ['n1']

    expect(selectTurnPortraitCharacters(game, choices, ['A'], '', false).map((item) => item.id))
      .toEqual(['p', 'n1'])
  })

  it('always includes the user-controlled character during an active chapter', () => {
    const game = createBlankGame(1)
    game.characters = characters
    game.narrative.chapterPhase = 'active'
    game.gameState.presentCharacterIds = ['n2']

    expect(selectTurnPortraitCharacters(game, choices, [], '', false).map((item) => item.id))
      .toEqual(['p', 'n2'])
  })
})
