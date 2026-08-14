import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { buildTurnChoiceInstruction, buildTurnInstructions, chapterTurnCountBeforeLatestBoundary, CHAPTER_ENDING_CHOICE_INSTRUCTION, CHAPTER_ENDING_FORBIDDEN_INSTRUCTION, CHAPTER_NAMING_INSTRUCTION, currentChapterTurnCount, reportedChapterTitle, selectedChoiceEndsChapter, shouldRequestNewChapterName, shouldSuggestChapterEnding } from './chapterTurns'
import { parseAssistantResponse } from './parser'

describe('chapter turn tracking', () => {
  it('counts completed user turns in the current chapter after its boundary', () => {
    const game = createBlankGame(1)
    game.narrative.chapter = { id: 'chapter-2', title: '深渊第三层探索', startedAtMessageId: 'u2' }
    game.messages = [
      { id: 'u1', role: 'user', content: '旧章节', chapterTitle: '旧章节', createdAt: 1 },
      { id: 'u2', role: 'user', content: '开始探索', chapterTitle: '深渊第三层探索', createdAt: 2 },
      { id: 'a2', role: 'assistant', content: '[旁白] 前进。', chapterTitle: '深渊第三层探索', createdAt: 3 },
      { id: 'u3', role: 'user', content: '继续', chapterTitle: '深渊第三层探索', createdAt: 4 },
    ]

    expect(currentChapterTurnCount(game)).toBe(2)
  })

  it('only requests an ending option when the enabled threshold is reached', () => {
    const game = createBlankGame(1)
    game.narrative.chapter = { id: 'chapter-1', title: '测试章节', startedAtMessageId: 'u1' }
    game.messages = Array.from({ length: 9 }, (_, index) => ({
      id: `u${index + 1}`, role: 'user' as const, content: '继续', chapterTitle: '测试章节', createdAt: index,
    }))
    game.recommendedChapterTurns = 10

    expect(shouldSuggestChapterEnding(game)).toBe(false)
    game.recommendedChapterTurnsEnabled = true
    expect(shouldSuggestChapterEnding(game)).toBe(false)
    game.messages.push({ id: 'u10', role: 'user', content: '继续', chapterTitle: '测试章节', createdAt: 10 })
    expect(shouldSuggestChapterEnding(game)).toBe(true)
    expect(CHAPTER_ENDING_CHOICE_INSTRUCTION).toContain('（结束章节）')
  })

  it('builds client-owned choice instructions for new, ongoing, and ending turns', () => {
    const game = createBlankGame(1)
    game.newStoryChoiceCount = 8

    expect(buildTurnChoiceInstruction(game, false)).toBe('输出8个后续选项，具体要求需参考章节切换规则中的相应内容')
    game.messages.push({ id: 'u1', role: 'user', content: '开始', createdAt: 1 })
    expect(buildTurnChoiceInstruction(game, false)).toBe('输出4个后续选项')
    expect(buildTurnChoiceInstruction(game, true)).toBe('结束本章节，并开启新章节的剧情引子。之后输出8个后续选项，具体要求需参考章节切换规则中的相应内容')
  })

  it('adds the chapter-ending option request only after the configured limit', () => {
    const game = createBlankGame(1)
    game.chapterTransitionRules = '新章节必须从明确事件开始。'
    game.narrative.chapter = { id: 'chapter-1', title: '新章节', startedAtMessageId: 'u1' }
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 10
    game.messages = [{ id: 'u1', role: 'user', content: '开始章节', chapterTitle: '新章节', createdAt: 1 }]

    expect(buildTurnInstructions(game, false)).toEqual(['输出4个后续选项'])

    game.messages = Array.from({ length: 10 }, (_, index) => ({
      id: `u${index + 1}`, role: 'user' as const, content: '继续', chapterTitle: '新章节', createdAt: index,
    }))
    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_ENDING_CHOICE_INSTRUCTION,
    ])
    expect(buildTurnInstructions(game, true)).toEqual([
      '结束本章节，并开启新章节的剧情引子。之后输出4个后续选项，具体要求需参考章节切换规则中的相应内容',
      '章节切换规则：\n新章节必须从明确事件开始。',
    ])
  })

  it('appends chapter transition rules only for a new game or an ending turn', () => {
    const game = createBlankGame(1)
    game.chapterTransitionRules = '  新章节必须从明确事件开始。  '

    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项，具体要求需参考章节切换规则中的相应内容',
      '章节切换规则：\n新章节必须从明确事件开始。',
      CHAPTER_ENDING_FORBIDDEN_INSTRUCTION,
    ])

    game.messages.push({ id: 'u1', role: 'user', content: '开始', createdAt: 1 })
    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_ENDING_FORBIDDEN_INSTRUCTION,
    ])

    game.chapterTransitionRules = '   '
    expect(buildTurnInstructions(game, true)).toEqual([
      '结束本章节，并开启新章节的剧情引子。之后输出4个后续选项，具体要求需参考章节切换规则中的相应内容',
    ])
  })

  it('forbids chapter endings while opening the game or staying in a transition', () => {
    const game = createBlankGame(1)

    expect(buildTurnInstructions(game, false)).toContain(CHAPTER_ENDING_FORBIDDEN_INSTRUCTION)
    expect(CHAPTER_ENDING_FORBIDDEN_INSTRUCTION).toContain('不得输出“[章节结束]”')
    expect(CHAPTER_ENDING_FORBIDDEN_INSTRUCTION).toContain('无需生成或标记任何“（结束章节）”选项')

    game.messages.push({ id: 'u1', role: 'user', content: '继续过渡', chapterTitle: '', createdAt: 1 })
    game.narrative.chapter = { id: 'transition', title: '', startedAtMessageId: 'u1' }
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 10

    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_ENDING_FORBIDDEN_INSTRUCTION,
    ])
  })

  it('requests a chapter name only after two consecutive empty assistant chapter titles', () => {
    const game = createBlankGame(1)
    game.messages = [
      { id: 'a1', role: 'assistant', content: '[状态] 章节：旧章', chapterTitle: '旧章', createdAt: 1 },
      { id: 'u1', role: 'user', content: '结束章节', chapterTitle: '', createdAt: 2 },
      { id: 'a2', role: 'assistant', content: '[状态] 章节：', chapterTitle: '', createdAt: 3 },
    ]

    expect(shouldRequestNewChapterName(game)).toBe(false)
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_NAMING_INSTRUCTION)

    game.messages.push(
      { id: 'u2', role: 'user', content: '继续', chapterTitle: '', createdAt: 4 },
      { id: 'a3', role: 'assistant', content: '[状态] 章节：', chapterTitle: '', createdAt: 5 },
    )
    expect(shouldRequestNewChapterName(game)).toBe(true)
    expect(buildTurnInstructions(game, false)).toContain(CHAPTER_NAMING_INSTRUCTION)

    game.messages.push(
      { id: 'u3', role: 'user', content: '进入遗迹', chapterTitle: '遗迹探索', createdAt: 6 },
      { id: 'a4', role: 'assistant', content: '[状态] 章节：遗迹探索', chapterTitle: '遗迹探索', createdAt: 7 },
    )
    expect(shouldRequestNewChapterName(game)).toBe(false)
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_NAMING_INSTRUCTION)
  })

  it('detects an ending marker only on a selected choice', () => {
    const choices = [
      { id: 'A', text: '继续探索' },
      { id: 'B', text: '返回城镇（结束章节）' },
    ]

    expect(selectedChoiceEndsChapter(choices, ['A'])).toBe(false)
    expect(selectedChoiceEndsChapter(choices, ['B'])).toBe(true)
  })

  it('keeps the old chapter count before playback crosses the latest boundary', () => {
    const game = createBlankGame(1)
    game.narrative.chapter = { id: 'transition', title: '', startedAtMessageId: 'u3' }
    game.messages = [
      { id: 'u1', role: 'user', content: '一', chapterTitle: '旧章', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '[旁白] 一', chapterTitle: '旧章', createdAt: 2 },
      { id: 'u2', role: 'user', content: '二', chapterTitle: '', createdAt: 3 },
      { id: 'a2', role: 'assistant', content: '[旁白] 二\n[章节结束]\n[旁白] 过渡', chapterTitle: '', createdAt: 4 },
    ]
    game.rollbackLog = [{
      id: 'r1', createdAt: 3, messageCount: 2,
      gameState: game.gameState,
      narrative: { chapter: { id: 'old', title: '旧章', startedAtMessageId: 'u1' } },
      memory: game.memory,
    }]

    expect(chapterTurnCountBeforeLatestBoundary(game, 3)).toBe(2)
  })

  it('lets an explicit chapter-end boundary override the leading status chapter', () => {
    const parsed = parseAssistantResponse('[状态] 地点：遗迹；时间：夜晚；章节：旧章；场景：延续\n[旁白] 收尾。\n[章节结束]\n[旁白] 过渡。')
    expect(reportedChapterTitle(parsed)).toBe('')
  })
})
