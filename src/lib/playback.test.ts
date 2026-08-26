import { describe, expect, it } from 'vitest'
import { completeStreamingLines, completedTurnPlaybackIndex, hasCompleteVisibleContent, isChoicePageVisible, parsePlaybackResponse, reachedChapterBoundaryStart, reconcilePlaybackIndex, resolvePlayback, resolvePlaybackContentMode, scenePresentationChanged } from './playback'

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

describe('parsePlaybackResponse', () => {
  const context = {
    characters: [
      { id: 'player', name: '亚瑟', role: 'player' as const, portraits: [] },
      { id: 'npc-a', name: '角色A', role: 'npc' as const },
    ],
  }

  it('uses the same dialogue grammar while streaming and after completion', () => {
    const raw = [
      '角色A（平静）：第一句。',
      '亚瑟：中间一句。',
      '角色A（平静）：第三句。',
      '[选项A] 继续',
    ].join('\n')
    const streaming = parsePlaybackResponse(`${raw}\n`, context)
    const completed = parsePlaybackResponse(raw, context, true)

    expect(streaming.segments).toEqual(completed.segments)
    expect(streaming.segments.map((segment) => segment.type === 'dialogue' ? segment.characterId : '')).toEqual([
      'npc-a', 'player', 'npc-a',
    ])
  })

  it('commits complete raw lines immediately and holds only the unfinished tail', () => {
    const raw = '角色A（平静）：第一句。\n亚瑟：完整台词。\n角色A（平静）：尚未'
    const streaming = parsePlaybackResponse(raw, context)

    expect(streaming.segments.map((segment) => segment.text)).toEqual(['第一句。', '完整台词。'])
    expect(parsePlaybackResponse(raw, context, true).segments.map((segment) => segment.text))
      .toEqual(['第一句。', '完整台词。', '尚未'])
  })
})

describe('reconcilePlaybackIndex', () => {
  const narration = (text: string) => ({ type: 'narration' as const, text })

  it('keeps the same visible segment when final parsing inserts an earlier segment', () => {
    expect(reconcilePlaybackIndex(
      [narration('第一段'), narration('当前段')],
      [narration('第一段'), narration('补入段'), narration('当前段')],
      1,
    )).toBe(2)
  })

  it('uses the same occurrence when identical segments repeat', () => {
    expect(reconcilePlaybackIndex(
      [narration('重复'), narration('中间'), narration('重复')],
      [narration('新增'), narration('重复'), narration('中间'), narration('重复')],
      2,
    )).toBe(3)
  })

  it('falls back to the nearest valid index when the visible segment disappears', () => {
    expect(reconcilePlaybackIndex([narration('第一段'), narration('临时段')], [narration('第一段')], 1)).toBe(0)
  })
})

describe('choice page playback', () => {
  it('shows choices only after advancing past the final story segment', () => {
    expect(isChoicePageVisible(false, 3, 2, 2)).toBe(false)
    expect(isChoicePageVisible(false, 3, 2, 3)).toBe(true)
    expect(isChoicePageVisible(true, 3, 2, 3)).toBe(false)
  })

  it('shows a choice-only response without requiring a nonexistent story page', () => {
    expect(isChoicePageVisible(false, 0, 2, 0)).toBe(true)
  })

  it('restores completed turns to choices when available', () => {
    expect(completedTurnPlaybackIndex(3, 2)).toBe(3)
    expect(completedTurnPlaybackIndex(3, 0)).toBe(2)
    expect(completedTurnPlaybackIndex(0, 0)).toBe(0)
  })
})

describe('scene presentation changes', () => {
  const segment = (location: string, presentCharacterIds: string[], time = '早晨') => ({
    type: 'narration' as const,
    text: '正文',
    statePatch: { location, time, presentCharacterIds },
    presentCharacterIds,
  })

  it('reacts to location or cast changes but ignores time and cast order', () => {
    expect(scenePresentationChanged(segment('大厅', ['a', 'b']), segment('走廊', ['a', 'b']))).toBe(true)
    expect(scenePresentationChanged(segment('大厅', ['a']), segment('大厅', ['a', 'b']))).toBe(true)
    expect(scenePresentationChanged(segment('大厅', ['a', 'b']), segment('大厅', ['b', 'a'], '夜晚'))).toBe(false)
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
