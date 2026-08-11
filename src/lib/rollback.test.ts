import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game'
import type { RollbackSnapshot } from '../types'
import { appendRollbackSnapshot, createRollbackSnapshot, restoreLastRollback } from './rollback'

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
})
