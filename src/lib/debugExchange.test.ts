import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import { groupDebugPromptSegments, latestDebugExchange } from './debugExchange'

describe('latestDebugExchange', () => {
  it('pairs the latest assistant response with the processed client request', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '选择A', requestContent: '选择A\n\n输出4个后续选项', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '[旁白] 过滤后的内容', rawContent: '模型思考\n[旁白] 原始内容', memorySummaryDebug: '===== 第 1 次 LLM 返回 =====\n本章摘要：测试', inputTokens: 321, outputTokens: 123, createdAt: 2 },
    ]

    expect(latestDebugExchange(messages)).toEqual({
      requestContent: '选择A\n\n输出4个后续选项',
      requestSegments: [{ title: '旧版请求记录', role: 'user', content: '选择A\n\n输出4个后续选项' }],
      rawResponse: '模型思考\n[旁白] 原始内容',
      repairContent: undefined,
      memorySummaryEntries: [{
        label: '旧版记忆总结记录',
        request: '旧版记录未分别保存总结要求。',
        response: '===== 第 1 次 LLM 返回 =====\n本章摘要：测试',
      }],
      inputTokens: 321,
      outputTokens: 123,
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
      requestSegments: [{
        title: '原始用户输入（旧存档）',
        role: 'user',
        content: '该历史回合未记录加工后的客户端提示词。\n\n===== 原始用户输入 =====\n旧存档输入',
      }],
    })
  })

  it('returns structured request and memory summary snapshots unchanged', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'A', requestSegments: [{ title: '固定系统规则', role: 'system', content: '规则' }], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '回复', memorySummaryDebug: [{ label: '章节总结', request: '要求', response: '原文', inputTokens: 10, outputTokens: 5 }], createdAt: 2 },
    ]
    expect(latestDebugExchange(messages)).toMatchObject({
      requestSegments: [{ title: '固定系统规则', role: 'system', content: '规则' }],
      memorySummaryEntries: [{ label: '章节总结', request: '要求', response: '原文', inputTokens: 10, outputTokens: 5 }],
    })
  })
})

describe('groupDebugPromptSegments', () => {
  it('groups prompts in inspection order and leaves only the current turn intended for default expansion', () => {
    const segments = [
      { title: '固定系统规则', role: 'system' as const, content: '规则' },
      { title: '世界观', role: 'system' as const, content: '世界' },
      { title: '主记忆', role: 'system' as const, content: '近期' },
      { title: '长期记忆', role: 'system' as const, content: '长期' },
      { title: '历史用户输入', role: 'user' as const, content: 'A' },
      { title: '历史剧情回复', role: 'assistant' as const, content: '剧情' },
      { title: '本轮叙事上下文与人物设定', role: 'system' as const, content: '上下文' },
      { title: '本轮玩家输入', role: 'user' as const, content: 'B' },
      { title: '本轮输出契约', role: 'system' as const, content: '契约' },
    ]
    const groups = groupDebugPromptSegments(segments)
    expect(groups.map((group) => [group.id, group.title, group.segments.length])).toEqual([
      ['system', '系统规则', 2],
      ['memory', '记忆', 2],
      ['history', '历史上下文', 2],
      ['current', '本轮输入', 3],
    ])
    expect(groups.flatMap((group) => group.segments)).toEqual(segments)
  })

  it('places legacy request records in the current-turn group', () => {
    expect(groupDebugPromptSegments([{ title: '旧版请求记录', role: 'user', content: '旧请求' }])).toEqual([
      { id: 'current', title: '本轮输入', segments: [{ title: '旧版请求记录', role: 'user', content: '旧请求' }] },
    ])
  })
})
