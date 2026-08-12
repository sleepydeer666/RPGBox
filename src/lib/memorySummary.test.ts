import { describe, expect, it } from 'vitest'
import { isValidChapterSummary, isValidDistantSummary } from './memorySummary'

describe('memory summary validation', () => {
  it('accepts concise Chinese memory summaries', () => {
    expect(isValidChapterSummary('本章摘要：主角与温蒂共同完成一次重要行动，温蒂对主角的信赖明显加深，并约定今后继续并肩行动。')).toBe(true)
    expect(isValidDistantSummary('远期记忆：温蒂逐渐成为主角最信赖的伙伴之一。')).toBe(true)
  })

  it('rejects meta responses and formatted web output', () => {
    expect(isValidChapterSummary("Looking at your task, I'll create a web page for this chapter.")).toBe(false)
    expect(isValidChapterSummary('本章摘要：```html\n<div>错误输出</div>\n```')).toBe(false)
    expect(isValidChapterSummary('## 章节摘要\n发生了一些事情。')).toBe(false)
    expect(isValidChapterSummary('本章摘要：第一段是一段足够长的中文剧情事实摘要。\n第二段不应该被接受。')).toBe(false)
    expect(isValidDistantSummary('远期记忆：第一段记忆内容足够长。\n第二段也不应该被接受。')).toBe(false)
  })
})
