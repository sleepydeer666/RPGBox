import type { ChapterMemory, MemoryState } from '../types'

export const DEFAULT_RECENT_CHAPTER_LIMIT = 5

export function normalizeMemoryState(memory: Partial<MemoryState> | undefined): MemoryState {
  return {
    currentChapterSummary: memory?.currentChapterSummary ?? memory?.chapterSummary ?? '',
    recentChapters: memory?.recentChapters ?? [],
    recentChapterLimit: clampRecentChapterLimit(memory?.recentChapterLimit),
    historicalSummary: memory?.historicalSummary ?? '',
  }
}

export function clampRecentChapterLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RECENT_CHAPTER_LIMIT
  return Math.min(20, Math.max(1, Math.round(value as number)))
}

export function recentChapterMemories(memory: MemoryState): ChapterMemory[] {
  return memory.recentChapters ?? []
}

export function currentChapterSummary(memory: MemoryState): string {
  return memory.currentChapterSummary ?? memory.chapterSummary ?? ''
}

export function formatRecentChapterMemories(memory: MemoryState): string {
  const completed = recentChapterMemories(memory)
    .filter((chapter) => chapter.summary.trim())
    .map((chapter) => `### ${chapter.title}\n${chapter.summary}`)
    .join('\n\n')
  const current = currentChapterSummary(memory).trim()
    ? `### 当前章节（进行中）\n${currentChapterSummary(memory).trim()}`
    : ''
  return [completed, current].filter(Boolean).join('\n\n') || '暂无主记忆。'
}

export function partitionRecentChapterMemories(chapters: ChapterMemory[], limit: number | undefined) {
  const retainedCount = clampRecentChapterLimit(limit)
  const overflowCount = Math.max(0, chapters.length - retainedCount)
  return {
    overflow: chapters.slice(0, overflowCount),
    retained: chapters.slice(overflowCount),
  }
}

export function closesChapter(previousChapter: string, reportedChapter: string | undefined): boolean {
  return Boolean(previousChapter.trim())
    && reportedChapter !== undefined
    && reportedChapter.trim() !== previousChapter.trim()
}
