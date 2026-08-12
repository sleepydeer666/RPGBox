import type { CharacterStatusUpdate, GameSession, RollbackSnapshot } from '../types'

export function createRollbackSnapshot(game: GameSession, id: string, createdAt = Date.now()): RollbackSnapshot {
  return {
    id,
    createdAt,
    messageCount: game.messages.length,
    gameState: game.gameState,
    narrative: game.narrative,
    memory: game.memory,
    characterStatuses: Object.fromEntries(game.characters.map((character) => [character.id, character.statusBar ?? ''])),
  }
}

export function appendRollbackSnapshot(log: RollbackSnapshot[] | undefined, snapshot: RollbackSnapshot): RollbackSnapshot[] {
  return [...(log ?? []), snapshot].slice(-5)
}

export function latestTurnPreviousStatuses(game: GameSession): Record<string, string> | undefined {
  const snapshot = game.rollbackLog?.at(-1)
  const latestMessages = game.messages.slice(-2)
  if (!snapshot?.characterStatuses
    || snapshot.messageCount !== game.messages.length - 2
    || latestMessages[0]?.role !== 'user'
    || latestMessages[1]?.role !== 'assistant') return undefined
  return snapshot.characterStatuses
}

export function changedStatusCharacterIds(
  previousStatuses: Record<string, string> | undefined,
  updates: CharacterStatusUpdate[],
): Set<string> {
  if (!previousStatuses) return new Set()
  return new Set(updates.flatMap((update) => {
    const previous = previousStatuses[update.characterId]?.trim() ?? ''
    return previous && previous !== update.status.trim() ? [update.characterId] : []
  }))
}

export function restoreLastRollback(game: GameSession): GameSession | undefined {
  const log = game.rollbackLog ?? []
  const snapshot = log.at(-1)
  if (!snapshot) return undefined
  return {
    ...game,
    messages: game.messages.slice(0, snapshot.messageCount),
    gameState: snapshot.gameState,
    narrative: snapshot.narrative,
    memory: snapshot.memory,
    characters: game.characters.map((character) => snapshot.characterStatuses && Object.hasOwn(snapshot.characterStatuses, character.id)
      ? { ...character, statusBar: snapshot.characterStatuses[character.id] }
      : character),
    rollbackLog: log.slice(0, -1),
  }
}
