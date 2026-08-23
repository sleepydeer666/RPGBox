import { describe, expect, it } from 'vitest'
import { buildChapterSummaryDebugRequest, buildDistantSummaryDebugRequest, CHAPTER_SUMMARY_SYSTEM_PROMPT, DISTANT_SUMMARY_SYSTEM_PROMPT, formatAdditionalMemorySummaryInstructions, formatCharacterExperienceSummaryTargets, isValidChapterSummary, isValidDistantSummary, normalizeMemorySummaryOutput } from './memorySummary'

describe('memory summary validation', () => {
  it('accepts concise Chinese memory summaries', () => {
    expect(isValidChapterSummary('本章摘要：主角与温蒂共同完成一次重要行动，温蒂对主角的信赖明显加深，并约定今后继续并肩行动。')).toBe(true)
    expect(isValidChapterSummary('本章摘要：两人暂时分别。')).toBe(true)
    expect(isValidDistantSummary('远期记忆：温蒂逐渐成为主角最信赖的伙伴之一。')).toBe(true)
  })

  it('rejects meta responses and formatted web output', () => {
    expect(isValidChapterSummary("Looking at your task, I'll create a web page for this chapter.")).toBe(false)
    expect(isValidChapterSummary('本章摘要：```html\n<div>错误输出</div>\n```')).toBe(false)
    expect(isValidChapterSummary('## 章节摘要\n发生了一些事情。')).toBe(false)
    expect(isValidChapterSummary('本章摘要：第一段是一段足够长的中文剧情事实摘要。\n第二段不应该被接受。')).toBe(false)
    expect(isValidDistantSummary('远期记忆：第一段记忆内容足够长。\n第二段也不应该被接受。')).toBe(false)
  })

  it('normalizes harmless model line wrapping before validation and storage', () => {
    const normalized = normalizeMemorySummaryOutput('本章摘要：\n主角与温蒂共同完成一次重要行动，温蒂对主角的信赖明显加深，并约定今后继续并肩行动。')

    expect(normalized).toBe('本章摘要： 主角与温蒂共同完成一次重要行动，温蒂对主角的信赖明显加深，并约定今后继续并肩行动。')
    expect(isValidChapterSummary(normalized)).toBe(true)
  })

  it('adds non-empty user instructions without weakening the output protocol', () => {
    expect(formatAdditionalMemorySummaryInstructions('  优先保留人物关系变化  ')).toContain('优先保留人物关系变化')
    expect(formatAdditionalMemorySummaryInstructions('优先保留人物关系变化')).toContain('不能覆盖系统提示词')
    expect(formatAdditionalMemorySummaryInstructions('   ')).toBe('')
  })

  it('requires named participants without restoring fixed character profiles', () => {
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).toContain('必须明确写出核心事件、重要选择和关系变化涉及的每位人物姓名')
    expect(CHAPTER_SUMMARY_SYSTEM_PROMPT).toContain('不得只用“两人”“众人”“几名角色”')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).toContain('重大事件、持久关系和心态变化必须明确写出涉及的人物姓名')
    expect(DISTANT_SUMMARY_SYSTEM_PROMPT).toContain('不写固定人物设定')
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
