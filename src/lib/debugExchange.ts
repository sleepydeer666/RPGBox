import type { ChatMessage, DebugPromptSegment, MemorySummaryDebugEntry } from '../types'

export interface DebugExchange {
  requestContent: string
  requestSegments: DebugPromptSegment[]
  rawResponse: string
  repairContent?: string
  memorySummaryEntries: MemorySummaryDebugEntry[]
  inputTokens?: number
  outputTokens?: number
}

export interface DebugPromptGroup {
  id: 'system' | 'memory' | 'history' | 'current'
  title: string
  segments: DebugPromptSegment[]
}

export function groupDebugPromptSegments(segments: DebugPromptSegment[]): DebugPromptGroup[] {
  const groups: DebugPromptGroup[] = [
    { id: 'system', title: '系统规则', segments: [] },
    { id: 'memory', title: '记忆', segments: [] },
    { id: 'history', title: '历史上下文', segments: [] },
    { id: 'current', title: '本轮输入', segments: [] },
  ]
  for (const segment of segments) {
    const groupId = segment.title === '主记忆' || segment.title === '长期记忆'
      ? 'memory'
      : segment.title.startsWith('历史')
        ? 'history'
        : segment.title.startsWith('本轮') || segment.title.includes('旧存档') || segment.title === '旧版请求记录'
          ? 'current'
          : 'system'
    groups.find((group) => group.id === groupId)?.segments.push(segment)
  }
  return groups.filter((group) => group.segments.length)
}

export function latestDebugExchange(messages: ChatMessage[]): DebugExchange {
  const assistantIndex = messages.map((message) => message.role).lastIndexOf('assistant')
  const assistant = messages[assistantIndex]
  const user = assistantIndex > 0
    ? [...messages.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')
    : undefined

  const requestContent = user?.requestContent
    ?? (user ? `该历史回合未记录加工后的客户端提示词。\n\n===== 原始用户输入 =====\n${user.content}` : '')
  const requestSegments = user?.requestSegments?.length
    ? user.requestSegments
    : requestContent ? [{ title: user?.requestContent ? '旧版请求记录' : '原始用户输入（旧存档）', role: 'user' as const, content: requestContent }] : []
  const memorySummaryEntries = Array.isArray(assistant?.memorySummaryDebug)
    ? assistant.memorySummaryDebug
    : assistant?.memorySummaryDebug
      ? [{ label: '旧版记忆总结记录', request: '旧版记录未分别保存总结要求。', response: assistant.memorySummaryDebug }]
      : []

  return {
    requestContent,
    requestSegments,
    rawResponse: assistant?.rawContent ?? assistant?.content ?? '',
    repairContent: assistant?.repairContent,
    memorySummaryEntries,
    inputTokens: assistant?.inputTokens,
    outputTokens: assistant?.outputTokens,
  }
}
