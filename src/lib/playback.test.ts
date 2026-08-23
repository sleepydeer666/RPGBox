import { describe, expect, it } from 'vitest'
import { completeStreamingLines, hasCompleteVisibleContent, reachedChapterBoundaryStart, resolvePlayback, resolvePlaybackContentMode } from './playback'

describe('resolvePlayback', () => {
  it('does not follow newly streamed segments automatically', () => {
    expect(resolvePlayback(true, [], ['第一段', '第二段', '第三段'], 0)).toMatchObject({
      index: 0,
      current: '第一段',
      canAdvance: true,
      complete: false,
    })
  })

  it('stops at the currently available streaming edge', () => {
    expect(resolvePlayback(true, [], ['第一段', '第二段'], 10)).toMatchObject({
      index: 1,
      current: '第二段',
      canAdvance: false,
    })
  })

  it('keeps the user position when streaming completes', () => {
    expect(resolvePlayback(false, ['第一段', '第二段', '第三段'], [], 1)).toMatchObject({
      index: 1,
      current: '第二段',
      canAdvance: true,
      complete: false,
    })
  })
})

describe('completeStreamingLines', () => {
  it('hides the unfinished trailing line until a line break arrives', () => {
    expect(completeStreamingLines('[状态] 模式：常规；地点：旅店；时间：夜晚；场景：延续\n维纳斯（开心）：你')).toBe('[状态] 模式：常规；地点：旅店；时间：夜晚；场景：延续\n')
    expect(completeStreamingLines('维纳斯（开心）：你好\n')).toBe('维纳斯（开心）：你好\n')
  })
})

describe('resolvePlaybackContentMode', () => {
  it('uses segment mode during playback and the final mode on the choices page', () => {
    const oldSegment = { type: 'narration' as const, text: '收尾', rpgStateId: 'battle' }
    const newSegment = { type: 'narration' as const, text: '开场', rpgStateId: 'work' }
    expect(resolvePlaybackContentMode(false, oldSegment, 'battle', 'work')).toBe('battle')
    expect(resolvePlaybackContentMode(false, newSegment, 'battle', 'work')).toBe('work')
    expect(resolvePlaybackContentMode(true, oldSegment, 'battle', 'work')).toBe('work')
  })

  it('keeps the initial mode until the choices fallback when no marker was returned', () => {
    expect(resolvePlaybackContentMode(false, { type: 'narration', text: '剧情' }, 'battle', 'work')).toBe('battle')
    expect(resolvePlaybackContentMode(true, undefined, 'battle', 'work')).toBe('work')
  })

  it('uses a manual UI override without changing the segment timeline', () => {
    const segment = { type: 'narration' as const, text: '剧情', rpgStateId: 'battle' }
    expect(resolvePlaybackContentMode(false, segment, 'battle', 'work', 'normal')).toBe('normal')
    expect(resolvePlaybackContentMode(false, segment, 'battle', 'work')).toBe('battle')
  })
})

describe('hasCompleteVisibleContent', () => {
  const context = { characters: [{ id: 'venus', name: '维纳斯' }] }

  it('accepts only complete narration or dialogue while streaming', () => {
    expect(hasCompleteVisibleContent('[旁白] 门缓缓打开。\n', context)).toBe(true)
    expect(hasCompleteVisibleContent('维纳斯（惊讶）：门开了。\n', context)).toBe(true)
    expect(hasCompleteVisibleContent('[旁白] 门缓缓打开。', context)).toBe(false)
    expect(hasCompleteVisibleContent('维纳斯（惊讶）：门开了。', context)).toBe(false)
  })

  it('does not treat protocol metadata, choices, or unformatted text as visible content', () => {
    expect(hasCompleteVisibleContent('[状态] 地点：门厅；时间：清晨\n', context)).toBe(false)
    expect(hasCompleteVisibleContent('[选项A] 推开房门（后续叙事模式：NSFW）\n', context)).toBe(false)
    expect(hasCompleteVisibleContent('[章节结束]\n', context)).toBe(false)
    expect(hasCompleteVisibleContent('我先分析一下接下来的剧情。\n', context)).toBe(false)
  })

  it('accepts a valid final line without a trailing line break after completion', () => {
    expect(hasCompleteVisibleContent('[旁白] 门缓缓打开。', context, true)).toBe(true)
    expect(hasCompleteVisibleContent('[选项A] 推开房门', context, true)).toBe(false)
  })
})

describe('reachedChapterBoundaryStart', () => {
  it('crosses a boundary only when playback enters the following content', () => {
    expect(reachedChapterBoundaryStart([2], 1, false)).toBeUndefined()
    expect(reachedChapterBoundaryStart([2], 2, false)).toBe(2)
  })

  it('crosses a trailing boundary when playback reaches post-story choices', () => {
    expect(reachedChapterBoundaryStart([2], 1, false)).toBeUndefined()
    expect(reachedChapterBoundaryStart([2], 1, true)).toBe(2)
  })
})
