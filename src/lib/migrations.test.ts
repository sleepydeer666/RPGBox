import { describe, expect, it } from 'vitest'
import { migrateLegacyNpcIds } from './migrations'
import type { GameSession } from '../types'

describe('migrateLegacyNpcIds', () => {
  it('replaces lia in the character and structured history while preserving raw debug text', () => {
    const game = {
      id: 'g', title: 'RPG', note: '', newStoryChoiceCount: 4, systemPrompt: '', storyStylePrompt: '', nsfwScenePrompt: '', worldSettingPrompt: '',
      aiSettings: { providerId: '', model: '', useCompatiblePromptFormat: false, temperature: 1, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: 1, contextTurns: 12, warnOnProtocolAnomaly: false },
      characters: [{ id: 'lia', role: 'npc', name: '维纳斯', gender: '', description: '', color: '#fff', portraits: [] }],
      messages: [{ id: 'a', role: 'assistant', content: '<game-data>{"segments":[{"characterId":"lia"}]}</game-data>', rawContent: 'original lia', createdAt: 1 }],
      gameState: { location: '', time: '', contentMode: 'normal', values: {} },
      narrative: {
        chapter: { id: 'chapter-1', title: '序章', startedAtMessageId: 'a' },
        unit: { id: 'unit-1', title: '开场', startedAtMessageId: 'a' },
      },
      memory: { chapterSummary: '', historicalSummary: '', turnsSinceUnitStart: 0 }, updatedAt: 1,
    } satisfies GameSession

    const migrated = migrateLegacyNpcIds(game, () => 'npc-new123')
    expect(migrated.characters[0].id).toBe('npc-new123')
    expect(migrated.messages[0].content).toContain('"characterId":"npc-new123"')
    expect(migrated.messages[0].rawContent).toBe('original lia')
  })

  it('leaves current IDs unchanged', () => {
    const game = { characters: [{ id: 'npc-current', role: 'npc' }] } as unknown as GameSession
    expect(migrateLegacyNpcIds(game)).toBe(game)
  })
})
