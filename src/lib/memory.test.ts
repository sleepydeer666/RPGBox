import { describe, expect, it } from 'vitest'
import { clampRecentChapterLimit, closesChapter, formatRecentChapterMemories, normalizeMemoryState, partitionRecentChapterMemories } from './memory'

describe('chapter memory model', () => {
  it('migrates the legacy chapter summary into the current chapter summary', () => {
    const memory = normalizeMemoryState({ chapterSummary: '旧的当前记忆', historicalSummary: '远期' })
    expect(memory.currentChapterSummary).toBe('旧的当前记忆')
    expect(memory.recentChapters).toEqual([])
    expect(memory.recentChapterLimit).toBe(5)
    expect(memory.chapterSummaryInstructions).toBe('')
    expect(memory.distantSummaryInstructions).toBe('')
  })

  it('preserves separate chapter and distant summary instructions', () => {
    const memory = normalizeMemoryState({
      historicalSummary: '',
      chapterSummaryInstructions: '关注关系变化',
      distantSummaryInstructions: '保留长期承诺',
    })

    expect(memory.chapterSummaryInstructions).toBe('关注关系变化')
    expect(memory.distantSummaryInstructions).toBe('保留长期承诺')
  })

  it('formats completed and current chapter memories for the system prompt', () => {
    const text = formatRecentChapterMemories(normalizeMemoryState({
      currentChapterSummary: '当前事件',
      historicalSummary: '',
      recentChapters: [{ id: 'c1', title: '地下城第一层', summary: '发现机关。', completedAt: 1 }],
    }))
    expect(text).toContain('### 地下城第一层\n发现机关。')
    expect(text).toContain('### 当前章节（进行中）\n当前事件')
  })

  it('keeps failed empty chapter placeholders out of the system prompt', () => {
    const text = formatRecentChapterMemories(normalizeMemoryState({
      currentChapterSummary: '',
      historicalSummary: '',
      recentChapters: [{ id: 'failed', title: '未完成总结的章节', summary: '', completedAt: 1 }],
    }))

    expect(text).toBe('')
  })

  it('normalizes memory feature switches and character experiences', () => {
    const memory = normalizeMemoryState({ characterExperiences: { vera: '曾与主角共同脱险。' } })
    expect(memory.chapterMemoryEnabled).toBe(true)
    expect(memory.distantMemoryEnabled).toBe(true)
    expect(memory.characterExperienceEnabled).toBe(true)
    expect(memory.characterExperiences).toEqual({ vera: '曾与主角共同脱险。' })
  })

  it('clamps the configurable recent chapter count', () => {
    expect(clampRecentChapterLimit(undefined)).toBe(5)
    expect(clampRecentChapterLimit(0)).toBe(1)
    expect(clampRecentChapterLimit(50)).toBe(20)
  })

  it('moves only the oldest chapters beyond the configured limit', () => {
    const chapters = Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, title: `${index}`, summary: '', completedAt: index }))
    const partitioned = partitionRecentChapterMemories(chapters, 5)
    expect(partitioned.overflow.map((chapter) => chapter.id)).toEqual(['c0', 'c1'])
    expect(partitioned.retained.map((chapter) => chapter.id)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6'])
  })

  it('closes a named chapter only when entering another chapter or a transition', () => {
    expect(closesChapter('旅店疑云', '地下遗迹')).toBe(true)
    expect(closesChapter('旅店疑云', '')).toBe(true)
    expect(closesChapter('旅店疑云', '旅店疑云')).toBe(false)
    expect(closesChapter('旅店疑云', undefined)).toBe(false)
    expect(closesChapter('', '地下遗迹')).toBe(false)
  })
})
