import type { CharacterProfile, GameSession, NarrativeMode, PortraitGroup } from '../types'
import { normalizeHexColor } from './color'

export const DEFAULT_NARRATIVE_MODES: NarrativeMode[] = [
  { id: 'normal', name: '正常', color: '#65b7a5' },
  { id: 'nsfw', name: 'NSFW', color: '#ef7da2' },
]

export function normalizeNarrativeModes(value: NarrativeMode[] | undefined): NarrativeMode[] {
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const modes = (value ?? []).flatMap((mode, index) => {
    const id = String(mode?.id ?? '').trim()
    if (!id || seenIds.has(id)) return []
    let name = String(mode?.name ?? '').trim() || `叙事模式 ${index + 1}`
    const baseName = name
    let suffix = 2
    while (seenNames.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`
    seenIds.add(id)
    seenNames.add(name.toLocaleLowerCase())
    return [{ id, name, color: normalizeHexColor(mode?.color || '#65b7a5') }]
  })
  return modes.length ? modes : DEFAULT_NARRATIVE_MODES.map((mode) => ({ ...mode }))
}

export function availableNarrativeModes(game: Pick<GameSession, 'narrativeModes'>): NarrativeMode[] {
  return normalizeNarrativeModes(game.narrativeModes)
}

export function defaultNarrativeModeId(game: Pick<GameSession, 'narrativeModes'>): PortraitGroup {
  return availableNarrativeModes(game)[0].id
}

export function narrativeModeById(modes: NarrativeMode[] | undefined, id: PortraitGroup): NarrativeMode {
  return normalizeNarrativeModes(modes).find((mode) => mode.id === id) ?? normalizeNarrativeModes(modes)[0]
}

export function createNarrativeMode(modes: NarrativeMode[]): NarrativeMode {
  const normalized = normalizeNarrativeModes(modes)
  const names = new Set(normalized.map((mode) => mode.name.toLocaleLowerCase()))
  let number = normalized.length + 1
  let name = `叙事模式 ${number}`
  while (names.has(name.toLocaleLowerCase())) name = `叙事模式 ${++number}`
  return { id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, color: '#d3ab61' }
}

export function uniqueNarrativeModeName(modes: NarrativeMode[], modeId: string, value: string): string {
  const trimmed = value.trim() || '未命名模式'
  const names = new Set(modes.filter((mode) => mode.id !== modeId).map((mode) => mode.name.toLocaleLowerCase()))
  if (!names.has(trimmed.toLocaleLowerCase())) return trimmed
  let suffix = 2
  while (names.has(`${trimmed} ${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${trimmed} ${suffix}`
}

export function adaptCharacterNarrativeModes(
  character: CharacterProfile,
  sourceModes: NarrativeMode[] | undefined,
  targetModes: NarrativeMode[],
): CharacterProfile {
  const targets = normalizeNarrativeModes(targetModes)
  const targetIds = new Set(targets.map((mode) => mode.id))
  const sourceById = new Map(normalizeNarrativeModes(sourceModes).map((mode) => [mode.id, mode]))
  const targetByName = new Map(targets.map((mode) => [mode.name.toLocaleLowerCase(), mode.id]))
  const fallbackId = targets[0].id
  const mapGroup = (group: string) => targetIds.has(group)
    ? group
    : targetByName.get(sourceById.get(group)?.name.toLocaleLowerCase() ?? '') ?? fallbackId
  const portraits = character.portraits.map((portrait) => ({
    ...portrait,
    groups: Array.from(new Set((portrait.groups ?? ['normal']).map(mapGroup))),
  }))
  const defaults = Object.fromEntries(Object.entries(character.defaultPortraitIds ?? {}).map(([group, portraitId]) => [mapGroup(group), portraitId]))
  const modeDescriptions = Object.fromEntries(Object.entries(character.modeDescriptions ?? {}).map(([group, description]) => [mapGroup(group), description]))
  return { ...character, portraits, modeDescriptions, defaultPortraitIds: defaults, defaultPortraitId: defaults[fallbackId] ?? character.defaultPortraitId }
}

export function removeNarrativeMode(game: GameSession, modeId: string): GameSession {
  const modes = normalizeNarrativeModes(game.narrativeModes)
  if (modes.length <= 1) return game
  const index = modes.findIndex((mode) => mode.id === modeId)
  if (index < 0) return game
  const nextModes = modes.filter((mode) => mode.id !== modeId)
  const targetId = index > 0 ? modes[index - 1].id : nextModes[0].id
  const migrateMode = (value: string | undefined) => value === modeId ? targetId : value
  const characters = game.characters.map((character) => {
    const defaults = { ...character.defaultPortraitIds }
    const removedDefault = defaults[modeId]
    delete defaults[modeId]
    const removedDefaultPortrait = character.portraits.find((portrait) => portrait.id === removedDefault)
    const removedDefaultGroups = removedDefaultPortrait?.groups ?? [modes[0].id]
    if (!defaults[targetId] && removedDefault && removedDefaultGroups.length === 1 && removedDefaultGroups[0] === modeId) {
      defaults[targetId] = removedDefault
    }
    const portraits = character.portraits.map((portrait) => {
      const groups = portrait.groups ?? [modes[0].id]
      const migrated = groups.includes(modeId) && groups.length === 1
        ? [targetId]
        : groups.filter((group) => group !== modeId)
      return { ...portrait, groups: Array.from(new Set(migrated)) }
    })
    const modeDescriptions = { ...character.modeDescriptions }
    const removedDescription = modeDescriptions[modeId]?.trim()
    delete modeDescriptions[modeId]
    if (removedDescription) {
      modeDescriptions[targetId] = [modeDescriptions[targetId]?.trim(), removedDescription].filter(Boolean).join('\n')
    }
    return { ...character, portraits, modeDescriptions, defaultPortraitIds: defaults, defaultPortraitId: defaults[nextModes[0].id] ?? character.defaultPortraitId }
  })
  const modeStoryStylePrompts = { ...game.modeStoryStylePrompts }
  const removedStoryStyle = modeStoryStylePrompts[modeId]?.trim()
  delete modeStoryStylePrompts[modeId]
  if (removedStoryStyle) {
    modeStoryStylePrompts[targetId] = [modeStoryStylePrompts[targetId]?.trim(), removedStoryStyle].filter(Boolean).join('\n')
  }
  return {
    ...game,
    narrativeModes: nextModes,
    modeStoryStylePrompts,
    characters,
    gameState: { ...game.gameState, contentMode: migrateMode(game.gameState.contentMode) ?? targetId },
    messages: game.messages.map((message) => ({
      ...message,
      initialRpgStateId: migrateMode(message.initialRpgStateId),
      rpgStateId: migrateMode(message.rpgStateId),
    })),
    rollbackLog: game.rollbackLog?.map((snapshot) => ({
      ...snapshot,
      gameState: { ...snapshot.gameState, contentMode: migrateMode(snapshot.gameState.contentMode) ?? targetId },
    })),
    updatedAt: Date.now(),
  }
}

export function normalizeGameNarrativeModes(game: GameSession): GameSession {
  const narrativeModes = normalizeNarrativeModes(game.narrativeModes)
  const modeIds = new Set(narrativeModes.map((mode) => mode.id))
  const fallbackId = narrativeModes[0].id
  const normalizeMode = (value: string | undefined) => value && modeIds.has(value) ? value : fallbackId
  return {
    ...game,
    narrativeModes,
    characters: game.characters.map((character) => adaptCharacterNarrativeModes(character, narrativeModes, narrativeModes)),
    gameState: { ...game.gameState, contentMode: normalizeMode(game.gameState.contentMode) },
    messages: game.messages.map((message) => ({
      ...message,
      initialRpgStateId: message.initialRpgStateId ? normalizeMode(message.initialRpgStateId) : undefined,
      rpgStateId: message.rpgStateId ? normalizeMode(message.rpgStateId) : undefined,
    })),
    rollbackLog: game.rollbackLog?.map((snapshot) => ({ ...snapshot, gameState: { ...snapshot.gameState, contentMode: normalizeMode(snapshot.gameState.contentMode) } })),
  }
}
