import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, takeRecentConversationTurns } from './prompt'
import type { ChatMessage } from '../types'

describe('buildSystemPrompt', () => {
  it('appends the lightweight client-owned output protocol', () => {
    const prompt = buildSystemPrompt({
      nsfwEnabled: true,
      newStoryChoiceCount: 7,
      storyStylePrompt: '细腻文风',
      statusRulesPrompt: '记录服装和情绪，只保留当前状态。',
      nsfwScenePrompt: '成人场景偏好',
      worldSettingPrompt: '架空都市',
      characters: [{ id: 'player', role: 'player', name: '主角', gender: '男', description: '', color: '#ffffff', portraits: [] }],
      gameState: { location: '旅店', time: '夜晚', contentMode: 'normal', values: {}, presentCharacterIds: ['player'] },
      narrative: {
        chapter: { id: 'chapter-1', title: '旅店疑云', startedAtMessageId: 'a1' },
        unit: { id: 'unit-1', title: '深夜会面', startedAtMessageId: 'a1' },
      },
      memory: { chapterSummary: '', historicalSummary: '', turnsSinceUnitStart: 0 },
    }, '全局附加规则')

    expect(prompt.startsWith('# 最高等级规则\n全局附加规则\n\n# 系统规则')).toBe(true)
    expect(prompt).not.toContain('全局破限提示词')
    expect(prompt).not.toContain('软件内置且不可修改')
    expect(prompt).toContain('人物姓名（状态）：台词')
    expect(prompt).toContain('人物姓名（状态）：（内心活动）')
    expect(prompt).toContain('内心活动的文本部分必须使用全角括号包裹，不得写入旁白行')
    expect(prompt).toContain('不得用旁白直接描述角色未说出口的内心活动')
    expect(prompt.indexOf('# 系统规则')).toBeLessThan(prompt.indexOf('## 客户端输出协议'))
    expect(prompt.indexOf('## 客户端输出协议')).toBeLessThan(prompt.indexOf('## 章节规则'))
    expect(prompt.indexOf('## 章节规则')).toBeLessThan(prompt.indexOf('## 状态栏规则'))
    expect(prompt.indexOf('## 状态栏规则')).toBeLessThan(prompt.indexOf('## 剧情规则与文风'))
    expect(prompt).toContain('每轮对话结束后，你需要参考以下规则和目前参与互动角色的状态，以及故事内容，更新角色状态信息。')
    expect(prompt).toContain('[角色名]状态：状态内容')
    expect(prompt).toContain('角色状态栏严格遵照“状态栏规则”书写。')
    expect(prompt).toContain('记录服装和情绪，只保留当前状态。')
    expect(prompt).toContain('你绝对不能扮演用户扮演的角色')
    expect(prompt).toContain('不得替用户决定关键行动、想法、意图或立场')
    expect(prompt).toContain('## 偏好的 NSFW 场景\n成人场景偏好')
    expect(prompt.indexOf('## 偏好的 NSFW 场景')).toBeGreaterThan(prompt.indexOf('## 世界观与故事背景'))
    expect(prompt).not.toContain('❤')
    expect(prompt).toContain('[旁白] 叙述文字')
    expect(prompt).toContain('[选项A] 具体行动')
    expect(prompt).toContain('章节：当前活动主题')
    expect(prompt).toContain('在场人物：角色姓名列表')
    expect(prompt).toContain('- 在场人物：主角')
    expect(prompt).toContain('## 当前章节\n旅店疑云')
    expect(prompt).not.toContain('单元：深夜会面')
    expect(prompt).not.toContain('单元是围绕')
    expect(prompt).toContain('章节切换只用于划分剧情和记忆，不代表世界或人物被重置')
    expect(prompt).toContain('不得自行改写、遗忘或重新生成')
    expect(prompt).toContain('最后必须输出 4 个')
    expect(prompt).toContain('用户要求你收尾本段剧情并开启新的剧情')
    expect(prompt).toContain('进行明确的转场，并开启一段新的剧情引子，同时生成 7 个')
    expect(prompt).toContain('涵盖不同角色和不同场景、故事大方向')
    expect(prompt).toContain('依次使用 A 至 G')
    expect(prompt).toContain('普通剧情续写最后必须输出 4 个')
    expect(prompt).not.toContain('2 至 4 个')
    expect(prompt).toContain('不要输出 JSON')
    expect(prompt).not.toContain('"segments"')
  })

  it('renders characters and flattened portrait tags as markdown choices', () => {
    const prompt = buildSystemPrompt({
      nsfwEnabled: true,
      newStoryChoiceCount: 4,
      storyStylePrompt: '', statusRulesPrompt: '', nsfwScenePrompt: '', worldSettingPrompt: '',
      characters: [{
        id: 'venus', role: 'npc', name: '维纳斯', gender: '女', description: '沉着冷静', nsfwDescription: '对触碰十分敏感', statusBar: '衣着：整齐', color: '#ffffff',
        defaultPortraitIds: { normal: 'normal', nsfw: 'both' },
        portraits: [
          { id: 'both', expression: '微笑', tags: ['微笑'], groups: ['normal', 'nsfw'], uri: 'both.png' },
          { id: 'normal', expression: '严肃', tags: ['严肃', '担忧'], groups: ['normal'], uri: 'normal.png' },
        ],
      }, {
        id: 'luna', role: 'npc', name: '露娜', gender: '女', description: '', color: '#ffffff',
        portraits: [
          { id: 'happy', expression: '开心', tags: ['开心'], groups: ['normal'], uri: 'happy.png' },
          { id: 'excited', expression: '性兴奋', tags: ['性兴奋'], groups: ['nsfw'], uri: 'excited.png' },
        ],
      }],
      gameState: { location: '旅店', time: '夜晚', contentMode: 'normal', values: {} },
      narrative: { chapter: { id: 'c', title: '篇章', startedAtMessageId: 'a' }, unit: { id: 'u', title: '单元', startedAtMessageId: 'a' } },
      memory: { chapterSummary: '', historicalSummary: '', turnsSinceUnitStart: 0 },
    })

    expect(prompt).toContain('### 维纳斯')
    expect(prompt.startsWith('# 系统规则')).toBe(true)
    expect(prompt).not.toContain('# 最高等级规则')
    expect(prompt).toContain('NSFW设定：对触碰十分敏感')
    expect(prompt).toContain('状态栏：衣着：整齐')
    expect(prompt.indexOf('状态栏：衣着：整齐')).toBeLessThan(prompt.indexOf('NSFW设定：对触碰十分敏感'))
    expect(prompt).toContain('### 露娜')
    expect(prompt).toContain('常规模式状态包括：严肃、担忧、微笑、开心。')
    expect(prompt).toContain('NSFW 模式状态包括：微笑、性兴奋。')
    expect(prompt).not.toContain('常规模式下角色可选状态')
    expect(prompt).not.toContain('NSFW 模式下角色可选状态')
    expect(prompt).not.toContain('默认状态')
    expect(prompt).not.toContain('"portraits"')
    expect(prompt).not.toContain('## 偏好的 NSFW 场景')
    expect(prompt).not.toContain('## 状态栏规则')
    expect(prompt).not.toContain('[角色名]状态：状态内容')
    expect(prompt).not.toContain('角色状态栏严格遵照“状态栏规则”书写。')
    expect(prompt).not.toContain('❤')
  })

  it('removes all NSFW-specific protocol, settings, character data and portrait states when disabled', () => {
    const prompt = buildSystemPrompt({
      nsfwEnabled: false,
      newStoryChoiceCount: 4,
      storyStylePrompt: '',
      statusRulesPrompt: '',
      nsfwScenePrompt: '不应出现的场景偏好',
      worldSettingPrompt: '',
      characters: [{
        id: 'venus', role: 'npc', name: '维纳斯', gender: '女', description: '基础设定',
        nsfwDescription: '不应出现的人物设定', statusBar: '', color: '#ffffff',
        defaultPortraitIds: { normal: 'normal', nsfw: 'nsfw' },
        portraits: [
          { id: 'normal', expression: '开心', tags: ['开心'], groups: ['normal'], uri: 'normal.png' },
          { id: 'nsfw', expression: '特殊状态', tags: ['特殊状态'], groups: ['nsfw'], uri: 'nsfw.png' },
        ],
      }],
      gameState: { location: '旅店', time: '夜晚', contentMode: 'nsfw', values: {} },
      narrative: { chapter: { id: 'c', title: '', startedAtMessageId: 'a' } },
      memory: { historicalSummary: '' },
    })

    expect(prompt).not.toContain('NSFW')
    expect(prompt).not.toContain('不应出现的场景偏好')
    expect(prompt).not.toContain('不应出现的人物设定')
    expect(prompt).not.toContain('特殊状态')
    expect(prompt).not.toContain('内容模式')
    expect(prompt).not.toContain('模式允许随剧情切换')
    expect(prompt).toContain('[状态] 地点：地点名称')
    expect(prompt).toContain('状态必须从以下常规状态中选择：开心。')
  })
})

describe('takeRecentConversationTurns', () => {
  it('keeps complete recent user-assistant rounds and the current instruction', () => {
    const messages: ChatMessage[] = [
      { id: 'opening', role: 'assistant', content: '开场', createdAt: 0 },
      { id: 'u1', role: 'user', content: '一', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '一答', createdAt: 2 },
      { id: 'u2', role: 'user', content: '二', createdAt: 3 },
      { id: 'a2', role: 'assistant', content: '二答', createdAt: 4 },
      { id: 'u3', role: 'user', content: '三', createdAt: 5 },
    ]

    expect(takeRecentConversationTurns(messages, 2).map((message) => message.id)).toEqual(['u2', 'a2', 'u3'])
  })
})
