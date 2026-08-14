import { describe, expect, it } from 'vitest'
import { tokenizeCharacterNames, tokenizeNarrationText } from './characterText'

describe('tokenizeCharacterNames', () => {
  it('marks configured names and prefers the longest matching name', () => {
    const tokens = tokenizeCharacterNames('维纳斯看向小维纳斯。', [
      { id: 'venus', name: '维纳斯', color: '#f00' },
      { id: 'little-venus', name: '小维纳斯', color: '#0f0' },
    ])

    expect(tokens.filter((token) => token.character).map((token) => token.character?.id)).toEqual(['venus', 'little-venus'])
  })
})

describe('tokenizeNarrationText', () => {
  it('displays the player name as 你 while retaining the player color token', () => {
    const characters = [
      { id: 'player', name: '亚瑟', color: '#33aa66', role: 'player' as const },
      { id: 'venus', name: '维纳斯', color: '#cc6699', role: 'npc' as const },
    ]

    expect(tokenizeNarrationText('亚瑟看向维纳斯，亚瑟点了点头。', characters)).toEqual([
      { text: '你', character: characters[0] },
      { text: '看向' },
      { text: '维纳斯', character: characters[1] },
      { text: '，' },
      { text: '你', character: characters[0] },
      { text: '点了点头。' },
    ])
  })

  it('colors a literal 你 in narration as the player character', () => {
    const player = { id: 'player', name: '亚瑟', color: '#33aa66', role: 'player' as const }

    expect(tokenizeNarrationText('维纳斯向你挥了挥手。', [
      player,
      { id: 'venus', name: '维纳斯', color: '#cc6699', role: 'npc' as const },
    ])).toEqual([
      { text: '维纳斯', character: { id: 'venus', name: '维纳斯', color: '#cc6699', role: 'npc' } },
      { text: '向' },
      { text: '你', character: player },
      { text: '挥了挥手。' },
    ])
  })
})
