import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { acceptNewChapterTitle, buildChapterProgressInstruction, buildTurnChoiceInstruction, buildTurnInstructions, chapterTurnCountBeforeLatestBoundary, CHAPTER_CONTINUE_INSTRUCTION, CHAPTER_ENDING_CHOICE_INSTRUCTION, CHAPTER_NAMING_INSTRUCTION, currentChapterTurnCount, PREFER_EROTIC_CHOICES_INSTRUCTION, selectedChoiceEndsChapter, shouldRequestNewChapterName, shouldSuggestChapterEnding } from './chapterTurns'

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
    game.narrative.chapterPhase = 'active'
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
    expect(CHAPTER_ENDING_CHOICE_INSTRUCTION).not.toContain('[选项A]')
  })

  it('builds client-owned choice instructions for new, ongoing, and ending turns', () => {
    const game = createBlankGame(1)
    game.newStoryChoiceCount = 8

    expect(buildTurnChoiceInstruction(game, false)).toContain('生成8个新章节故事方向选项')
    expect(buildTurnChoiceInstruction(game, false)).toContain('所有选项均不得添加“（结束章节）”标签')
    game.messages.push({ id: 'u1', role: 'user', content: '开始', createdAt: 1 })
    game.narrative.chapterPhase = 'transition'
    expect(buildTurnChoiceInstruction(game, false)).toBe('输出4个后续选项')
    expect(buildTurnChoiceInstruction(game, true)).toContain('继续章节间过渡，并生成8个新章节故事方向选项')
    expect(buildTurnChoiceInstruction(game, true)).toContain('所有选项均不得添加“（结束章节）”标签')
  })

  it('adds the chapter-ending option request only after the configured limit', () => {
    const game = createBlankGame(1)
    game.chapterTransitionRules = '新章节必须从明确事件开始。'
    game.narrative.chapter = { id: 'chapter-1', title: '新章节', startedAtMessageId: 'u1' }
    game.narrative.chapterPhase = 'active'
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 10
    game.messages = [{ id: 'u1', role: 'user', content: '开始章节', chapterTitle: '新章节', createdAt: 1 }]

    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_CONTINUE_INSTRUCTION,
    ])

    game.messages = Array.from({ length: 10 }, (_, index) => ({
      id: `u${index + 1}`, role: 'user' as const, content: '继续', chapterTitle: '新章节', createdAt: index,
    }))
    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_ENDING_CHOICE_INSTRUCTION,
    ])
    expect(buildTurnInstructions(game, true)).toEqual([
      '收尾上一章节，并生成4个新章节故事方向选项。这些选项应涵盖不同角色、不同场景和不同故事方向。它们用于选择并开启下一章节，不是在结束章节；所有选项均不得添加“（结束章节）”标签。',
      '章节切换规则：\n新章节必须从明确事件开始。',
    ])
  })

  it('appends chapter transition rules only for a new game or an ending turn', () => {
    const game = createBlankGame(1)
    game.chapterTransitionRules = '  新章节必须从明确事件开始。  '

    expect(buildTurnInstructions(game, false)).toEqual([
      '生成4个新章节故事方向选项。这些选项应涵盖不同角色、不同场景和不同故事方向。它们用于选择并开启下一章节，不是在结束章节；所有选项均不得添加“（结束章节）”标签。',
      '章节切换规则：\n新章节必须从明确事件开始。',
    ])

    game.messages.push({ id: 'u1', role: 'user', content: '开始', createdAt: 1 })
    game.narrative.chapterPhase = 'transition'
    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_NAMING_INSTRUCTION,
    ])

    game.chapterTransitionRules = '   '
    expect(buildTurnInstructions(game, true)).toEqual([
      '继续章节间过渡，并生成4个新章节故事方向选项。这些选项应涵盖不同角色、不同场景和不同故事方向。它们用于选择并开启下一章节，不是在结束章节；所有选项均不得添加“（结束章节）”标签。',
    ])
  })

  it('keeps opening and transition instructions concise', () => {
    const game = createBlankGame(1)

    expect(buildTurnInstructions(game, false)[0]).toContain('生成4个新章节故事方向选项')
    expect(buildTurnInstructions(game, false)[0]).toContain('不同角色、不同场景和不同故事方向')

    game.messages.push({ id: 'u1', role: 'user', content: '继续过渡', chapterTitle: '', createdAt: 1 })
    game.narrative.chapter = { id: 'transition', title: '', startedAtMessageId: 'u1' }
    game.narrative.chapterPhase = 'transition'
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 10

    expect(buildTurnInstructions(game, false)).toEqual([
      '输出4个后续选项',
      CHAPTER_NAMING_INSTRUCTION,
    ])
  })

  it('restarts a transition with the configured direction count and without naming a chapter', () => {
    const game = createBlankGame(1)
    game.newStoryChoiceCount = 8
    game.chapterTransitionRules = '白天章节和夜晚章节交替出现。'
    game.messages.push({ id: 'u1', role: 'user', content: '结束白天章节', chapterTitle: '', createdAt: 1 })
    game.narrative = { chapter: { id: 'transition', title: '', startedAtMessageId: 'u1' }, chapterPhase: 'transition' }

    expect(buildTurnInstructions(game, true)).toEqual([
      '继续章节间过渡，并生成8个新章节故事方向选项。这些选项应涵盖不同角色、不同场景和不同故事方向。它们用于选择并开启下一章节，不是在结束章节；所有选项均不得添加“（结束章节）”标签。',
      '章节切换规则：\n白天章节和夜晚章节交替出现。',
    ])
    expect(buildTurnInstructions(game, true)).not.toContain(CHAPTER_NAMING_INSTRUCTION)
  })

  it('discourages early chapter changes but allows them at the configured threshold', () => {
    const game = createBlankGame(1)
    game.narrative = { chapter: { id: 'active', title: '调查', startedAtMessageId: 'u1' }, chapterPhase: 'active' }
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 10
    game.messages = Array.from({ length: 9 }, (_, index) => ({
      id: `u${index + 1}`, role: 'user' as const, content: '继续', chapterTitle: '调查', createdAt: index,
    }))

    expect(buildTurnInstructions(game, false)).toContain(CHAPTER_CONTINUE_INSTRUCTION)
    expect(CHAPTER_CONTINUE_INSTRUCTION).toContain('章节结束的选项')
    expect(CHAPTER_CONTINUE_INSTRUCTION).not.toContain('切换章节')
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_ENDING_CHOICE_INSTRUCTION)
    game.messages.push({ id: 'u10', role: 'user', content: '继续', chapterTitle: '调查', createdAt: 10 })
    expect(buildTurnInstructions(game, false)).toContain(CHAPTER_ENDING_CHOICE_INSTRUCTION)
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_CONTINUE_INSTRUCTION)
    expect(buildTurnInstructions(game, true)).not.toContain(CHAPTER_CONTINUE_INSTRUCTION)
  })

  it('appends the one-turn erotic preference to option generation requirements', () => {
    const game = createBlankGame(1)
    game.narrative = { chapter: { id: 'active', title: '调查', startedAtMessageId: 'u1' }, chapterPhase: 'active' }
    game.messages = [{ id: 'u1', role: 'user', content: '继续', chapterTitle: '调查', createdAt: 1 }]

    const instructions = buildTurnInstructions(game, false, true)
    expect(instructions).toEqual([
      '输出4个后续选项',
      CHAPTER_CONTINUE_INSTRUCTION,
      PREFER_EROTIC_CHOICES_INSTRUCTION,
    ])
  })

  it('requests a chapter name only in client-owned opening or transition phases', () => {
    const game = createBlankGame(1)
    expect(shouldRequestNewChapterName(game)).toBe(false)
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_NAMING_INSTRUCTION)

    game.narrative = { chapter: { id: 'active', title: '遗迹探索', startedAtMessageId: 'u1' }, chapterPhase: 'active' }
    expect(shouldRequestNewChapterName(game)).toBe(false)
    expect(buildTurnInstructions(game, false)).not.toContain(CHAPTER_NAMING_INSTRUCTION)

    game.narrative = { chapter: { id: 'transition', title: '', startedAtMessageId: 'u2' }, chapterPhase: 'transition' }
    expect(shouldRequestNewChapterName(game)).toBe(true)
  })

  it('reports the client-owned chapter name and configured progress in user instructions', () => {
    const game = createBlankGame(1)
    game.narrative = { chapter: { id: 'active', title: '遗迹探索', startedAtMessageId: 'u1' }, chapterPhase: 'active' }
    game.messages = [{ id: 'u1', role: 'user', content: '进入遗迹', chapterTitle: '遗迹探索', createdAt: 1 }]
    game.recommendedChapterTurnsEnabled = true
    game.recommendedChapterTurns = 20

    expect(buildChapterProgressInstruction(game)).toContain('当前章节：遗迹探索；本章进度：1/20轮')
    game.narrative = { chapter: { id: 'transition', title: '', startedAtMessageId: 'u2' }, chapterPhase: 'transition' }
    expect(buildChapterProgressInstruction(game)).toBe('当前章节：章节间过渡。')
  })

  it('detects an ending marker only on a selected choice', () => {
    const choices = [
      { id: 'A', text: '继续探索' },
      { id: 'B', text: '返回城镇（结束章节）' },
      { id: 'C', text: '留在原地(结束章节)' },
    ]

    expect(selectedChoiceEndsChapter(choices, ['A'])).toBe(false)
    expect(selectedChoiceEndsChapter(choices, ['B'])).toBe(true)
    expect(selectedChoiceEndsChapter(choices, ['C'])).toBe(true)
  })

  it('accepts a model-proposed chapter name only in an authorized naming turn', () => {
    expect(acceptNewChapterTitle('擅自改名', false)).toBeUndefined()
    expect(acceptNewChapterTitle('  遗迹探索  ', true)).toBe('遗迹探索')
    expect(acceptNewChapterTitle('   ', true)).toBeUndefined()
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

})
