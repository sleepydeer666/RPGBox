import type { GameState } from '../types'

const RESERVED_KEYS = new Set(['location', 'time'])
const IGNORED_KEYS = new Set(['focusCharacter', 'expression'])

export function applyStatePatch(current: GameState, patch?: Record<string, unknown>): GameState {
  if (!patch) return current
  const next: GameState = { ...current, values: { ...current.values } }

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'contentMode' && (value === 'normal' || value === 'nsfw')) {
      next.contentMode = value
    } else if (RESERVED_KEYS.has(key) && typeof value === 'string') {
      next[key as keyof Pick<GameState, 'location' | 'time'>] = value
    } else if (key === 'presentCharacterIds' && Array.isArray(value)) {
      next.presentCharacterIds = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    } else if (!IGNORED_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) {
      next.values[key] = value as string | number | boolean
    }
  }
  return next
}

export function applyRpgStatePatch(current: GameState, patch: Record<string, unknown> | undefined): GameState {
  return applyStatePatch(current, patch)
}
