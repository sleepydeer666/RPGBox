import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { inspectLatestResponseCompletion, mergeContinuationResponse, mergeContinuationResponseResult, responseContinuationInstruction } from './responseCompletion'

function gameWithResponse(content: string, statusRulesPrompt = '') {
  const game = createBlankGame(1)
  game.newStoryChoiceCount = 6
  game.statusRulesPrompt = statusRulesPrompt
  game.characters = [
    { id: 'player', role: 'player', name: '亚瑟', gender: '', description: '', color: '#fff', portraits: [] },
    { id: 'venus', role: 'npc', name: '维纳斯', gender: '', description: '', color: '#f00', portraits: [] },
    { id: 'luna', role: 'npc', name: '露娜', gender: '', description: '', color: '#0f0', portraits: [] },
  ]
  game.messages = [
    { id: 'u1', role: 'user', content: '开始', createdAt: 1 },
    { id: 'a1', role: 'assistant', content, createdAt: 2 },
  ]
  game.rollbackLog = [{
    id: 'r1', createdAt: 1, messageCount: 0, gameState: game.gameState,
    narrative: game.narrative, memory: game.memory,
  }]
  return game
}

describe('inspectLatestResponseCompletion', () => {
  it('treats four choices as complete even when chapter settings request more', () => {
    const game = gameWithResponse('[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯\n[旁白] 门打开了。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四')
    game.newStoryChoiceCount = 8

    expect(inspectLatestResponseCompletion(game)).toMatchObject({
      complete: true,
      hasChoices: true,
      choicesComplete: true,
      expectedChoiceCount: 4,
    })
  })

  it('does not require status lines even when status rules are enabled', () => {
    const game = gameWithResponse('[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯、露娜\n[旁白] 门打开了。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四\n[选项E] 五\n[选项F] 六\n[维纳斯]状态：平静', '记录情绪')
    expect(inspectLatestResponseCompletion(game)).toMatchObject({ complete: true, missingStatusCharacterIds: [] })

    game.messages[1].content += '\n[露娜]状态：紧张'
    expect(inspectLatestResponseCompletion(game)).toMatchObject({ complete: true, statusesComplete: true })
  })

  it('requires four choices for an ordinary turn in an existing chapter', () => {
    const game = gameWithResponse('[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯\n[旁白] 继续前进。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四')
    game.messages.unshift(
      { id: 'old-u', role: 'user', content: '上一轮', chapterTitle: '序章', createdAt: 0 },
      { id: 'old-a', role: 'assistant', content: '[旁白] 上一轮。', chapterTitle: '序章', createdAt: 0 },
    )
    game.rollbackLog = [{
      id: 'r2', createdAt: 1, messageCount: 2, gameState: game.gameState,
      narrative: { chapter: { id: 'chapter-1', title: '序章', startedAtMessageId: 'old-u' } }, memory: game.memory,
    }]

    expect(inspectLatestResponseCompletion(game)).toMatchObject({ complete: true, expectedChoiceCount: 4 })
  })

  it('does not offer continuation for an assistant message without a preceding user turn', () => {
    const game = createBlankGame(1)
    expect(inspectLatestResponseCompletion(game).canContinue).toBe(false)
  })

  it('builds a targeted continuation instruction for the missing sections', () => {
    const choicesMissing = inspectLatestResponseCompletion(gameWithResponse('[旁白] 正文。'))
    expect(responseContinuationInstruction(choicesMissing)).toContain('在剧情部分被截断')
    expect(responseContinuationInstruction(choicesMissing)).toContain('完整的A-D选项')

    const statusesMissing = inspectLatestResponseCompletion(gameWithResponse(
      '[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯\n[旁白] 正文。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四',
      '记录情绪',
    ))
    expect(responseContinuationInstruction(statusesMissing)).toBe('继续输出完整')

    const bothMissing = inspectLatestResponseCompletion(gameWithResponse(
      '[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯\n[旁白] 正文。',
      '记录情绪',
    ))
    expect(responseContinuationInstruction(bothMissing)).toContain('在剧情部分被截断')
  })

  it('requests only missing choices after the response has entered the choice section', () => {
    const completion = inspectLatestResponseCompletion(gameWithResponse(
      '[旁白] 正文。\n[选项A] 前进\n[选项B] 留在原地\n[选项C] 调查',
    ))

    expect(completion).toMatchObject({ choiceSectionStarted: true, missingChoiceIds: ['D'] })
    expect(responseContinuationInstruction(completion)).toContain('在选项部分被截断')
    expect(responseContinuationInstruction(completion)).toContain('缺失的选项（D）')
    expect(responseContinuationInstruction(completion)).toContain('不要重复已完整输出的剧情或选项')
  })

  it('recognizes a truncated first option as the start of the choice section', () => {
    const completion = inspectLatestResponseCompletion(gameWithResponse('[旁白] 正文。\n[选项A'))

    expect(completion.choiceSectionStarted).toBe(true)
    expect(completion.missingChoiceIds).toEqual(['A', 'B', 'C', 'D'])
    expect(responseContinuationInstruction(completion)).toContain('若最后一行是不完整选项')
  })

  it('does not request status updates when status rules are disabled', () => {
    const game = gameWithResponse('[旁白] 正文。')
    game.gameState.presentCharacterIds = ['venus']

    const completion = inspectLatestResponseCompletion(game)
    expect(completion.statusesComplete).toBe(true)
    expect(responseContinuationInstruction(completion)).toContain('在剧情部分被截断')
  })

  it('does not require status updates during a chapter transition', () => {
    const game = gameWithResponse(
      '[状态] 地点：大厅；时间：早晨；章节：；场景：切换；在场人物：维纳斯\n[旁白] 新的旅程即将开始。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四',
      '记录情绪',
    )
    game.narrative.chapterPhase = 'transition'

    expect(inspectLatestResponseCompletion(game)).toMatchObject({
      complete: true,
      choicesComplete: true,
      statusesComplete: true,
      missingStatusCharacterIds: [],
    })
  })
})

describe('mergeContinuationResponse', () => {
  it('replaces an exact duplicated line and everything after it', () => {
    const result = mergeContinuationResponseResult(
      '[旁白] 第一行\n[旁白] 第二行\n[旁白] 第三行的一半',
      '[旁白] 第二行\n[旁白] 第三行完整\n[旁白] 第四行',
    )

    expect(result).toEqual({
      text: '[旁白] 第一行\n[旁白] 第二行\n[旁白] 第三行完整\n[旁白] 第四行',
      aligned: true,
      spliceOffset: '[旁白] 第一行\n'.length,
    })
  })

  it('replaces a truncated final line when it prefixes the first complete continuation line', () => {
    const result = mergeContinuationResponseResult(
      '[旁白] 第一行\n[旁白] 被截断',
      '[旁白] 被截断的句子已经完整\n[旁白] 下一行',
    )

    expect(result.text).toBe('[旁白] 第一行\n[旁白] 被截断的句子已经完整\n[旁白] 下一行')
    expect(result.spliceOffset).toBe('[旁白] 第一行\n'.length)
  })

  it('uses an earlier old line as a prefix match while searching backward', () => {
    const result = mergeContinuationResponseResult(
      '[旁白] 第一行\n[旁白] 旧行前缀\n[旁白] 后续残句',
      '[旁白] 旧行前缀和补全内容\n[旁白] 新结尾',
    )

    expect(result.text).toBe('[旁白] 第一行\n[旁白] 旧行前缀和补全内容\n[旁白] 新结尾')
  })

  it('chooses the nearest duplicated line when the old response contains several matches', () => {
    const original = '[旁白] 重复\n[旁白] 中间\n[旁白] 重复\n[旁白] 末尾残句'
    const result = mergeContinuationResponseResult(original, '[旁白] 重复\n[旁白] 新内容')

    expect(result.text).toBe('[旁白] 重复\n[旁白] 中间\n[旁白] 重复\n[旁白] 新内容')
    expect(result.spliceOffset).toBe(original.lastIndexOf('[旁白] 重复'))
  })

  it('waits for the first complete continuation line before aligning', () => {
    expect(mergeContinuationResponseResult('[旁白] 原文', '[旁白] 原文')).toEqual({
      text: '[旁白] 原文',
      aligned: false,
    })
  })

  it('aligns a final continuation line even without a trailing line break', () => {
    expect(mergeContinuationResponseResult('[旁白] 第一行\n[旁白] 第二', '[旁白] 第二行完整', { final: true })).toEqual({
      text: '[旁白] 第一行\n[旁白] 第二行完整',
      aligned: true,
      spliceOffset: '[旁白] 第一行\n'.length,
    })
  })

  it('falls back to the existing merge behavior when no complete line matches', () => {
    expect(mergeContinuationResponseResult('[旁白] 原文。', '[旁白] 新内容\n[选项A] 前进')).toEqual({
      text: '[旁白] 原文。\n[旁白] 新内容\n[选项A] 前进',
      aligned: false,
    })
  })

  it('keeps using a locked splice offset for later streaming updates', () => {
    const original = '[旁白] 第一行\n[旁白] 第二行\n[旁白] 残句'
    const first = mergeContinuationResponseResult(original, '[旁白] 第二行\n[旁白] 新')
    const later = mergeContinuationResponseResult(original, '[旁白] 第二行\n[旁白] 新内容\n[选项A] 前进', {
      spliceOffset: first.spliceOffset,
    })

    expect(later.spliceOffset).toBe(first.spliceOffset)
    expect(later.text).toBe('[旁白] 第一行\n[旁白] 第二行\n[旁白] 新内容\n[选项A] 前进')
  })

  it('removes the longest repeated boundary before appending', () => {
    expect(mergeContinuationResponse(
      '[旁白] 门缓缓打开。\n[选项A] 进入房',
      '[选项A] 进入房间\n[选项B] 留在原地',
    )).toBe('[旁白] 门缓缓打开。\n[选项A] 进入房间\n[选项B] 留在原地')
  })

  it('adds a line break when the continuation has no overlap', () => {
    expect(mergeContinuationResponse('[旁白] 门打开了。', '[选项A] 进入')).toBe('[旁白] 门打开了。\n[选项A] 进入')
  })

  it('directly joins a continuation that resumes an incomplete protocol line', () => {
    expect(mergeContinuationResponse('[选项A] 进入房', '间查看\n[选项B] 留在原地'))
      .toBe('[选项A] 进入房间查看\n[选项B] 留在原地')
  })
})
