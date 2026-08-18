import type { ChatMessage } from '../types'

export interface DebugExchange {
  requestContent: string
  rawResponse: string
  repairContent?: string
  memorySummaryContent?: string
  inputTokens?: number
  outputTokens?: number
}

export function latestDebugExchange(messages: ChatMessage[]): DebugExchange {
  const assistantIndex = messages.map((message) => message.role).lastIndexOf('assistant')
  const assistant = messages[assistantIndex]
  const user = assistantIndex > 0
    ? [...messages.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')
    : undefined

  return {
    requestContent: user?.requestContent
      ?? (user ? `该历史回合未记录加工后的客户端提示词。\n\n===== 原始用户输入 =====\n${user.content}` : ''),
    rawResponse: assistant?.rawContent ?? assistant?.content ?? '',
    repairContent: assistant?.repairContent,
    memorySummaryContent: assistant?.memorySummaryDebug,
    inputTokens: assistant?.inputTokens,
    outputTokens: assistant?.outputTokens,
  }
}
