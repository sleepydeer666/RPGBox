import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { inspectLatestResponseCompletion, mergeContinuationResponse } from './responseCompletion'

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

  it('uses all present NPC status lines as the final marker when status rules are enabled', () => {
    const game = gameWithResponse('[状态] 地点：大厅；时间：早晨；章节：序章；场景：延续；在场人物：维纳斯、露娜\n[旁白] 门打开了。\n[选项A] 一\n[选项B] 二\n[选项C] 三\n[选项D] 四\n[选项E] 五\n[选项F] 六\n[维纳斯]状态：平静', '记录情绪')
    expect(inspectLatestResponseCompletion(game)).toMatchObject({ complete: false, missingStatusCharacterIds: ['luna'] })

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
})

describe('mergeContinuationResponse', () => {
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
