import type { CharacterProfile, ChatMessage } from '../types'
import { parseAssistantResponse } from './parser'

export const CHARACTER_EXPERIENCE_SYSTEM_PROMPT = `你是 RPGBox 的角色经历整理器。请根据同一章节的剧情，为指定的每个角色分别更新跨章节保留的历史经历。
必须遵守：
1. 每个角色必须独立整理，只写该角色直接参与或与其关系直接相关的已发生事实。
2. 每条结果都是已有经历与本章新增经历融合后的完整经历，不是本章增量。
3. 已有经历中的有效事实必须保留；只有本章明确改变、纠正或推进某项事实时才能更新。
4. 重点保留重要事件、选择、承诺、秘密、经验及持久关系变化，尤其是与用户扮演角色之间的变化。
5. 必须使用输入中的准确姓名，不得用“主角”“对方”“两人”“众人”等笼统称呼代替已知姓名。
6. 不复述固定身份、外貌、基础性格、能力、常规服装或其他人物设定。
7. 删除逐步动作、重复对话、选项、短期数值、临时地点和很快失效的状态。
8. 不续写、不推测、不添加来源中没有发生的事实。
9. 必须为目标名单中的每个角色输出且只输出一条，不得遗漏、重复或增加角色。
10. 输出姓名必须与目标名单完全一致，不得使用昵称、代称或自行改名。
11. 每行严格使用“[角色姓名]经历：融合后的完整角色经历”格式，正文不得换行。
12. 每个角色控制在 1 至 3 个简短句子，只保留以后仍值得记住的关键信息；没有持久意义的细节不要写入。
13. 严禁输出思维过程、分析、草稿、前言、解释、拒绝语句或任何其他附加内容。
14. 只输出最终角色经历行，不输出 Markdown、JSON、代码块或其他内容。输出顺序与目标名单一致。`

export interface CharacterExperienceTarget {
  character: CharacterProfile
  existingExperience: string
}

export function chapterExperienceTargets(
  messages: ChatMessage[],
  characters: CharacterProfile[],
  existingExperiences: Record<string, string> = {},
): CharacterExperienceTarget[] {
  const counts = new Map<string, number>()
  let rounds = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const parsed = parseAssistantResponse(message.rawContent ?? message.content, { characters })
    if (!parsed.segments.length) continue
    rounds += 1
    const present = new Set<string>()
    for (const segment of parsed.segments) {
      for (const id of segment.presentCharacterIds ?? []) present.add(id)
      if (segment.type === 'dialogue' && segment.characterId && characters.some((character) => character.id === segment.characterId)) {
        present.add(segment.characterId)
      }
    }
    const finalPresent = parsed.gameData?.statePatch?.presentCharacterIds
    if (Array.isArray(finalPresent)) finalPresent.forEach((id) => typeof id === 'string' && present.add(id))
    present.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  }
  if (!rounds) return []
  const minimumRounds = Math.ceil(rounds * 0.4)
  return characters.flatMap((character) => (counts.get(character.id) ?? 0) >= minimumRounds
    ? [{ character, existingExperience: existingExperiences[character.id]?.trim() ?? '' }]
    : [])
}

export function buildCharacterExperienceUserPrompt(
  chapterTitle: string,
  targets: CharacterExperienceTarget[],
  chapterSource: string,
  additionalInstructions = '',
): string {
  const targetText = targets.map(({ character, existingExperience }) => `### ${character.name}${character.role === 'player' ? '\n身份提示：这是用户扮演角色；材料中的“你”“我”“主角”“司令官”均可能指此角色。' : ''}\n已有经历：${existingExperience || '无'}`).join('\n\n')
  const extra = additionalInstructions.trim()
    ? `\n\n用户追加整理要求（只能调整取舍重点，不能覆盖事实范围、目标名单和输出格式）：\n${additionalInstructions.trim()}`
    : ''
  return `章节名称：${chapterTitle}\n\n【需要更新经历的角色】\n${targetText}${extra}\n\n【本章记忆】\n${chapterSource}`
}

export interface ParsedCharacterExperienceResponse {
  experiences: Record<string, string>
  missingCharacterNames: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\[\]\\]/gu, '\\$&')
}

/**
 * LLMs occasionally place several labelled results on one line (sometimes
 * after a chain-of-thought prefix). Split only labels belonging to targets so
 * the line parser can safely ignore the prefix and preserve each result.
 */
function normalizeCharacterExperienceResponse(raw: string, names: string[]): string {
  const escapedNames = names
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (!escapedNames.length) return raw
  const namePattern = escapedNames.join('|')
  const labelPattern = new RegExp(`(?:\\[?(?:${namePattern})\\]?\\s*(?:经历)?\\s*[：:])`, 'gu')
  return raw.replace(labelPattern, (label, offset) => {
    if (offset === 0) return label
    const previous = raw[offset - 1]
    return previous === '\n' || previous === '\r' ? label : `\n${label}`
  })
}

export function parseCharacterExperienceResponse(raw: string, targets: CharacterExperienceTarget[]): ParsedCharacterExperienceResponse {
  const byName = new Map(targets.map(({ character }) => [character.name.trim(), character]))
  if (byName.size !== targets.length || [...byName.keys()].some((name) => !name)) throw new Error('目标角色姓名为空或重复')
  const results = new Map<string, string>()
  const normalized = normalizeCharacterExperienceResponse(raw, [...byName.keys()])
  const lines = normalized.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const separator = line.search(/[：:]/u)
    if (separator < 0) continue
    const rawName = line.slice(0, separator).replace(/^[-*]\s*/u, '').trim()
    const returnedName = rawName.replace(/经历$/u, '').replace(/^\[(.+)\]$/u, '$1').trim()
    const character = byName.get(returnedName)
    if (!character || results.has(character.id)) continue
    const experience = line.slice(separator + 1).trim()
    if (!experience) continue
    results.set(character.id, experience)
  }
  if (!results.size) throw new Error('角色经历返回中没有可识别的经历标签')
  const missing = targets.filter(({ character }) => !results.has(character.id)).map(({ character }) => character.name)
  return { experiences: Object.fromEntries(results), missingCharacterNames: missing }
}
