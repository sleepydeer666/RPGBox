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
    expect(parseCharacterExperienceResponse('[A]经历：新经历A\n[B]经历：新经历B', targets).experiences).toEqual({ a: '新经历A', b: '新经历B' })
    expect(parseCharacterExperienceResponse('A经历：新经历A\nB: 新经历B', targets).experiences).toEqual({ a: '新经历A', b: '新经历B' })
    expect(parseCharacterExperienceResponse('[A]：新经历A\nA：重复\n[C]：未知\n[B]：新经历B', targets)).toEqual({ experiences: { a: '新经历A', b: '新经历B' }, missingCharacterNames: [] })
    expect(parseCharacterExperienceResponse('[A]经历：新经历A', targets)).toEqual({ experiences: { a: '新经历A' }, missingCharacterNames: ['B'] })
    expect(() => parseCharacterExperienceResponse('以下是说明，没有角色结果', targets)).toThrow('没有可识别')
    expect(parseCharacterExperienceResponse('以下是整理结果：\nA：一\n不相关说明：忽略\nB：二', targets).experiences).toEqual({ a: '一', b: '二' })
  })

  it('explains aliases for the user-controlled character', () => {
    const player = { ...characters[0], role: 'player' as const, name: '居眠鹿' }
    const prompt = buildCharacterExperienceUserPrompt('测试章', [{ character: player, existingExperience: '' }], '本章摘要：司令官完成行动。')
    expect(prompt).toContain('“你”“我”“主角”“司令官”均可能指此角色')
    expect(prompt).toContain('【本章记忆】')
  })

  it('normalizes inline labels after a thinking prefix', () => {
    const targets = [
      { character: { ...characters[0], name: '居眠鹿', role: 'player' as const }, existingExperience: '' },
      { character: characters[1], existingExperience: '' },
    ]
    const raw = '思考过程……最终整理如下：[居眠鹿]经历：主角完成任务。[B]经历：B与主角建立承诺。'
    expect(parseCharacterExperienceResponse(raw, targets)).toEqual({
      experiences: { a: '主角完成任务。', b: 'B与主角建立承诺。' },
      missingCharacterNames: [],
    })
  })

  it('keeps legacy labels and splits adjacent labels with ascii punctuation', () => {
    const targets = [
      { character: characters[0], existingExperience: '' },
      { character: characters[1], existingExperience: '' },
    ]
    expect(parseCharacterExperienceResponse('A经历:经历A B：经历B', targets)).toEqual({
      experiences: { a: '经历A', b: '经历B' },
      missingCharacterNames: [],
    })
  })

  it('does not let one result consume the next target label', () => {
    const targets = [
      { character: characters[0], existingExperience: '' },
      { character: characters[1], existingExperience: '' },
    ]
    expect(parseCharacterExperienceResponse('[A]：第一段。[B]：第二段。', targets).experiences).toEqual({ a: '第一段。', b: '第二段。' })
  })
})
