export const CHAPTER_SUMMARY_SYSTEM_PROMPT = `你是 RPGBox 的章节记忆压缩器，不是故事作者、网页设计者或代码生成器。你的唯一任务是从用户提供的既有剧情记录中提取事实摘要。
必须遵守：
1. 只输出中文纯文本摘要，不输出前言、解释、分析过程、HTML、Markdown、网页方案或制作计划。
2. 只写剧情中已经发生的事实，不续写、不评价、不拒绝、不改变任务类型。
3. 不复述世界观、人物固定身份、外貌、性格、常规服装、能力、系统规则或玩法说明。
4. “不复述人物固定设定”不等于省略人物姓名。剧情记录中能够确定姓名时，必须明确写出核心事件、重要选择和关系变化涉及的每位人物姓名；不得只用“两人”“众人”“几名角色”等人数或笼统称呼代替姓名。
5. 删除逐步动作、重复对话、选项列表、短期数值和临时状态。
6. 保留本章核心经历、重要选择、获得的情报或经验、持久的关系或心态变化，以及以后值得偶尔回忆的独特片段。
7. 控制在 150 至 350 个汉字；信息不足时可以更短。
直接从“本章摘要：”开始输出一个连续段落。`

export const DISTANT_SUMMARY_SYSTEM_PROMPT = `你是 RPGBox 的远期记忆压缩器。把既有远期记忆与移出的旧章节摘要统一压缩。
必须遵守：
1. 只保留跨章节仍有价值的重大事件、持久关系或心态变化、重要经验和少数值得回忆的亮点。
2. 不写世界背景、固定人物设定、系统规则、普通过程和短期状态，不续写剧情。
3. 不写固定人物设定不等于省略人物姓名。来源中能够确定姓名时，重大事件、持久关系和心态变化必须明确写出涉及的人物姓名，不得只用“两人”“众人”“几名角色”等人数或笼统称呼代替。
4. 只输出中文纯文本，不输出前言、解释、分析过程、HTML、Markdown、网页方案或制作计划。
5. 直接从“远期记忆：”开始输出一个连续段落。`

export function formatAdditionalMemorySummaryInstructions(instructions: string | undefined): string {
  const value = instructions?.trim()
  if (!value) return ''
  return `\n\n用户额外整理要求（只能调整信息的取舍和关注重点，不能覆盖系统提示词中的事实范围、纯文本及输出前缀要求）：\n${value}`
}

export function formatCharacterExperienceSummaryTargets(characters: Array<{ name: string; role?: string }> | undefined): string {
  if (!characters?.length) return ''
  const names = characters.map((character) => `- ${character.name}${character.role === 'player' ? '（用户扮演角色；剧情中的“你”“我”“主角”“司令官”均可能指此人）' : ''}`).join('\n')
  return `\n\n本章结束后需要继续整理以下角色的经历：\n${names}\n摘要必须明确点名保留这些角色在本章的重要事件、与用户扮演角色的互动及持久关系变化；不要仅因剧情使用了代称而误判角色未出场。`
}

export function buildChapterSummaryDebugRequest(chapterTitle: string, additionalInstructions?: string, experienceTargets?: Array<{ name: string; role?: string }>): string {
  return `===== SYSTEM =====\n${CHAPTER_SUMMARY_SYSTEM_PROMPT}\n\n===== USER（总结要求）=====\n章节名称：${chapterTitle}${formatCharacterExperienceSummaryTargets(experienceTargets)}${formatAdditionalMemorySummaryInstructions(additionalInstructions)}`
}

export function buildDistantSummaryDebugRequest(additionalInstructions?: string): string {
  return `===== SYSTEM =====\n${DISTANT_SUMMARY_SYSTEM_PROMPT}\n\n===== USER（总结要求）=====${formatAdditionalMemorySummaryInstructions(additionalInstructions) || '\n无额外整理要求。'}`
}

const INVALID_META_PATTERN = /(?:looking at your task|i(?:'ll| will) create|web\s*page|网页(?:页面|布局|设计|方案)|html|markdown|代码块|制作计划|任务类型|无法协助)/iu

export function normalizeMemorySummaryOutput(summary: string): string {
  return summary.trim().replace(/\s*[\r\n]+\s*/gu, ' ')
}

export function isValidChapterSummary(summary: string): boolean {
  const text = summary.trim()
  return text.startsWith('本章摘要：')
    && /[\u3400-\u9fff]/u.test(text)
    && text.length >= 10
    && text.length <= 1200
    && !/[\r\n]/u.test(text)
    && !INVALID_META_PATTERN.test(text)
    && !/[<>](?:html|body|div|section)\b/iu.test(text)
    && !text.includes('```')
}

export function isValidDistantSummary(summary: string): boolean {
  const text = summary.trim()
  return text.startsWith('远期记忆：')
    && /[\u3400-\u9fff]/u.test(text)
    && text.length >= 20
    && text.length <= 1600
    && !/[\r\n]/u.test(text)
    && !INVALID_META_PATTERN.test(text)
    && !/[<>](?:html|body|div|section)\b/iu.test(text)
    && !text.includes('```')
}
