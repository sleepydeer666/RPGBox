import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { normalizeGameNarrativeModes, removeNarrativeMode } from './narrativeModes'
import { parseChoiceStateTransition } from './rpgState'

describe('narrative modes', () => {
  it('provides the default narrative modes', () => {
    const game = createBlankGame(1)
    const normalized = normalizeGameNarrativeModes({ ...game, narrativeModes: undefined })
    expect(normalized.narrativeModes?.map((mode) => [mode.id, mode.name])).toEqual([
      ['normal', '正常'],
      ['nsfw', 'NSFW'],
    ])
  })

  it('moves exclusive portraits to the previous mode when deleting a mode', () => {
    const game = createBlankGame(1)
    game.narrativeModes = [
      { id: 'normal', name: '正常', color: '#111111' },
      { id: 'battle', name: '战斗', color: '#222222' },
      { id: 'camp', name: '营地', color: '#333333' },
    ]
    game.gameState.contentMode = 'battle'
    game.characters[0].portraits = [
      { id: 'exclusive', expression: '战斗', uri: 'exclusive.png', groups: ['battle'] },
      { id: 'shared', expression: '认真', uri: 'shared.png', groups: ['battle', 'camp'] },
      { id: 'unused', expression: '备用', uri: 'unused.png', groups: [] },
    ]
    game.characters[0].defaultPortraitIds = { battle: 'exclusive' }
    game.characters[0].modeDescriptions = { normal: '日常设定', battle: '战斗设定' }
    game.modeStoryStylePrompts = { normal: '日常文风', battle: '战斗文风', camp: '营地文风' }
    game.messages[0].rpgStateId = 'battle'
    game.messages[0].initialRpgStateId = 'battle'
    game.rollbackLog = [{
      id: 'rollback', createdAt: 1, messageCount: 1,
      gameState: { ...game.gameState }, narrative: game.narrative, memory: game.memory,
    }]

    const result = removeNarrativeMode(game, 'battle')
    expect(result.gameState.contentMode).toBe('normal')
    expect(result.messages[0].rpgStateId).toBe('normal')
    expect(result.messages[0].initialRpgStateId).toBe('normal')
    expect(result.rollbackLog?.[0].gameState.contentMode).toBe('normal')
    expect(result.characters[0].portraits[0].groups).toEqual(['normal'])
    expect(result.characters[0].portraits[1].groups).toEqual(['camp'])
    expect(result.characters[0].portraits[2].groups).toEqual([])
    expect(result.characters[0].defaultPortraitIds).toMatchObject({ normal: 'exclusive' })
    expect(result.characters[0].modeDescriptions).toEqual({ normal: '日常设定\n战斗设定' })
    expect(result.modeStoryStylePrompts).toEqual({ normal: '日常文风\n战斗文风', camp: '营地文风' })
  })

  it('moves the first mode to the new first mode and keeps the final mode undeletable', () => {
    const game = createBlankGame(1)
    game.characters[0].portraits = [{ id: 'portrait', expression: '默认', uri: 'p.png', groups: ['normal'] }]
    const result = removeNarrativeMode(game, 'normal')
    expect(result.narrativeModes?.map((mode) => mode.id)).toEqual(['nsfw'])
    expect(result.characters[0].portraits[0].groups).toEqual(['nsfw'])
    expect(removeNarrativeMode(result, 'nsfw')).toBe(result)
  })

  it('parses a custom display name into its stable mode id', () => {
    expect(parseChoiceStateTransition('拔剑迎战（后续叙事模式：战斗）', [
      { id: 'normal', name: '日常', color: '#111111' },
      { id: 'battle', name: '战斗', color: '#222222' },
    ])).toBe('battle')
  })
})
