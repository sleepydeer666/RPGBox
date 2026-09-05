import { describe, expect, it } from 'vitest'
import { buildFormatRepairApiMessages, buildLlmSpecialInstructionText, buildRpgTurnApiMessages, buildRpgTurnDebugSegments, buildSystemPrompt, buildTurnCharacterProfiles, buildTurnNarrativeContext, buildTurnNarrativeStyle, buildTurnOutputContract, buildTurnRequestContent, buildTurnRequestDebugContent, FORMAT_REPAIR_INSTRUCTION, normalizeAssistantMessageForContext, PORTRAIT_TAG_REPAIR_INSTRUCTION, takeRecentConversationTurns, toApiMessages } from './prompt'
import type { ChatMessage } from '../types'

describe('buildFormatRepairApiMessages', () => {
  it('keeps the original rules and only the malformed response as conversation context', () => {
    const messages = buildFormatRepairApiMessages([
      { title: '固定系统规则', role: 'system', content: '固定规则' },
      { title: '历史用户输入', role: 'user', content: '旧行动' },
      { title: '历史剧情回复', role: 'assistant', content: '旧剧情' },
      { title: '本轮叙事上下文与人物设定', role: 'system', content: '动态规则' },
      { title: '本轮玩家输入', role: 'user', content: '向前走' },
      { title: '本轮输出契约', role: 'system', content: '格式规则' },
    ], '向前走', '错误格式原文')

    expect(messages).toEqual([
      { role: 'system', content: '固定规则' },
      { role: 'system', content: '动态规则' },
      { role: 'system', content: '格式规则' },
      { role: 'assistant', content: '错误格式原文' },
      { role: 'user', content: FORMAT_REPAIR_INSTRUCTION },
    ])
    expect(FORMAT_REPAIR_INSTRUCTION).toContain('不要输出任何思维过程')
    expect(FORMAT_REPAIR_INSTRUCTION).toContain('不要改变原文的故事内容')
    expect(FORMAT_REPAIR_INSTRUCTION).toContain('只检查并修复标签和各种格式问题')
  })

  it('removes the original player input from a compatible-format rule block', () => {
    const messages = buildFormatRepairApiMessages([
      { title: '固定系统规则', role: 'system', content: '固定规则' },
      { title: '本轮玩家输入与动态规则（兼容格式）', role: 'user', content: '向前走\n\n动态规则\n\n格式规则' },
    ], '向前走', '错误格式原文')

    expect(messages.at(1)).toEqual({ role: 'user', content: '动态规则\n\n格式规则' })
    expect(messages.some((message) => message.content === '向前走')).toBe(false)
  })

  it('uses the portrait-tag repair instruction without restoring conversation history', () => {
    const messages = buildFormatRepairApiMessages([
      { title: '固定系统规则', role: 'system', content: '固定规则' },
      { title: '历史剧情回复', role: 'assistant', content: '旧剧情' },
      { title: '本轮输出契约', role: 'system', content: '立绘标签规则' },
    ], '向前走', '缺少立绘标签的原文', PORTRAIT_TAG_REPAIR_INSTRUCTION)

    expect(messages).toEqual([
      { role: 'system', content: '固定规则' },
      { role: 'system', content: '立绘标签规则' },
      { role: 'assistant', content: '缺少立绘标签的原文' },
      { role: 'user', content: PORTRAIT_TAG_REPAIR_INSTRUCTION },
    ])
  })
})

describe('buildSystemPrompt', () => {
  it('keeps only stable client-owned rules and settings in the system prompt', () => {
    const prompt = buildSystemPrompt({
      newStoryChoiceCount: 7,
      chapterTransitionRules: '新章节必须从明确事件开始。',
      narrativeModeRulesPrompt: '日常章节保持正常模式。',
      statusRulesPrompt: '记录服装和情绪，只保留当前状态。',
      nsfwScenePrompt: '成人场景偏好',
      storyStylePrompt: '全局使用第二人称叙事。',
      modeStoryStylePrompts: { normal: '正常模式节奏舒缓。', nsfw: '成人模式加强感官描写。' },
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
    expect(prompt).not.toContain('人物姓名（状态）：台词')
    expect(prompt).not.toContain('## 客户端协议护栏')
    expect(prompt).not.toContain('## 章节规则')
    expect(prompt.indexOf('# 系统规则')).toBeLessThan(prompt.indexOf('## 角色状态栏规则'))
    expect(prompt).not.toContain('### 章节切换规则')
    expect(prompt).not.toContain('新章节必须从明确事件开始。')
    expect(prompt.indexOf('## 角色状态栏规则')).toBeLessThan(prompt.indexOf('## 世界观与故事背景'))
    expect(prompt).not.toContain('## 剧情规则与文风')
    expect(prompt).toContain('只根据剧情更新本轮参与互动的角色。')
    expect(prompt).not.toContain('[角色名]状态：状态内容')
    expect(prompt).toContain('记录服装和情绪，只保留当前状态。')
    expect(prompt).toContain('标记为“用户扮演”的角色完全由用户控制')
    expect(prompt).toContain('不得替其选择行动、决定关键想法、意图或立场')
    expect(prompt).toContain('在旁白中，必须使用第二人称“你”指代用户控制的主角')
    expect(prompt.indexOf('在旁白中，必须使用第二人称“你”指代用户控制的主角')).toBeLessThan(prompt.indexOf('输出必须严格遵守最新用户消息末尾'))
    expect(prompt).toContain('## 偏好的 NSFW 场景\n成人场景偏好')
    expect(prompt).toContain('## 本轮叙事风格设定\n全局使用第二人称叙事。\n正常模式节奏舒缓。')
    expect(prompt).not.toContain('成人模式加强感官描写。')
    expect(prompt).toContain('## 叙事模式切换规则\n日常章节保持正常模式。')
    expect(prompt.indexOf('## 偏好的 NSFW 场景')).toBeGreaterThan(prompt.indexOf('## 世界观与故事背景'))
    expect(prompt.indexOf('## 本轮叙事风格设定')).toBeGreaterThan(prompt.indexOf('## 偏好的 NSFW 场景'))
    expect(prompt.indexOf('## 本轮叙事风格设定')).toBeLessThan(prompt.indexOf('## 叙事模式切换规则'))
    expect(prompt).not.toContain('❤')
    expect(prompt).not.toContain('[旁白] 叙述文字')
    expect(prompt).not.toContain('2. 新章节名称')
    expect(prompt).not.toContain('未被本轮契约允许的控制行')
    expect(prompt).not.toContain('[选项A] 具体行动')
    expect(prompt).not.toContain('章节：当前活动主题')
    expect(prompt).not.toContain('在场人物：角色姓名列表')
    expect(prompt).not.toContain('场景：延续')
    expect(prompt).not.toContain('场景”写“切换')
    expect(prompt).not.toContain('## 当前场景信息')
    expect(prompt).not.toContain('- 在场人物：主角')
    expect(prompt).not.toContain('- 地点：旅店')
    expect(prompt).not.toContain('- 时间：夜晚')
    expect(prompt).not.toContain('## 当前章节')
    expect(prompt).not.toContain('单元：深夜会面')
    expect(prompt).not.toContain('单元是围绕')
    expect(prompt).toContain('章节变化不重置人物、世界、角色状态栏、历史事件或既有事实')
    expect(prompt).toContain('章节由客户端管理')
    expect(prompt).not.toContain('[篇章开始]')
    expect(prompt).not.toContain('[篇章结束]')
    expect(prompt).not.toContain('[单元开始]')
    expect(prompt).not.toContain('最后必须输出 4 个')
    expect(prompt).not.toContain('本轮用户指令要求结束本章节并开启新章节')
    expect(prompt).not.toContain('游戏首次开始时')
    expect(prompt).not.toContain('需要建立新的剧情引子')
    expect(prompt).not.toContain('涵盖不同角色、不同场景和不同故事大方向')
    expect(prompt).not.toContain('依次使用 A 至 G')
    expect(prompt).not.toContain('普通剧情续写最后必须输出 4 个')
    expect(prompt).not.toContain('生成 7 个')
    expect(prompt).not.toContain('2 至 4 个')
    expect(prompt).not.toContain('不得输出 JSON')
    expect(prompt).not.toContain('"segments"')
  })

  it('keeps dynamic character profiles out of the system prompt', () => {
    const prompt = buildSystemPrompt({
      newStoryChoiceCount: 4,
      statusRulesPrompt: '', nsfwScenePrompt: '', storyStylePrompt: '', modeStoryStylePrompts: {}, worldSettingPrompt: '',
      characters: [{
        id: 'venus', role: 'npc', name: '维纳斯', gender: '女', description: '沉着冷静', modeDescriptions: { nsfw: '对触碰十分敏感' }, statusBar: '衣着：整齐', color: '#ffffff',
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

    expect(prompt).not.toContain('### 维纳斯')
    expect(prompt.startsWith('# 系统规则')).toBe(true)
    expect(prompt).not.toContain('# 最高等级规则')
    expect(prompt).not.toContain('NSFW设定：对触碰十分敏感')
    expect(prompt).not.toContain('角色状态栏：衣着：整齐')
    expect(prompt).not.toContain('### 露娜')
    expect(prompt).toContain('系统提示词中的叙事风格设定（如有）和最新用户消息中的“本轮相关人物设定”是本轮权威资料')
    expect(prompt).not.toContain('常规模式状态包括：严肃、担忧、微笑、开心。')
    expect(prompt).not.toContain('NSFW 模式状态包括：微笑、性兴奋。')
    expect(prompt).not.toContain('常规模式下角色可选状态')
    expect(prompt).not.toContain('NSFW 模式下角色可选状态')
    expect(prompt).not.toContain('默认状态')
    expect(prompt).not.toContain('"portraits"')
    expect(prompt).not.toContain('## 偏好的 NSFW 场景')
    expect(prompt).not.toContain('## 角色状态栏规则')
    expect(prompt).not.toContain('## 世界观与故事背景')
    expect(prompt).not.toContain('## 本轮叙事风格设定')
    expect(prompt).not.toContain('## 叙事模式切换规则')
    expect(prompt).not.toContain('暂无额外设定')
    expect(prompt).not.toContain('[角色名]状态：状态内容')
    expect(prompt).not.toContain('角色状态栏严格遵照“状态栏规则”书写。')
    expect(prompt).not.toContain('❤')
  })

  it('keeps configured NSFW preferences available without a separate enable switch', () => {
    const prompt = buildSystemPrompt({
      newStoryChoiceCount: 4,
      statusRulesPrompt: '',
      nsfwScenePrompt: '不应出现的场景偏好',
      storyStylePrompt: '全局叙事设定',
      modeStoryStylePrompts: { normal: '正常模式风格', nsfw: '成人模式风格' },
      worldSettingPrompt: '',
      characters: [{
        id: 'venus', role: 'npc', name: '维纳斯', gender: '女', description: '基础设定',
        modeDescriptions: { nsfw: '不应出现的人物设定' }, statusBar: '', color: '#ffffff',
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

    expect(prompt).toContain('## 偏好的 NSFW 场景')
    expect(prompt).toContain('不应出现的场景偏好')
    expect(prompt).toContain('## 本轮叙事风格设定\n全局叙事设定\n成人模式风格')
    expect(prompt).not.toContain('正常模式风格')
    expect(prompt).not.toContain('不应出现的人物设定')
    expect(prompt).not.toContain('特殊状态')
    expect(prompt).not.toContain('内容模式')
    expect(prompt).not.toContain('模式允许随剧情切换')
    expect(prompt).not.toContain('[状态] 地点：地点名称')
    expect(prompt).not.toContain('状态必须从以下常规状态中选择：开心。')
  })
})

describe('assistant context normalization', () => {
  const characters = [{
    id: 'npc-1',
    role: 'npc' as const,
    name: '莉亚',
    gender: '女',
    description: '',
    color: '#ffffff',
    portraits: [
      { id: 'normal-default', expression: '平静', tags: ['平静', '认真'], uri: 'normal.png', groups: ['normal' as const] },
      { id: 'nsfw-default', expression: '迷乱', tags: ['迷乱'], uri: 'nsfw.png', groups: ['nsfw' as const] },
    ],
    defaultPortraitIds: { normal: 'normal-default', nsfw: 'nsfw-default' },
  }, {
    id: 'npc-2', role: 'npc' as const, name: '守卫', gender: '男', description: '', color: '#fff', portraits: [],
  }]

  it('replaces an out-of-list dialogue state only in the API context copy', () => {
    const original = '[状态] 模式：常规；地点：旅店\n莉亚（开心）：晚上好。\n莉亚（认真）：请小心。'
    const normalized = normalizeAssistantMessageForContext(original, characters, 'normal')

    expect(normalized).toContain('莉亚（平静）：晚上好。')
    expect(normalized).toContain('莉亚（认真）：请小心。')
    expect(original).toContain('莉亚（开心）：晚上好。')
  })

  it('uses the client-owned message state and strips legacy state controls from API context', () => {
    const normalized = normalizeAssistantMessageForContext(
      '[状态] 模式：NSFW；地点：旅店；时间：夜晚；章节：旧章；场景：延续\n[章节结束]\n[新章节] 擅自命名\n莉亚（陶醉）：别停。',
      characters,
      'normal',
    )

    expect(normalized).toContain('[状态] 地点：旅店；时间：夜晚')
    expect(normalized).toContain('莉亚（平静）：别停。')
    expect(normalized).not.toContain('模式：')
    expect(normalized).not.toContain('章节：')
    expect(normalized).not.toContain('[章节结束]')
    expect(normalized).not.toContain('[新章节]')
  })

  it('normalizes missing-mode portraits to the reserved no-portrait tag', () => {
    const normalized = normalizeAssistantMessageForContext('守卫（惊讶）：站住。', [{
      id: 'guard', role: 'npc', name: '守卫', gender: '男', description: '', color: '#fff', portraits: [],
    }], 'normal')
    expect(normalized).toBe('守卫（无）：站住。')
  })

  it('normalizes historical portrait tags with the mode active around the switch marker', () => {
    const normalized = normalizeAssistantMessageForContext(
      '莉亚（开心）：任务结束。\n[叙事模式切换] NSFW\n莉亚（陶醉）：别停。',
      characters,
      'nsfw',
      'normal',
    )
    expect(normalized).toContain('莉亚（平静）：任务结束。')
    expect(normalized).toContain('[叙事模式切换] NSFW')
    expect(normalized).toContain('莉亚（迷乱）：别停。')
  })
})

describe('turn output contract', () => {
  const characters = [{
    id: 'npc-1', role: 'npc' as const, name: '莉亚', gender: '女', description: '', color: '#fff',
    portraits: [
      { id: 'normal', expression: '平静', tags: ['平静', '微笑'], uri: 'normal.png', groups: ['normal' as const] },
      { id: 'nsfw', expression: '迷乱', tags: ['迷乱'], uri: 'nsfw.png', groups: ['nsfw' as const] },
    ],
  }, {
    id: 'npc-2', role: 'npc' as const, name: '守卫', gender: '男', description: '', color: '#fff', portraits: [],
  }]

  it('puts dynamic line formats, portrait tags, choices and status bars in the turn contract', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '记录服装。',
      gameState: { location: '', time: '', contentMode: 'normal', values: {} },
    })

    expect(contract.startsWith('【本轮输出契约】')).toBe(true)
    expect(contract).toContain('[状态] 地点：地点；时间：时间；在场人物：姓名列表')
    expect(contract).toContain('角色名（立绘标签）：台词')
    expect(contract).toContain('（后续叙事模式：正常）')
    expect(contract).toContain('（后续叙事模式：NSFW）')
    expect(contract).toContain('在后续叙事模式标签之后追加“（结束章节）”')
    expect(contract).toContain('[角色名]状态：状态内容')
    expect(contract).toContain('本轮可用角色立绘（叙事模式：正常）')
    expect(contract).toContain('- 莉亚：平静、微笑')
    expect(contract).toContain('- 守卫：无')
    expect(contract).not.toContain('- 莉亚：迷乱')
    expect(contract).toContain('如果角色的本轮可用立绘为“无”，必须改用“角色名：台词”')
    expect(contract).toContain('不得把“无”写成立绘标签')
    expect(contract).toContain('第一行必须输出完整“[状态] 地点：地点；时间：时间；在场人物：姓名列表”')
    expect(contract).toContain('地点、时间或在场人物发生变化')
    expect(contract).toContain('在变化生效处、后续剧情之前再次输出一行完整[状态]')
    expect(contract).toContain('作用于其后的内容')
  })

  it('omits status-bar formats when status rules are empty', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '',
      gameState: { location: '', time: '', contentMode: 'nsfw', values: {} },
    })
    expect(contract).toContain('（后续叙事模式：NSFW）')
    expect(contract).not.toContain('[角色名]状态')
    expect(contract).toContain('选项之后不得继续输出剧情或解释')
    expect(contract).toContain('叙事模式：NSFW')
  })

  it('forbids chapter-end markers on chapter transition direction choices', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '',
      gameState: { location: '', time: '', contentMode: 'normal', values: {} },
    }, 'normal', true, false, true)

    expect(contract).toContain('用于选择并开启下一章节的故事方向')
    expect(contract).toContain('所有选项均不得追加“（结束章节）”标签')
    expect(contract).not.toContain('结束章节时在后续叙事模式标签之后追加')
  })

  it('uses a continuation contract that does not request the beginning of the turn again', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '',
      gameState: { location: '', time: '', contentMode: 'normal', values: {} },
    }, 'normal', false, true)

    expect(contract).toContain('这是上一条回复的续写')
    expect(contract).toContain('不得重新输出本轮开头的[状态]')
    expect(contract).toContain('不得重复已完成剧情或已完成选项')
    expect(contract).toContain('如果续写剧情使地点、时间或在场人物发生变化')
    expect(contract).not.toContain('按顺序输出：[状态]')
  })

  it('sends only portrait tags for the client-owned current narrative mode', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '',
      gameState: { location: '', time: '', contentMode: 'nsfw', values: {} },
    })
    expect(contract).toContain('本轮可用角色立绘（叙事模式：NSFW）')
    expect(contract).toContain('- 莉亚：迷乱')
    expect(contract).not.toContain('- 莉亚：平静、微笑')
  })

  it('injects non-empty character experiences only when the feature is enabled', () => {
    const character = { ...characters[0], id: 'vera', name: '维拉' }
    const enabled = buildTurnCharacterProfiles([character], 'normal', 'normal', undefined, { vera: '与居眠鹿共同脱险。' }, true)
    expect(enabled).toContain('- 角色经历：与居眠鹿共同脱险。')
    const disabled = buildTurnCharacterProfiles([character], 'normal', 'normal', undefined, { vera: '与居眠鹿共同脱险。' }, false)
    expect(disabled).not.toContain('角色经历')
    const empty = buildTurnCharacterProfiles([character], 'normal', 'normal', undefined, {}, true)
    expect(empty).not.toContain('角色经历：')
  })

  it('requires one explicit switch and provides both portrait sets when the mode changes', () => {
    const contract = buildTurnOutputContract({
      characters,
      statusRulesPrompt: '',
      gameState: { location: '', time: '', contentMode: 'nsfw', values: {} },
    }, 'normal')

    expect(contract).toContain('本轮开始时继续使用“正常”叙事模式')
    expect(contract).toContain('[叙事模式切换] NSFW')
    expect(contract).toContain('必须单独输出且只能输出一次')
    expect(contract).toContain('本轮可用角色立绘（叙事模式：正常）')
    expect(contract).toContain('本轮可用角色立绘（叙事模式：NSFW）')
    expect(contract).toContain('- 莉亚：平静、微笑')
    expect(contract).toContain('- 莉亚：迷乱')
  })

  it('sends stored user actions instead of historical request contracts', () => {
    const messages: ChatMessage[] = [{
      id: 'u1', role: 'user', content: 'B，但是先观察四周',
      requestContent: 'B\n\n【本轮相关人物设定】\n### 莉亚\n- 人物设定：旧人物资料\n\n【本轮输出契约】旧契约', createdAt: 1,
    }]
    const apiMessages = toApiMessages('系统', messages)
    expect(apiMessages[1].content).toBe('B，但是先观察四周')
    expect(apiMessages[1].content).not.toContain('旧契约')
    expect(apiMessages[1].content).not.toContain('旧人物资料')
  })

  it('keeps injected user instructions before the final output contract', () => {
    const request = buildTurnRequestContent({
      input: 'B',
      context: '【本轮叙事上下文】\n当前叙事模式：正常\n当前章节：遗迹',
      characters: '【本轮相关人物设定】\n莉亚',
      special: '篇幅加长到2倍',
      turn: '输出4个后续选项',
      contract: '【本轮输出契约】\n契约内容',
    })
    expect(request).toContain('篇幅加长到2倍')
    expect(request).toContain('【本轮相关人物设定】\n莉亚')
    expect(request.indexOf('篇幅加长到2倍')).toBeLessThan(request.indexOf('【本轮输出契约】'))
    expect(request.endsWith('【本轮输出契约】\n契约内容')).toBe(true)
  })

  it('moves scene state into the latest turn narrative context', () => {
    const context = buildTurnNarrativeContext({
      characters: [{ id: 'player', role: 'player', name: '主角', gender: '', description: '', color: '#fff', portraits: [] }],
      gameState: {
        location: '旧城区旅店', time: '深夜', contentMode: 'normal',
        presentCharacterIds: ['player'], values: { 天气: '暴雨' },
      },
    }, '当前叙事模式：正常', '当前章节：雨夜来客；本章进度：6/20轮。')

    expect(context).toContain('【本轮叙事上下文】')
    expect(context).toContain('当前叙事模式：正常')
    expect(context).toContain('当前章节：雨夜来客；本章进度：6/20轮。')
    expect(context).toContain('- 当前地点：旧城区旅店')
    expect(context).toContain('- 当前时间：深夜')
    expect(context).toContain('- 当前在场人物：主角')
    expect(context).toContain('- 天气：暴雨')
  })

  it('injects only the current narrative mode special settings for selected profiles', () => {
    const profiles = buildTurnCharacterProfiles([{
      id: 'npc-1', role: 'npc', name: '莉亚', gender: '女', description: '沉着冷静',
      modeDescriptions: { normal: '日常状态设定', nsfw: '成人状态设定' }, statusBar: '衣着：整齐', color: '#fff', portraits: [],
    }], 'normal')
    expect(profiles).toContain('### 莉亚')
    expect(profiles).toContain('人物设定：沉着冷静\n  日常状态设定')
    expect(profiles).toContain('角色状态栏：衣着：整齐')
    expect(profiles.indexOf('日常状态设定')).toBeLessThan(profiles.indexOf('角色状态栏：衣着：整齐'))
    expect(profiles).not.toContain('特殊设定')
    expect(profiles).not.toContain('成人状态设定')

    const nsfwProfiles = buildTurnCharacterProfiles([{
      id: 'npc-1', role: 'npc', name: '莉亚', gender: '女', description: '沉着冷静',
      modeDescriptions: { nsfw: '成人状态设定' }, statusBar: '衣着：凌乱', color: '#fff', portraits: [],
    }], 'nsfw')
    expect(nsfwProfiles).toContain('角色状态栏：衣着：凌乱')
    expect(nsfwProfiles).toContain('人物设定：沉着冷静\n  成人状态设定')
    expect(nsfwProfiles).not.toContain('特殊设定')
  })

  it('provides both mode-specific profiles and styles for a delayed switch', () => {
    const character = {
      id: 'npc-1', role: 'npc' as const, name: '莉亚', gender: '女', description: '沉着冷静',
      modeDescriptions: { normal: '日常状态设定', nsfw: '成人状态设定' }, color: '#fff', portraits: [],
    }
    const profiles = buildTurnCharacterProfiles([character], 'nsfw', 'normal')
    expect(profiles).toContain('## 切换前叙事模式（正常）人物设定')
    expect(profiles).toContain('## 切换后叙事模式（NSFW）人物设定')
    expect(profiles).toContain('日常状态设定')
    expect(profiles).toContain('成人状态设定')

    const style = buildTurnNarrativeStyle({
      storyStylePrompt: '第二人称。',
      modeStoryStylePrompts: { normal: '日常风格。', nsfw: '成人风格。' },
    }, 'nsfw', 'normal')
    expect(style).toContain('### 切换前叙事模式（正常）\n日常风格。')
    expect(style).toContain('### 切换后叙事模式（NSFW）\n成人风格。')
  })

  it('does not inject empty character fields or empty mode-specific style sections', () => {
    const profiles = buildTurnCharacterProfiles([{
      id: 'npc-1', role: 'npc', name: '莉亚', gender: '', description: '', modeDescriptions: { normal: '' }, color: '#fff', portraits: [],
    }], 'normal')
    expect(profiles).toContain('### 莉亚\n- 身份：NPC')
    expect(profiles).not.toContain('性别：')
    expect(profiles).not.toContain('人物设定：')
    expect(profiles).not.toContain('未设定')
    expect(profiles).not.toContain('暂无额外设定')

    expect(buildTurnNarrativeStyle({
      storyStylePrompt: '',
      modeStoryStylePrompts: { normal: '', nsfw: '成人风格。' },
    }, 'normal')).toBe('')

    const delayedStyle = buildTurnNarrativeStyle({
      storyStylePrompt: '',
      modeStoryStylePrompts: { normal: '', nsfw: '成人风格。' },
    }, 'nsfw', 'normal')
    expect(delayedStyle).not.toContain('切换前叙事模式')
    expect(delayedStyle).toContain('### 切换后叙事模式（NSFW）\n成人风格。')
  })

  it('combines global and current-mode narrative style without including other modes', () => {
    const normalStyle = buildTurnNarrativeStyle({
      storyStylePrompt: '全局使用第二人称叙事。',
      modeStoryStylePrompts: { normal: '正常模式节奏舒缓。', nsfw: '成人模式加强感官描写。' },
    }, 'normal')
    expect(normalStyle).toBe('## 本轮叙事风格设定\n全局使用第二人称叙事。\n正常模式节奏舒缓。')
    expect(normalStyle).not.toContain('成人模式加强感官描写。')

    expect(buildTurnNarrativeStyle({
      storyStylePrompt: '',
      modeStoryStylePrompts: { nsfw: '成人模式加强感官描写。' },
    }, 'nsfw')).toBe('## 本轮叙事风格设定\n成人模式加强感官描写。')
  })
})

describe('LLM special instructions', () => {
  it('builds only selected next-turn constraints and refers to the final portrait contract', () => {
    const text = buildLlmSpecialInstructionText({
      characters: [{
        id: 'npc-1', role: 'npc', name: '莉亚', gender: '女', description: '', color: '#fff',
        portraits: [{ id: 'p1', expression: '平静', tags: ['平静', '微笑'], uri: 'p1.png', groups: ['normal'] }],
      }],
    }, {
      preferEroticChoices: false,
      increaseLength: true,
      decreaseLength: false,
    })

    expect(text).not.toContain('直接进入NSFW模式')
    expect(text).not.toContain('务必为每句人物台词使用本轮输出契约中该角色可用的立绘标签。')
    expect(text).not.toContain('平静、微笑')
    expect(text).not.toContain('再次仔细阅读本轮输出契约，注意严格遵守格式！')
    expect(text).toContain('篇幅加长到2倍')
    expect(text).not.toContain('篇幅减少到一半')
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

describe('RPG turn API message layout', () => {
  const conversation: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '历史选择', requestContent: '历史选择\n\n旧动态指令', createdAt: 1 },
    { id: 'a1', role: 'assistant', content: '历史剧情', createdAt: 2 },
    { id: 'u2', role: 'user', content: '选择B，并等待莉亚', createdAt: 3 },
  ]

  it('uses late system messages by default without polluting historical user messages', () => {
    const messages = buildRpgTurnApiMessages({
      systemPrompt: '固定系统提示词',
      conversation,
      dynamicInstructions: '本轮叙事上下文和人物设定',
      outputContract: '本轮输出契约',
      compatible: false,
    })

    expect(messages).toEqual([
      { role: 'system', content: '固定系统提示词' },
      { role: 'user', content: '历史选择' },
      { role: 'assistant', content: '历史剧情' },
      { role: 'system', content: '本轮叙事上下文和人物设定' },
      { role: 'user', content: '选择B，并等待莉亚' },
      { role: 'system', content: '本轮输出契约' },
    ])
  })

  it('uses one system and one combined current user message in compatible mode', () => {
    const messages = buildRpgTurnApiMessages({
      systemPrompt: '固定系统提示词',
      conversation,
      dynamicInstructions: '本轮叙事上下文和人物设定',
      outputContract: '本轮输出契约',
      compatible: true,
    })

    expect(messages).toHaveLength(4)
    expect(messages[0]).toEqual({ role: 'system', content: '固定系统提示词' })
    expect(messages[1]).toEqual({ role: 'user', content: '历史选择' })
    expect(messages[3].role).toBe('user')
    expect(messages[3].content).toBe('选择B，并等待莉亚\n\n本轮叙事上下文和人物设定\n\n本轮输出契约')
  })

  it('labels the actual role boundaries in the stored debug request', () => {
    expect(buildTurnRequestDebugContent({
      input: '选择B', dynamicInstructions: '动态资料', outputContract: '输出契约', compatible: false,
    })).toBe('===== SYSTEM（本轮动态指令）=====\n动态资料\n\n===== USER =====\n选择B\n\n===== SYSTEM（本轮输出契约）=====\n输出契约')
    expect(buildTurnRequestDebugContent({
      input: '选择B', dynamicInstructions: '动态资料', outputContract: '输出契约', compatible: true,
    })).toBe('===== USER（兼容格式）=====\n选择B\n\n动态资料\n\n输出契约')
  })

  it('builds ordered debug sections from the exact default-format API messages', () => {
    const messages = buildRpgTurnApiMessages({
      systemPrompt: '# 系统规则\n规则\n## 世界观与故事背景\n世界',
      conversation,
      dynamicInstructions: '动态资料',
      outputContract: '输出契约',
      compatible: false,
    })
    expect(buildRpgTurnDebugSegments(messages, false).map(({ title, role, content }) => ({ title, role, content }))).toEqual([
      { title: '固定系统规则', role: 'system', content: '# 系统规则\n规则' },
      { title: '世界观', role: 'system', content: '## 世界观与故事背景\n世界' },
      { title: '历史用户输入', role: 'user', content: '历史选择' },
      { title: '历史剧情回复', role: 'assistant', content: '历史剧情' },
      { title: '本轮叙事上下文与人物设定', role: 'system', content: '动态资料' },
      { title: '本轮玩家输入', role: 'user', content: '选择B，并等待莉亚' },
      { title: '本轮输出契约', role: 'system', content: '输出契约' },
    ])
  })

  it('shows the compatible current request as its actual single user message', () => {
    const messages = buildRpgTurnApiMessages({
      systemPrompt: '# 系统规则\n规则', conversation, dynamicInstructions: '动态资料', outputContract: '输出契约', compatible: true,
    })
    expect(buildRpgTurnDebugSegments(messages, true).at(-1)).toEqual({
      title: '本轮玩家输入与动态规则（兼容格式）',
      role: 'user',
      content: '选择B，并等待莉亚\n\n动态资料\n\n输出契约',
    })
  })
})
