import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import { latestDebugExchange } from './debugExchange'

describe('latestDebugExchange', () => {
  it('pairs the latest assistant response with the processed client request', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '选择A', requestContent: '选择A\n\n输出4个后续选项', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '[旁白] 过滤后的内容', rawContent: '模型思考\n[旁白] 原始内容', memorySummaryDebug: '===== 第 1 次 LLM 返回 =====\n本章摘要：测试', createdAt: 2 },
    ]

    expect(latestDebugExchange(messages)).toEqual({
      requestContent: '选择A\n\n输出4个后续选项',
      rawResponse: '模型思考\n[旁白] 原始内容',
      repairContent: undefined,
      memorySummaryContent: '===== 第 1 次 LLM 返回 =====\n本章摘要：测试',
    })
  })

  it('labels legacy history instead of presenting raw input as the processed request', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '旧存档输入', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '旧存档回复', createdAt: 2 },
    ]

    expect(latestDebugExchange(messages)).toMatchObject({
      requestContent: '该历史回合未记录加工后的客户端提示词。\n\n===== 原始用户输入 =====\n旧存档输入',
      rawResponse: '旧存档回复',
    })
  })
})
