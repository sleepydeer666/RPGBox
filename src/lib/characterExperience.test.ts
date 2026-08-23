import { describe, expect, it } from 'vitest'
import type { CharacterProfile, ChatMessage } from '../types'
import { buildCharacterExperienceUserPrompt, chapterExperienceTargets, parseCharacterExperienceResponse } from './characterExperience'

const characters: CharacterProfile[] = ['A', 'B', 'C', 'D'].map((name) => ({ id: name.toLowerCase(), name, role: 'npc', gender: '', description: '', color: '#fff', portraits: [] }))

describe('character experience', () => {
  it('counts every character appearing across multiple states once per assistant round', () => {
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', createdAt: 1, content: '[状态] 地点：一；时间：早；在场人物：A、B、C\n[旁白] 转场。\n[状态] 地点：二；时间：晚；在场人物：C、D\nD（无）：到了。' },
      { id: 'a2', role: 'assistant', createdAt: 2, content: '[状态] 地点：二；时间：晚；在场人物：C\nC（无）：继续。' },
      { id: 'a3', role: 'assistant', createdAt: 3, content: '[状态] 地点：二；时间：晚；在场人物：C\n[旁白] 夜深了。' },
    ]
    expect(chapterExperienceTargets(messages, characters).map(({ character }) => character.id)).toEqual(['c'])
  })

  it('ignores non-story assistant records in the denominator', () => {
    const messages: ChatMessage[] = [
      { id: 'empty', role: 'assistant', createdAt: 1, content: '新的旅程尚未留下文字。' },
      { id: 'a1', role: 'assistant', createdAt: 2, content: '[状态] 地点：一；时间：早；在场人物：A\nA（无）：开始。' },
    ]
    expect(chapterExperienceTargets(messages, characters).map(({ character }) => character.id)).toEqual(['a'])
  })

  it('builds name-based prompts and parses a complete atomic response', () => {
    const targets = chapterExperienceTargets([
      { id: 'a1', role: 'assistant', createdAt: 1, content: '[状态] 地点：一；时间：早；在场人物：A、B\nA（无）：开始。' },
    ], characters, { a: '旧经历' })
    const prompt = buildCharacterExperienceUserPrompt('测试章', targets, '章节摘要正文', '关注承诺')
    expect(prompt).toContain('### A\n已有经历：旧经历')
    expect(prompt).toContain('### B\n已有经历：无')
    expect(parseCharacterExperienceResponse('[A]经历：新经历A\n[B]经历：新经历B', targets)).toEqual({ a: '新经历A', b: '新经历B' })
    expect(parseCharacterExperienceResponse('A经历：新经历A\nB经历：新经历B', targets)).toEqual({ a: '新经历A', b: '新经历B' })
    expect(parseCharacterExperienceResponse('A：新经历A\nB: 新经历B', targets)).toEqual({ a: '新经历A', b: '新经历B' })
    expect(parseCharacterExperienceResponse('以下是整理结果：\n\n[A]经历：新经历A\n\n[B]经历：新经历B\n整理完毕。', targets)).toEqual({ a: '新经历A', b: '新经历B' })
    expect(() => parseCharacterExperienceResponse('[A]经历：新经历A', targets)).toThrow('角色经历缺少：B')
    expect(() => parseCharacterExperienceResponse('[A]经历：一\n[A]经历：二\n[B]经历：三', targets)).toThrow('角色经历重复返回：A')
    expect(() => parseCharacterExperienceResponse('[A]经历：一\n[C]经历：未知\n[B]经历：二', targets)).toThrow('角色经历返回了未知角色：C')
    expect(() => parseCharacterExperienceResponse('A经历：一\nC经历：未知\nB经历：二', targets)).toThrow('角色经历返回了未知角色：C')
    expect(() => parseCharacterExperienceResponse('A经历：\nB经历：二', targets)).toThrow('角色经历内容为空：A')
    expect(parseCharacterExperienceResponse('以下是整理结果：\nA：一\n不相关说明：忽略\nB：二', targets)).toEqual({ a: '一', b: '二' })
  })

  it('explains aliases for the user-controlled character', () => {
    const player = { ...characters[0], role: 'player' as const, name: '居眠鹿' }
    const prompt = buildCharacterExperienceUserPrompt('测试章', [{ character: player, existingExperience: '' }], '本章摘要：司令官完成行动。')
    expect(prompt).toContain('“你”“我”“主角”“司令官”均可能指此角色')
    expect(prompt).toContain('【本章记忆】')
  })
})
