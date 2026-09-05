import type { ChatMessage } from '../types'

export interface ConversationTurn {
  id: string
  messages: ChatMessage[]
  chapterId?: string
  chapterTitle?: string
}

export interface ChatChunk {
  id: string
  chapterId?: string
  chapterTitle?: string
  turns: ConversationTurn[]
}

/** Groups messages without splitting a user turn from its assistant response(s). */
export function groupConversationTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let current: ConversationTurn | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: `turn-${message.id}`,
        messages: [message],
        chapterTitle: message.chapterTitle,
      }
      turns.push(current)
      continue
    }
    if (!current) {
      turns.push({ id: `turn-${message.id}`, messages: [message], chapterTitle: message.chapterTitle })
      continue
    }
    current.messages.push(message)
    current.chapterTitle ??= message.chapterTitle
  }
  return turns
}

/** Splits a chapter into bounded physical files while keeping chapter pagination logical. */
export function chunkConversationTurns(turns: ConversationTurn[], maxTurns = 50): ChatChunk[] {
  const limit = Math.max(1, Math.floor(maxTurns))
  const chunks: ChatChunk[] = []
  let part: ConversationTurn[] = []
  let countedTurns = 0
  const flush = () => {
    if (!part.length) return
    const first = part[0]
    chunks.push({
      id: `part-${String(chunks.length + 1).padStart(6, '0')}`,
      chapterId: first?.chapterId,
      chapterTitle: first?.chapterTitle,
      turns: part,
    })
    part = []
    countedTurns = 0
  }
  for (const turn of turns) {
    const countsAsTurn = turn.messages.some((message) => message.role === 'user')
    if (countsAsTurn && countedTurns >= limit) flush()
    part.push(turn)
    if (countsAsTurn) countedTurns += 1
  }
  flush()
  return chunks
}

export function takeRecentConversationTurns(turns: ConversationTurn[], maxTurns = 50): ConversationTurn[] {
  const limit = Math.max(1, Math.floor(maxTurns))
  if (turns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length <= limit) return turns
  let remaining = limit
  let start = turns.length
  while (start > 0 && remaining > 0) {
    start -= 1
    if (turns[start].messages.some((message) => message.role === 'user')) remaining -= 1
  }
  return turns.slice(start)
}

export function flattenConversationTurns(turns: ConversationTurn[]): ChatMessage[] {
  return turns.flatMap((turn) => turn.messages)
}

export function splitMessagesByChapter(messages: ChatMessage[], maxTurns = 50): ChatChunk[] {
  const turns = groupConversationTurns(messages)
  const chunks: ChatChunk[] = []
  let chapterTurns: ConversationTurn[] = []
  let chapterKey: string | undefined

  const flush = () => {
    if (!chapterTurns.length) return
    chunks.push(...chunkConversationTurns(chapterTurns, maxTurns).map((chunk) => ({
      ...chunk,
      id: `part-${String(chunks.length + 1).padStart(6, '0')}`,
      chapterId: chapterKey,
      chapterTitle: chapterTurns[0]?.chapterTitle,
    })))
    chapterTurns = []
  }

  for (const turn of turns) {
    const nextKey = turn.chapterId ?? turn.chapterTitle ?? ''
    if (chapterTurns.length && nextKey !== chapterKey) flush()
    chapterKey = nextKey
    chapterTurns.push(turn)
  }
  flush()
  return chunks
}
