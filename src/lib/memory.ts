import type { ChapterMemory, MemoryState } from '../types'

export const DEFAULT_RECENT_CHAPTER_LIMIT = 5

export function normalizeMemoryState(memory: Partial<MemoryState> | undefined): MemoryState {
  const archivedChapters = memory?.archivedChapters ?? []
  return {
    chapterMemoryEnabled: memory?.chapterMemoryEnabled ?? true,
    distantMemoryEnabled: memory?.distantMemoryEnabled ?? true,
    characterExperienceEnabled: memory?.characterExperienceEnabled ?? true,
    currentChapterSummary: memory?.currentChapterSummary ?? memory?.chapterSummary ?? '',
    recentChapters: memory?.recentChapters ?? [],
    archivedChapters,
    pendingDistantChapterIds: memory?.pendingDistantChapterIds ?? archivedChapters.map((chapter) => chapter.id),
    recentChapterLimit: clampRecentChapterLimit(memory?.recentChapterLimit),
    historicalSummary: memory?.historicalSummary ?? '',
    chapterSummaryInstructions: memory?.chapterSummaryInstructions ?? '',
    distantSummaryInstructions: memory?.distantSummaryInstructions ?? '',
    characterExperienceInstructions: memory?.characterExperienceInstructions ?? '',
    characterExperiences: memory?.characterExperiences ?? {},
  }
}

export function clampRecentChapterLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RECENT_CHAPTER_LIMIT
  return Math.min(10, Math.max(3, Math.round(value as number)))
}

export function recentChapterMemories(memory: MemoryState): ChapterMemory[] {
  return memory.recentChapters ?? []
}

export function archivedChapterMemories(memory: MemoryState): ChapterMemory[] {
  return memory.archivedChapters ?? []
}

export function pendingDistantChapterMemories(memory: MemoryState): ChapterMemory[] {
  const pendingIds = new Set(memory.pendingDistantChapterIds ?? archivedChapterMemories(memory).map((chapter) => chapter.id))
  return archivedChapterMemories(memory).filter((chapter) => pendingIds.has(chapter.id))
}

export function mergeChapterMemories(existing: ChapterMemory[], additions: ChapterMemory[]): ChapterMemory[] {
  const byId = new Map(existing.map((chapter) => [chapter.id, chapter]))
  for (const chapter of additions) byId.set(chapter.id, chapter)
  return Array.from(byId.values())
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
  return [completed, current].filter(Boolean).join('\n\n')
}

export function characterExperience(memory: MemoryState, characterId: string): string {
  return memory.characterExperiences?.[characterId]?.trim() ?? ''
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
