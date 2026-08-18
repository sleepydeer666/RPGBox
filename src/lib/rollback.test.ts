import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game'
import type { RollbackSnapshot } from '../types'
import { appendRollbackSnapshot, changedStatusCharacterIds, createRollbackSnapshot, latestTurnPreviousStatuses, restoreLastRollback, rollbackInputDraft } from './rollback'

describe('RPG turn rollback', () => {
  it('restores messages, state and memory from the previous turn', () => {
    const initial = createInitialGame()
    const before = {
      ...initial,
      characters: initial.characters.map((character) => ({ ...character, statusBar: '初始状态' })),
    }
    const snapshot = createRollbackSnapshot(before, 'rollback-1', 1)
    const after = {
      ...before,
      messages: [...before.messages, { id: 'user-1', role: 'user' as const, content: '继续', createdAt: 2 }],
      gameState: { ...before.gameState, location: '新地点' },
      memory: { ...before.memory, currentChapterSummary: '新记忆' },
      characters: before.characters.map((character) => ({ ...character, statusBar: '新状态' })),
      rollbackLog: [snapshot],
    }

    const restored = restoreLastRollback(after)
    expect(restored?.messages).toHaveLength(before.messages.length)
    expect(restored?.gameState.location).toBe(before.gameState.location)
    expect(restored?.memory.currentChapterSummary).toBe(before.memory.currentChapterSummary)
    expect(restored?.characters[0]?.statusBar).toBe('初始状态')
    expect(restored?.rollbackLog).toEqual([])
  })

  it('retains at most five rollback snapshots', () => {
    const game = createInitialGame()
    const log = Array.from({ length: 6 }, (_, index) => createRollbackSnapshot(game, `rollback-${index}`, index))
      .reduce<RollbackSnapshot[]>((current, snapshot) => appendRollbackSnapshot(current, snapshot), [])
    expect(log.map((snapshot) => snapshot.id)).toEqual(['rollback-1', 'rollback-2', 'rollback-3', 'rollback-4', 'rollback-5'])
  })

  it('returns previous statuses only for the latest complete turn', () => {
    const game = createInitialGame()
    const snapshot = createRollbackSnapshot(game, 'rollback-latest', 1)
    const after = {
      ...game,
      messages: [
        ...game.messages,
        { id: 'user-1', role: 'user' as const, content: '继续', createdAt: 2 },
        { id: 'assistant-1', role: 'assistant' as const, content: '回答', createdAt: 3 },
      ],
      rollbackLog: [snapshot],
    }

    expect(latestTurnPreviousStatuses(after)).toEqual(snapshot.characterStatuses)
    expect(latestTurnPreviousStatuses({ ...after, rollbackLog: [{ ...snapshot, messageCount: 0 }] })).toBeUndefined()
  })

  it('marks only changed non-empty statuses for notification', () => {
    const changed = changedStatusCharacterIds({ a: '疲惫', b: '', c: '平静' }, [
      { characterId: 'a', characterName: 'A', status: '振奋' },
      { characterId: 'b', characterName: 'B', status: '紧张' },
      { characterId: 'c', characterName: 'C', status: '平静' },
    ])

    expect([...changed]).toEqual(['a'])
  })

  it('restores the selected choices and manual input from the rolled back turn', () => {
    const game = createInitialGame()
    const snapshot = createRollbackSnapshot(game, 'rollback-input', 1)
    const after = {
      ...game,
      messages: [...game.messages, {
        id: 'user-input', role: 'user' as const, content: 'AC，但是先观察四周',
        selectedChoiceIds: ['A', 'C'], customInput: '先观察四周', createdAt: 2,
      }],
      rollbackLog: [snapshot],
    }

    expect(rollbackInputDraft(after)).toEqual({ selectedChoiceIds: ['A', 'C'], customInput: '先观察四周' })
  })

  it('infers a simple choice and manual input from legacy history', () => {
    const game = createInitialGame()
    const snapshot = createRollbackSnapshot(game, 'rollback-legacy', 1)
    const after = {
      ...game,
      messages: [...game.messages, { id: 'legacy-user', role: 'user' as const, content: 'AB，但是保持警惕', createdAt: 2 }],
      rollbackLog: [snapshot],
    }

    expect(rollbackInputDraft(after)).toEqual({ selectedChoiceIds: ['A', 'B'], customInput: '保持警惕' })
  })
})
