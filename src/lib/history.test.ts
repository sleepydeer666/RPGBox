import { describe, expect, it } from 'vitest'
import { buildHistoryLines } from './history'

describe('buildHistoryLines', () => {
  it('keeps a configured character name from the strict dialogue format', () => {
    const lines = buildHistoryLines([
      { id: 'a1', role: 'assistant', content: '维纳斯（开心）：今晚别走。\nA. 留下来\nB. 离开', createdAt: 1 },
    ], undefined, [{ id: 'venus', name: '维纳斯' }])

    expect(lines).toEqual([{
      id: 'a1-0',
      type: 'dialogue',
      speaker: '维纳斯',
      characterId: 'venus',
      text: '今晚别走。',
    }])
  })

  it('marks generated dialogue from the configured player character', () => {
    const lines = buildHistoryLines([
      { id: 'a1', role: 'assistant', content: '亚瑟（认真）：我会处理。', createdAt: 1 },
    ], undefined, [{ id: 'player', name: '亚瑟', role: 'player' }])
    expect(lines[0]).toMatchObject({ speaker: '亚瑟（你）', characterId: 'player' })
  })

  it('formats narration, character dialogue and player actions without machine data', () => {
    const lines = buildHistoryLines([
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: '正文\n<game-data>{"segments":[{"type":"narration","text":"走入酒馆。"},{"type":"dialogue","characterId":"lia","characterName":"莉亚","expression":"smile","text":"这里适合打听情报。"}],"choices":[{"id":"A","text":"先观察酒馆四周"}]}</game-data>',
      },
      { id: 'user-1', role: 'user', createdAt: 2, content: 'A，但是先观察四周' },
    ])

    expect(lines).toEqual([
      { id: 'assistant-1-0', type: 'narration', speaker: undefined, characterId: undefined, text: '走入酒馆。' },
      { id: 'assistant-1-1', type: 'dialogue', speaker: '莉亚', characterId: 'lia', text: '这里适合打听情报。' },
      { id: 'user-1', type: 'player', speaker: '用户指令', characterId: undefined, text: '先观察酒馆四周，但是先观察四周' },
    ])
  })

  it('expands combined choices and keeps custom input unchanged', () => {
    const lines = buildHistoryLines([
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: '<game-data>{"segments":[],"choices":[{"id":"A","text":"推开房门"},{"id":"B","text":"询问莉亚"}]}</game-data>',
      },
      { id: 'user-1', role: 'user', createdAt: 2, content: 'AB' },
      { id: 'user-2', role: 'user', createdAt: 3, content: '我决定从窗户离开' },
    ])

    expect(lines.map((line) => line.text)).toEqual([
      '推开房门；询问莉亚',
      '我决定从窗户离开',
    ])
  })

  it('can omit the currently streaming assistant message', () => {
    expect(buildHistoryLines([
      { id: 'pending', role: 'assistant', createdAt: 1, content: '生成中的文字' },
    ], 'pending')).toEqual([])
  })
})
