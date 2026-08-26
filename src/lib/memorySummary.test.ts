import { describe, expect, it } from 'vitest'
import { buildChapterSummaryDebugRequest, buildDistantSummaryDebugRequest, CHAPTER_SUMMARY_SYSTEM_PROMPT, DISTANT_SUMMARY_SYSTEM_PROMPT, formatAdditionalMemorySummaryInstructions, formatCharacterExperienceSummaryTargets, isValidChapterSummary, isValidDistantSummary, normalizeMemorySummaryOutput } from './memorySummary'

describe('memory summary validation', () => {
  it('accepts any non-empty model body without requiring labels', () => {
    expect(isValidChapterSummary('主角与温蒂共同完成一次重要行动。')).toBe(true)
    expect(isValidChapterSummary('任意模型返回都会直接保存。')).toBe(true)
    expect(isValidDistantSummary('温蒂逐渐成为主角最信赖的伙伴之一。')).toBe(true)
  })

  it('rejects only empty responses', () => {
    expect(isValidChapterSummary('')).toBe(false)
    expect(isValidChapterSummary('   \n')).toBe(false)
    expect(isValidDistantSummary('')).toBe(false)
  })

  it('only trims surrounding whitespace before storage', () => {
    const normalized = normalizeMemorySummaryOutput('  第一段。\n第二段。  ')

    expect(normalized).toBe('第一段。\n第二段。')
    expect(isValidChapterSummary(normalized)).toBe(true)
  })

  it('adds non-empty user instructions without weakening the output protocol', () => {
    expect(formatAdditionalMemorySummaryInstructions('  优先保留人物关系变化  ')).toContain('优先保留人物关系变化')
    expect(formatAdditionalMemorySummaryInstructions('优先保留人物关系变化')).toContain('直接输出正文要求')
    expect(formatAdditionalMemorySummaryInstructions('   ')).toBe('')
  })

  it('requires named participants without restoring fixed character profiles', () => {
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).toContain('必须明确写出核心事件、重要选择和关系变化涉及的每位人物姓名')
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).toContain('不得只用“两人”“众人”“几名角色”')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).toContain('重大事件、持久关系和心态变化必须明确写出涉及的人物姓名')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).toContain('不写固定人物设定')
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).toContain('不加标题、标签、前缀')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).toContain('不加标题、标签、前缀')
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).not.toContain('本章摘要：')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).not.toContain('远期记忆：')
  })

  it('adds experience targets and player aliases to chapter summary requirements', () => {
    const text = formatCharacterExperienceSummaryTargets([{ name: '居眠鹿', role: 'player' }, { name: '维拉', role: 'npc' }])
    expect(text).toContain('- 居眠鹿（用户扮演角色')
    expect(text).toContain('“你”“我”“主角”“司令官”')
    expect(text).toContain('- 维拉')
  })

  it('builds debug requests from requirements without including summary source material', () => {
    const chapter = buildChapterSummaryDebugRequest('雨夜归途', '保留关系变化')
    const distant = buildDistantSummaryDebugRequest('保留长期承诺')
    expect(chapter).toContain('章节名称：雨夜归途')
    expect(chapter).toContain('保留关系变化')
    expect(chapter).not.toContain('本章剧情：')
    expect(chapter).not.toContain('已有的本章摘要')
    expect(distant).toContain('保留长期承诺')
    expect(distant).not.toContain('既有远期记忆：')
    expect(distant).not.toContain('移出的旧章节：')
  })
})
