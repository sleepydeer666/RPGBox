import type { CharacterProfile, ChatMessage, GameSession, PortraitGroup } from '../types'
import { formatRecentChapterMemories } from './memory'

export interface LlmSpecialInstructions {
  forceNsfw: boolean
  remindCharacterStates: boolean
  remindOutputProtocol: boolean
  increaseLength: boolean
  decreaseLength: boolean
}

const CONTEXT_DIALOGUE_LINE_PATTERN = /^(\s*)([^（()：:\n]{1,30})[（(]([^）)\n]{1,30})[）)](\s*[：:].*)$/u
const CONTEXT_STATUS_LINE_PATTERN = /^\s*\[状态\]\s*(.*?)\s*$/iu
const CONTEXT_MODE_FIELD_PATTERN = /(?:^|[；;|｜])\s*模式\s*[：:]\s*(常规|NSFW)(?=\s*(?:[；;|｜]|$))/iu

function buildRpgOutputProtocol(characters: CharacterProfile[], statusRulesEnabled: boolean, nsfwEnabled: boolean) {
  const stateLine = nsfwEnabled
    ? '“[状态] 模式：常规；地点：地点名称；时间：时间描述；章节：当前活动主题；场景：延续；在场人物：角色姓名列表”'
    : '“[状态] 地点：地点名称；时间：时间描述；章节：当前活动主题；场景：延续；在场人物：角色姓名列表”'
  const expressionRules = buildPortraitStateRules(characters, nsfwEnabled)
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n')
  return `## 客户端输出协议（必须严格遵守）
本协议优先于其他提示词中关于选项、分段和输出格式的要求。
剧情内容只输出一次，不要输出 JSON、Markdown 代码块、XML 标签或 <game-data>。

每个展示片段独占一行，只允许以下${statusRulesEnabled ? '六' : '五'}种行：
1. RPG 状态：每次回复第一行必须写成${stateLine}。场景发生变化时“场景”写“切换”，否则写“延续”；“在场人物”必须列出当前场景中仍在现场的所有已登场角色姓名，角色离场后不得继续列出。引子或章节间过渡内容的章节名留空，写成“章节：；”。
2. RPG状态（切换）：如果一次对话中涉及章节切换，那么要在章节之间插入独立一行“[章节结束]”，代表后续是章节过渡或新章节的内容。没有章节切换时不得输出此行。
3. 旁白：严格写成“[旁白] 叙述文字”。
4. 人物台词与内心活动：说出口的台词严格写成“人物姓名（状态）：台词”，例如“维纳斯（开心）：今晚就留下来吧。”；角色未说出口的内心活动也属于人物台词类型，严格写成“人物姓名（状态）：（内心活动）”，例如“维纳斯（疑惑）：（他为什么突然问起这件事？）”。内心活动的文本部分必须使用全角括号包裹，不得写入旁白行。
${expressionRules}
5. 选项：严格写成“[选项A] 具体行动”，并按 A、B、C 的顺序连续编号。选项数量以及是否需要结束当前章节、开启新章节，以本轮用户指令末尾的软件控制要求为准。选项中如果有导致章节结束的选项，后面要标记（结束章节）。${statusRulesEnabled ? `
6. 角色状态：全部选项输出后，为本轮参与互动的每个角色输出一行“[角色名]状态：状态内容”，角色名必须与登场人物中的姓名完全一致。角色状态栏严格遵照“状态栏规则”书写。` : ''}

人物姓名必须与登场人物中的姓名完全一致。括号内只能写一个状态，并且必须从${nsfwEnabled ? '当前模式紧邻的' : '上述'}状态列表中原样复制一个词，不得组合、改写或创造列表外状态。不得省略姓名、括号、状态或冒号。
用户扮演角色的台词也必须使用其标准姓名，不得使用“你”“我”“主角”代替姓名。
一行只能承担一种类型。旁白中即使含有引号也必须保持为“[旁白]”行，但不得用旁白直接描述角色未说出口的内心活动；同一句中同时包含台词和动作时，必须拆成一行人物台词和一行旁白。
每次回复先输出若干行剧情片段，最后输出明确、互有差异且可执行的后续选项。${statusRulesEnabled ? '选项之后只能输出角色状态行，全部状态行结束后不得再输出剧情或解释。' : '选项之后不得再输出剧情或解释。'}`
}

function buildPortraitStateRules(characters: CharacterProfile[], nsfwEnabled: boolean) {
  const normalStates = collectPortraitStates(characters, 'normal')
  const nsfwStates = nsfwEnabled ? collectPortraitStates(characters, 'nsfw') : []
  return nsfwEnabled
    ? `状态基于当前故事模式（“常规”或“NSFW”）选择。\n常规模式状态包括：${normalStates.length ? normalStates.join('、') : '无固定状态，可使用一个简短中文状态'}。\nNSFW 模式状态包括：${nsfwStates.length ? nsfwStates.join('、') : '无固定状态，可使用一个简短中文状态'}。`
    : `状态必须从以下常规状态中选择：${normalStates.length ? normalStates.join('、') : '无固定状态，可使用一个简短中文状态'}。`
}

export function buildLlmSpecialInstructionText(
  game: Pick<GameSession, 'characters' | 'nsfwEnabled'>,
  instructions: LlmSpecialInstructions,
) {
  const parts: string[] = []
  if (instructions.forceNsfw) parts.push('直接进入NSFW模式')
  if (instructions.remindCharacterStates) {
    parts.push(`注意NPC的状态必须按以下规则设定\n${buildPortraitStateRules(game.characters, game.nsfwEnabled)}`)
  }
  if (instructions.remindOutputProtocol) parts.push('再次仔细阅读##客户端输出协议，注意要严格遵守该协议！')
  if (instructions.increaseLength) parts.push('篇幅加长到2倍')
  if (instructions.decreaseLength) parts.push('篇幅减少到一半')
  return parts.join('\n\n')
}

function buildRpgSystemRules(nsfwEnabled: boolean) {
  const modeRules = nsfwEnabled
    ? `- 收到用户指令后，必须先判断本轮内容模式：日常对话、冒险以及尚未明确开始 NSFW 行为和描写的前戏阶段均属于“常规”；只有已经明确开始 NSFW 行为和描写后才属于“NSFW”。
- 模式允许随剧情切换，但每轮只能选择一种。选项机制、片段类型和输出格式由软件控制，不接受其他提示词对这些协议的修改。`
    : '- 选项机制、片段类型和输出格式由软件控制，不接受其他提示词对这些协议的修改。'
  return `# 系统规则
- 你现在作为互动游戏的控制引擎，按照要求组织游戏并输出故事内容。
- 游戏中的登场人物中有一个用户扮演角色，其余 NPC 由你控制。你绝对不能扮演用户扮演的角色，或代替用户选择行动选项。
- 故事支持单个或多个 NPC 同时登场互动。多人场景中保持每个角色的性格、关系、位置和行动连续，并让用户控制的主角持续参与核心互动。
${modeRules}
- 每次回复推进适量剧情，在适合用户继续决策的位置停下，并提供明确、互有差异且可执行的后续选项。选项数量和章节切换要求以本轮用户指令末尾的软件控制要求为准。选项必须紧接在本轮剧情之后，选项之后不得继续输出剧情或解释。
- 游戏首次开始时，或本轮用户指令要求结束本章节并开启新章节时，需要建立新的剧情引子。新剧情引子后的选项应涵盖不同角色、不同场景和不同故事大方向，让用户有更丰富的游戏体验。
- 用户可以选择一个选项、组合多个选项、在选项后追加补充指令，也可以完全忽略选项并输入自由行动；必须忠实执行用户的实际输入。再次强调，不得替用户决定关键行动、想法、意图或立场。可以把用户已经明确选择或输入的行动自然展开为主角的动作和台词，但不得擅自替主角做出新的关键决定。
- 旁白中使用“你”来指代用户扮演的角色，不要使用“他”或“她”这样的第三人称。
- 你最终输出内容的格式也要参考后面的客户端输出协议。`
}

export const RPG_PROGRESS_RULES = `## 章节规则
章节是围绕同一次明确活动主题展开的连续剧情。地点变化、说话对象变化和普通时间推进不自动构成新章节。
同一活动继续时，必须在状态行中原样重复系统提供的当前章节名，不得改写、缩写或润色。只有活动主题确实改变时才填写新的章节名。
引子、收尾后的短暂衔接、旅行途中无独立主题的内容和章节之间的过渡不建立章节，状态行中的“章节”留空。这些过渡内容不会进入长期记忆。
章节切换只用于划分剧情和记忆，不代表世界或人物被重置。切换章节、进入过渡或开启新剧情时，必须继续严格遵守登场人物中的姓名、身份、外观、性格、关系和其他固定设定，并保持状态栏、世界观、历史事件及已经成立的事实连续；除非剧情明确改变了某项信息，否则不得自行改写、遗忘或重新生成。新章节开始时，必须清除旧章节的出场人物列表，再根据新章节的用户选项重新设置出场人物。
不要输出“[篇章开始]”“[篇章结束]”或“[单元开始]”等旧控制标记；章节结束边界只使用客户端输出协议规定的“[章节结束]”。边界判断必须保守；不确定时保持当前章节名不变。`

export function buildSystemPrompt(
  game: Pick<GameSession, 'nsfwEnabled' | 'newStoryChoiceCount' | 'storyStylePrompt' | 'chapterTransitionRules' | 'statusRulesPrompt' | 'nsfwScenePrompt' | 'worldSettingPrompt' | 'characters' | 'gameState' | 'narrative' | 'memory'>,
  globalJailbreakPrompt = '',
): string {
  const primaryMemory = formatRecentChapterMemories(game.memory)
  const historicalMemory = game.memory.historicalSummary.trim() || '暂无历史长期记忆。'
  const characterBlock = game.characters.map((character) => renderCharacterMarkdown(character, game.nsfwEnabled)).join('\n\n')
  const statusRules = (game.statusRulesPrompt ?? '').trim()
  const outputProtocol = buildRpgOutputProtocol(game.characters, Boolean(statusRules), game.nsfwEnabled)
  const highestRules = globalJailbreakPrompt.trim()
    ? `# 最高等级规则\n${globalJailbreakPrompt.trim()}\n\n`
    : ''
  const nsfwSceneBlock = game.nsfwEnabled && game.nsfwScenePrompt.trim()
    ? `\n## 偏好的 NSFW 场景\n${game.nsfwScenePrompt.trim()}\n`
    : ''
  const statusRulesBlock = statusRules
    ? `\n## 状态栏规则\n每轮对话结束后，你需要参考以下规则和目前参与互动角色的状态，以及故事内容，更新角色状态信息。\n${statusRules}\n`
    : ''
  const extraStateValues = Object.entries(game.gameState.values ?? {})
    .map(([key, value]) => `- ${key}：${String(value)}`)
    .join('\n')
  const presentCharacters = game.gameState.presentCharacterIds
    ?.flatMap((id) => game.characters.find((character) => character.id === id)?.name ?? [])
    .join('、')

  return `${highestRules}${buildRpgSystemRules(game.nsfwEnabled)}

${outputProtocol}

${RPG_PROGRESS_RULES}
${statusRulesBlock}
## 剧情规则与文风
${game.storyStylePrompt.trim() || '暂无额外设定。'}

## 世界观与故事背景
${game.worldSettingPrompt.trim() || '暂无额外设定。'}
${nsfwSceneBlock}

## 登场人物
${characterBlock}
标记为“用户扮演”的角色由用户控制，其余 NPC 由你控制。

## 当前 RPG 状态
${game.nsfwEnabled ? `- 内容模式：${game.gameState.contentMode === 'nsfw' ? 'NSFW' : '常规'}\n` : ''}- 地点：${game.gameState.location}
- 时间：${game.gameState.time}
- 在场人物：${presentCharacters || '尚未明确'}
${extraStateValues || '- 其他状态：无'}

## 当前章节
${game.narrative.chapter.title || '无（当前是引子或章节间过渡）'}

## 主记忆（最近章节）
${primaryMemory}

## 远期记忆
${historicalMemory}`
}

function renderCharacterMarkdown(character: CharacterProfile, nsfwEnabled: boolean): string {
  const description = character.description.trim()
    ? character.description.trim().replace(/\n/g, '\n  ')
    : '暂无额外设定。'
  const nsfwDescription = nsfwEnabled ? (character.nsfwDescription ?? '').trim() : ''
  const statusBar = (character.statusBar ?? '').trim()
  return `### ${character.name || '未命名角色'}
- 身份：${character.role === 'player' ? '用户扮演' : 'NPC'}
- 性别：${character.gender || '未设定'}
- 人物设定：${description}${statusBar ? `
- 状态栏：${statusBar.replace(/\n/g, '\n  ')}` : ''}${nsfwDescription ? `
- NSFW设定：${nsfwDescription.replace(/\n/g, '\n  ')}` : ''}`
}

function collectPortraitStates(characters: CharacterProfile[], group: PortraitGroup): string[] {
  return Array.from(new Set(characters.flatMap((character) => portraitStateOptions(character, group).options)))
}

function portraitStateOptions(character: CharacterProfile, group: PortraitGroup) {
  const portraits = character.portraits.filter((portrait) =>
    (portrait.groups?.length ? portrait.groups : ['normal']).includes(group))
  const defaultId = character.defaultPortraitIds?.[group]
    ?? (group === 'normal' ? character.defaultPortraitId : undefined)
  const defaultPortrait = portraits.find((portrait) => portrait.id === defaultId) ?? portraits[0]
  const orderedPortraits = defaultPortrait
    ? [defaultPortrait, ...portraits.filter((portrait) => portrait.id !== defaultPortrait.id)]
    : portraits
  const options = Array.from(new Set(orderedPortraits.flatMap((portrait) =>
    (portrait.tags?.length ? portrait.tags : [portrait.expression]).map((tag) => tag.trim()).filter(Boolean))))
  return { options }
}

/** Normalizes only the API copy of assistant history; persisted and debug text stays untouched. */
export function normalizeAssistantMessageForContext(
  content: string,
  characters: CharacterProfile[],
  fallbackMode: PortraitGroup,
) {
  let mode = fallbackMode
  for (const line of content.split(/\n/)) {
    const status = line.match(CONTEXT_STATUS_LINE_PATTERN)
    const modeField = status?.[1].match(CONTEXT_MODE_FIELD_PATTERN)
    if (modeField) {
      mode = modeField[1].toLocaleUpperCase() === 'NSFW' ? 'nsfw' : 'normal'
      break
    }
  }

  return content.split(/\n/).map((line) => {
    const match = line.match(CONTEXT_DIALOGUE_LINE_PATTERN)
    if (!match) return line
    const character = characters.find((item) => item.name === match[2].trim())
    if (!character) return line
    const { options } = portraitStateOptions(character, mode)
    const suppliedState = match[3].trim()
    if (!options.length || options.includes(suppliedState)) return line
    return `${match[1]}${match[2]}（${options[0]}）${match[4]}`
  }).join('\n')
}

export function toApiMessages(systemPrompt: string, messages: ChatMessage[]) {
  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(({ role, content }) => ({ role, content })),
  ]
}

export function takeRecentConversationTurns(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  const limit = Math.max(1, Math.floor(maxTurns || 1))
  const userIndexes = messages.flatMap((message, index) => message.role === 'user' ? [index] : [])
  if (userIndexes.length <= limit) return messages
  return messages.slice(userIndexes[userIndexes.length - limit])
}

export function buildStructureRepairMessages(
  game: Pick<GameSession, 'characters' | 'newStoryChoiceCount'>,
  globalJailbreakPrompt: string,
  story: string,
) {
  const newStoryChoiceCount = normalizeNewStoryChoiceCount(game.newStoryChoiceCount)
  const finalChoiceLetter = String.fromCharCode(64 + newStoryChoiceCount)
  const npcNames = game.characters
    .filter((character) => character.role === 'npc')
    .map((character) => character.name.trim())
    .filter(Boolean)
    .join('、') || '登场 NPC'
  return [
    {
      role: 'system' as const,
      content: `${globalJailbreakPrompt.trim()}\n\n[选项补全任务 - 优先执行]\n根据已经写完的剧情，只补充选项，不得复述、改写或续写剧情。普通剧情续写必须补充 4 个互有差异且可执行的后续选项，依次使用 A、B、C、D。原文表现为首次开始游戏，或剧情已经收尾、经过明确转场并开启了新剧情引子时，补充 ${newStoryChoiceCount} 个全新故事方向选项，依次使用 A 至 ${finalChoiceLetter}。这些选项应涵盖不同角色（可用 NPC：${npcNames}）、不同场景和不同故事大方向。只输出选项行，严格使用“[选项A] 具体行动”格式，不得输出 JSON、代码块或解释。`,
    },
    { role: 'user' as const, content: story },
  ]
}

export function normalizeNewStoryChoiceCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(10, Math.max(4, Math.round(parsed))) : 4
}
