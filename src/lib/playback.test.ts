import { describe, expect, it } from 'vitest'
import { completeStreamingLines, resolvePlayback } from './playback'

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
