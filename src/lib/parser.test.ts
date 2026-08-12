import { describe, expect, it } from 'vitest'
import { parseAssistantResponse, visibleStory } from './parser'

describe('parseAssistantResponse', () => {
  it('parses the prefixed narration, canonical player dialogue and prefixed choices', () => {
    const parsed = parseAssistantResponse('[状态] 地点：书房；模式：常规；时间：清晨；场景：延续\n[旁白] 阳光落在书桌上。\n亚瑟（平静）：我们开始吧。\n[选项A] 翻开地图\n[选项B] 询问维纳斯', {
      characters: [{ id: 'player', name: '亚瑟', role: 'player' }],
    })

    expect(parsed.segments).toEqual([
      { type: 'narration', text: '阳光落在书桌上。' },
      { type: 'dialogue', characterId: 'player', characterName: '亚瑟', expression: '平静', text: '我们开始吧。' },
    ])
    expect(parsed.choices).toEqual([{ id: 'A', text: '翻开地图' }, { id: 'B', text: '询问维纳斯' }])
    expect(parsed.gameData?.statePatch).toEqual({ contentMode: 'normal', location: '书房', time: '清晨' })
  })

  it('accepts partial status fields without inventing missing values', () => {
    const parsed = parseAssistantResponse('[状态] 地点：地下室；场景：切换\n[旁白] 石门缓缓开启。')
    expect(parsed.gameData?.statePatch).toEqual({ location: '地下室' })
    expect(parsed.sceneChanged).toBe(true)
  })

  it('extracts a named or intentionally blank chapter from the status line', () => {
    expect(parseAssistantResponse('[状态] 模式：常规；地点：遗迹；时间：上午；章节：地下城第一层；场景：延续\n[旁白] 众人继续前进。').chapterTitle).toBe('地下城第一层')
    expect(parseAssistantResponse('[状态] 模式：常规；地点：山路；时间：傍晚；章节：；场景：切换\n[旁白] 众人在返程。').chapterTitle).toBe('')
  })

  it('maps a player alias back to the configured player for malformed compatible output', () => {
    const parsed = parseAssistantResponse('你（认真）：我会处理。', {
      characters: [{ id: 'player', name: '亚瑟', role: 'player' }],
    })
    expect(parsed.segments[0]).toMatchObject({ characterId: 'player', characterName: '亚瑟' })
  })

  it('parses a bare 你： line as configured player dialogue', () => {
    const parsed = parseAssistantResponse('[旁白] 门外传来脚步声。\n你：“先不要开门。”', {
      characters: [{ id: 'player', name: '亚瑟', role: 'player' }],
    })
    expect(parsed.segments[1]).toEqual({
      type: 'dialogue', characterId: 'player', characterName: '亚瑟', expression: '', text: '“先不要开门。”',
    })
  })

  it('parses strict dialogue lines and maps configured character names', () => {
    const parsed = parseAssistantResponse('夜风掠过窗边。\n维纳斯（开心）：今晚别走。', {
      characters: [{ id: 'venus', name: '维纳斯' }],
    })

    expect(parsed.segments).toEqual([
      { type: 'narration', text: '夜风掠过窗边。' },
      { type: 'dialogue', characterId: 'venus', characterName: '维纳斯', expression: '开心', text: '今晚别走。' },
    ])
  })

  it('forces generated expressions into the active portrait group enum', () => {
    const characters = [{
      id: 'venus', name: '维纳斯', role: 'npc' as const,
      defaultPortraitIds: { normal: 'calm', nsfw: 'shy' },
      portraits: [
        { id: 'calm', expression: '平静', tags: ['平静', '认真'], groups: ['normal' as const], uri: 'calm.png' },
        { id: 'shy', expression: '羞涩', tags: ['羞涩'], groups: ['nsfw' as const], uri: 'shy.png' },
      ],
    }]

    const normal = parseAssistantResponse('[状态] 模式：常规；地点：房间；时间：夜晚；章节：测试；场景：延续\n维纳斯（慌张）：等等。', { characters })
    const nsfw = parseAssistantResponse('[状态] 模式：NSFW；地点：房间；时间：夜晚；章节：测试；场景：延续\n维纳斯（颤抖）：等等。', { characters })

    expect(normal.segments[0]).toMatchObject({ expression: '平静' })
    expect(nsfw.segments[0]).toMatchObject({ expression: '羞涩' })
  })

  it('never infers dialogue from quotation marks in prose', () => {
    const text = '维纳斯走到窗边，轻声说：“今晚别走。”随后拉上窗帘。'
    expect(parseAssistantResponse(text).segments).toEqual([{ type: 'narration', text }])
  })

  it('extracts scene state and removes scene and choice lines from story segments', () => {
    const parsed = parseAssistantResponse('钟声响起。\n[场景] 地点：钟楼；时间：深夜\nA. 登上塔顶\nB. 留在原地')

    expect(parsed.segments).toEqual([{ type: 'narration', text: '钟声响起。' }])
    expect(parsed.choices).toEqual([{ id: 'A', text: '登上塔顶' }, { id: 'B', text: '留在原地' }])
    expect(parsed.gameData?.statePatch).toEqual({ location: '钟楼', time: '深夜' })
    expect(parsed.sceneChanged).toBe(true)
  })

  it('keeps legacy game-data responses readable', () => {
    const raw = '正文\n<game-data>{"segments":[{"type":"dialogue","characterId":"venus","characterName":"维纳斯","expression":"开心","text":"欢迎。"}],"choices":[{"id":"A","text":"回应"}]}</game-data>'
    const parsed = parseAssistantResponse(raw, { characters: [{ id: 'venus', name: '维纳斯' }] })
    expect(parsed.segments[0]).toMatchObject({ type: 'dialogue', characterId: 'venus', characterName: '维纳斯' })
    expect(parsed.choices).toEqual([{ id: 'A', text: '回应' }])
  })

  it('extracts narrative boundaries without displaying them as story segments', () => {
    const parsed = parseAssistantResponse('[篇章结束]\n[篇章开始] 地下城探索\n[单元开始] 第一层入口\n众人走入遗迹。\nA. 检查墙壁')

    expect(parsed.progressEvents).toEqual([
      { type: 'chapter_end' },
      { type: 'chapter_start', title: '地下城探索' },
      { type: 'unit_start', title: '第一层入口' },
    ])
    expect(parsed.segments).toEqual([{ type: 'narration', text: '众人走入遗迹。' }])
  })

  it('parses the mandatory leading RPG state and hides it from the story', () => {
    const parsed = parseAssistantResponse('[状态] 模式：NSFW；地点：寝室；时间：深夜；场景：切换\n维纳斯（羞涩、担忧）：你确定吗？\nA. 回应她')

    expect(parsed.gameData?.statePatch).toEqual({ contentMode: 'nsfw', location: '寝室', time: '深夜' })
    expect(parsed.sceneChanged).toBe(true)
    expect(parsed.segments[0]).toMatchObject({ type: 'dialogue', expression: '羞涩、担忧' })
  })

  it('maps the reported present characters from the RPG state to character IDs', () => {
    const parsed = parseAssistantResponse('[状态] 地点：大厅；时间：夜晚；章节：测试；场景：延续；在场人物：维纳斯、主角\n[旁白] 门在身后关上。', {
      characters: [
        { id: 'player', name: '主角', role: 'player' },
        { id: 'venus', name: '维纳斯', role: 'npc' },
      ],
    })

    expect(parsed.gameData?.statePatch).toMatchObject({ presentCharacterIds: ['venus', 'player'] })
  })

  it('extracts character status lines, filters unknown names, and keeps the last update', () => {
    const parsed = parseAssistantResponse([
      '[状态] 模式：常规；地点：旅店；时间：夜晚；章节：；场景：延续',
      '[旁白] 雨声敲打着窗户。',
      '[选项A] 继续交谈',
      '[选项B] 离开旅店',
      '[选项C] 观察四周',
      '[选项D] 休息',
      '[维纳斯]状态：情绪：紧张；衣着：整齐',
      '[未知角色]状态：不应写入',
      '[维纳斯]状态：情绪：放松；衣着：整齐',
    ].join('\n'), {
      characters: [{ id: 'venus', name: '维纳斯', role: 'npc' }],
    })

    expect(parsed.characterStatusUpdates).toEqual([
      { characterId: 'venus', characterName: '维纳斯', status: '情绪：放松；衣着：整齐' },
    ])
    expect(parsed.story).not.toContain('[维纳斯]状态')
    expect(parsed.segments).toEqual([{ type: 'narration', text: '雨声敲打着窗户。' }])
  })
})

describe('visibleStory', () => {
  it('hides partial legacy machine data during streaming', () => {
    expect(visibleStory('正文\n<game-data>{"choices"')).toBe('正文')
  })
})
