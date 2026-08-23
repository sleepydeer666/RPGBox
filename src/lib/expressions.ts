import type { CharacterPortrait, CharacterProfile, PortraitGroup } from '../types'

type ExpressionProfile = Partial<Pick<CharacterProfile, 'portraits' | 'defaultPortraitId' | 'defaultPortraitIds'>>

const EXPRESSION_TRANSLATIONS: Record<string, string> = {
  neutral: '平静',
  playful: '俏皮',
  nervous: '紧张',
  smile: '微笑',
  smiling: '微笑',
  serious: '严肃',
  angry: '生气',
  sad: '悲伤',
  happy: '开心',
  surprised: '惊讶',
  shy: '害羞',
  embarrassed: '羞涩',
  excited: '兴奋',
  worried: '担忧',
  cold: '冷淡',
  gentle: '温柔',
  seductive: '妩媚',
}

export function resolveCharacterExpression(character: ExpressionProfile | undefined, requested = '', group: PortraitGroup = 'normal'): {
  portrait?: CharacterPortrait
  displayExpression: string
} {
  const requestedExpression = firstRequestedState(requested)
  if (!character?.portraits?.length) {
    return { displayExpression: requestedExpression ? localizeExpression(requestedExpression) : '' }
  }

  const candidates = character.portraits.filter((portrait) => (portrait.groups ?? ['normal']).includes(group))
  if (!candidates.length) return { displayExpression: requestedExpression ? localizeExpression(requestedExpression) : '' }

  const requestedTags = splitTags(requested)
  const matchedState = requestedTags.flatMap((requestedTag) => candidates.flatMap((portrait) => {
    const configuredTag = portraitTags(portrait).find((tag) => normalizeTag(tag) === requestedTag)
    return configuredTag ? [{ portrait, configuredTag }] : []
  }))[0]
  const defaultId = character.defaultPortraitIds?.[group] ?? (group === 'normal' ? character.defaultPortraitId : undefined)
  const portrait = matchedState?.portrait ?? candidates.find((item) => item.id === defaultId)
  if (!portrait) return { displayExpression: requestedExpression ? localizeExpression(requestedExpression) : '' }
  return {
    portrait,
    displayExpression: requestedExpression
      ? matchedState?.configuredTag ?? portraitTags(portrait)[0] ?? localizeExpression(portrait.expression)
      : '',
  }
}

function portraitTags(portrait: CharacterPortrait): string[] {
  return portrait.tags?.length ? portrait.tags : [portrait.expression].filter(Boolean)
}

function splitTags(value: string): string[] {
  return value.split(/[、,，/\s]+/u).map(normalizeTag).filter(Boolean)
}

function normalizeTag(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function firstRequestedState(value: string): string {
  return value.split(/[、,，/]+/u).map((state) => state.trim()).find(Boolean) ?? ''
}

export function localizeExpression(expression: string): string {
  const normalized = expression.trim()
  if (!normalized) return '平静'
  if (/\p{Script=Han}/u.test(normalized)) return normalized
  return EXPRESSION_TRANSLATIONS[normalized.toLocaleLowerCase()] ?? '平静'
}
