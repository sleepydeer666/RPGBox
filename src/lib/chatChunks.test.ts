import { describe, expect, it } from 'vitest'
import { chunkConversationTurns, flattenConversationTurns, groupConversationTurns, splitMessagesByChapter, takeRecentConversationTurns } from './chatChunks'
import type { ChatMessage } from '../types'

function message(id: string, role: ChatMessage['role'], chapterTitle?: string): ChatMessage {
  return { id, role, content: id, chapterTitle, createdAt: 1 }
}

describe('chapter chat chunks', () => {
  it('keeps multiple assistant messages in one user turn', () => {
    const messages = [message('opening', 'assistant'), message('u1', 'user', 'A'), message('a1', 'assistant', 'A'), message('a1b', 'assistant', 'A'), message('u2', 'user', 'A')]
    const turns = groupConversationTurns(messages)
    expect(turns).toHaveLength(3)
    expect(turns[1].messages.map((item) => item.id)).toEqual(['u1', 'a1', 'a1b'])
    expect(flattenConversationTurns(turns).map((item) => item.id)).toEqual(messages.map((item) => item.id))
  })

  it('creates chapter groups and bounded physical parts', () => {
    const messages = [
      message('u1', 'user', 'A'), message('a1', 'assistant', 'A'),
      message('u2', 'user', 'A'), message('a2', 'assistant', 'A'),
      message('u3', 'user', 'A'), message('a3', 'assistant', 'A'),
      message('u4', 'user', 'B'), message('a4', 'assistant', 'B'),
    ]
    const chunks = splitMessagesByChapter(messages, 2)
    expect(chunks.map((chunk) => [chunk.chapterTitle, chunk.turns.length])).toEqual([['A', 2], ['A', 1], ['B', 1]])
  })

  it('does not split an assistant-only opening into a user turn', () => {
    const turns = groupConversationTurns([message('opening', 'assistant'), message('u1', 'user'), message('a1', 'assistant')])
    expect(turns.map((turn) => turn.messages.map((item) => item.id))).toEqual([['opening'], ['u1', 'a1']])
  })

  it('does not count an assistant-only opening against turn limits', () => {
    const turns = groupConversationTurns([message('opening', 'assistant'), message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant')])
    expect(chunkConversationTurns(turns, 2)).toHaveLength(1)
    expect(takeRecentConversationTurns(turns, 2)).toEqual(turns)
    expect(takeRecentConversationTurns(turns, 1).flatMap((turn) => turn.messages.map((item) => item.id))).toEqual(['u2', 'a2'])
  })
})
