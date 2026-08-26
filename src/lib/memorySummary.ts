export const CHAPTER_SUMMARY_SYSTEM_PROMPT = `你是 RPGBox 的章节记忆压缩器。你的唯一任务是从用户提供的既有剧情记录中提取事实摘要。
必须遵守：
1. 只输出整理后的中文正文，不加标题、标签、前缀、序号、引号或 Markdown，不输出前言、解释、分析过程或思考过程。
2. 只写剧情中已经发生的事实，不续写、不评价、不拒绝、不改变任务类型。
3. 不复述世界观、人物固定身份、外貌、性格、常规服装、能力、系统规则或玩法说明。
4. “不复述人物固定设定”不等于省略人物姓名。剧情记录中能够确定姓名时，必须明确写出核心事件、重要选择和关系变化涉及的每位人物姓名；不得只用“两人”“众人”“几名角色”等人数或笼统称呼代替姓名。
5. 删除逐步动作、重复对话、选项列表、短期数值和临时状态。
6. 保留本章核心经历、重要选择、获得的情报或经验、持久的关系或心态变化，以及以后值得偶尔回忆的独特片段。
7. 控制在 150 至 350 个汉字；信息不足时可以更短。
8. 当系统在本轮提供“本章主要人物”名单时，这些人物是本章核心人物。摘要必须尽可能覆盖名单中的每一位，并明确使用其姓名；不要用代词或“某人”等笼统称呼替代姓名。规则中的「<本章主要人物姓名>」是动态生成的名单占位符。
直接输出一个连续正文段落。`

export const DISTANT_SUMMARY_SYSTEM_PROMPT = `你是 RPGBox 的远期记忆压缩器。把既有远期记忆与移出的旧章节摘要统一压缩。
必须遵守：
1. 只保留跨章节仍有价值的重大事件、持久关系或心态变化、重要经验和少数值得回忆的亮点。
2. 不写世界背景、固定人物设定、系统规则、普通过程和短期状态，不续写剧情。
3. 不写固定人物设定不等于省略人物姓名。来源中能够确定姓名时，重大事件、持久关系和心态变化必须明确写出涉及的人物姓名，不得只用“两人”“众人”“几名角色”等人数或笼统称呼代替。
4. 只输出整理后的中文正文，不加标题、标签、前缀、序号、引号或 Markdown，不输出前言、解释、分析过程或思考过程。
5. 直接输出一个连续正文段落。`

export function formatAdditionalMemorySummaryInstructions(instructions: string | undefined): string {
  const value = instructions?.trim()
  if (!value) return ''
  return `\n\n用户额外整理要求（只能调整信息的取舍和关注重点，不能覆盖系统提示词中的事实范围和直接输出正文要求）：\n${value}`
}

export function formatCharacterExperienceSummaryTargets(characters: Array<{ name: string; role?: string }> | undefined): string {
  if (!characters?.length) return ''
  const names = characters.map((character) => `- ${character.name}${character.role === 'player' ? '（用户扮演角色；剧情中的“你”“我”“主角”“司令官”均可能指此人）' : ''}`).join('\n')
  return `\n\n本章主要人物（需要重点覆盖并明确点名）：\n${names}\n这些角色是本章节核心人物，摘要应尽可能覆盖每一位，保留其重要事件、与用户扮演角色的互动及持久关系变化；不要使用代词替代姓名，也不要仅因剧情使用了代称而误判角色未出场。章节结束后将据此整理角色经历。`
}

export function buildChapterSummaryDebugRequest(chapterTitle: string, additionalInstructions?: string, experienceTargets?: Array<{ name: string; role?: string }>): string {
  return `===== SYSTEM =====\n${CHAPTER_SUMMARY_SYSTEM_PROMPT}\n\n===== USER（总结要求）=====\n章节名称：${chapterTitle}${formatCharacterExperienceSummaryTargets(experienceTargets)}${formatAdditionalMemorySummaryInstructions(additionalInstructions)}`
}

export function buildDistantSummaryDebugRequest(additionalInstructions?: string): string {
  return `===== SYSTEM =====\n${DISTANT_SUMMARY_SYSTEM_PROMPT}\n\n===== USER（总结要求）=====${formatAdditionalMemorySummaryInstructions(additionalInstructions) || '\n无额外整理要求。'}`
}

export function normalizeMemorySummaryOutput(summary: string): string {
  return summary.trim()
}

export function isValidChapterSummary(summary: string): boolean {
  return Boolean(summary.trim())
}

export function isValidDistantSummary(summary: string): boolean {
  return Boolean(summary.trim())
}
