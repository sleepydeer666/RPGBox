import JSZip from 'jszip'
import { createRoleXml, parseRoleXml } from '../lib/rolePackage'
import { createRpgboxXml, parseRpgboxXml, type PackageSections } from '../lib/rpgPackage'
import { normalizeNarrativeModes } from '../lib/narrativeModes'
import type { CharacterProfile, CharacterPortrait, GameSession, NarrativeMode, PortraitGroup } from '../types'

export interface PortraitDraft extends Omit<CharacterPortrait, 'uri'> {
  file: Blob
  previewUrl: string
  extension: string
}

export interface CharacterDraft extends Omit<CharacterProfile, 'portraits'> {
  portraits: PortraitDraft[]
}

interface SerializedPortrait extends Omit<CharacterPortrait, 'uri'> {
  assetPath: string
}

interface SerializedCharacter extends Omit<CharacterProfile, 'portraits'> {
  portraits: SerializedPortrait[]
}

export interface RpgDraftSettings {
  title: string
  narrativeModes: NarrativeMode[]
  newStoryChoiceCount: number
  storyStylePrompt: string
  modeStoryStylePrompts?: Partial<Record<PortraitGroup, string>>
  chapterTransitionRules: string
  narrativeModeRulesPrompt: string
  recommendedChapterTurnsEnabled: boolean
  recommendedChapterTurns: number
  statusRulesPrompt: string
  nsfwScenePrompt: string
  worldSettingPrompt: string
  openingMessage: string
  location: string
  time: string
  chapterTitle: string
}

export interface BatchPortraitResult {
  portraits: PortraitDraft[]
  imported: number
  failed: number
}

export interface ImportedRpgDraft {
  settings: Partial<RpgDraftSettings>
  characters: CharacterDraft[]
}

export function groupsForExpression(_expression: string, defaultModeId = 'normal'): PortraitGroup[] {
  return [defaultModeId]
}

export function importBatchPortraits(files: File[], characterName: string, defaultModeId = 'normal', idFactory = createId): BatchPortraitResult {
  const portraits: PortraitDraft[] = []
  let failed = 0
  const prefix = `${characterName}_`

  for (const file of files) {
    const isImage = file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp)$/iu.test(file.name)
    if (!isImage) continue
    const validPng = file.name.toLowerCase().endsWith('.png')
    const stem = validPng ? file.name.slice(0, -4) : ''
    const expression = stem.startsWith(prefix) ? stem.slice(prefix.length).trim() : ''
    if (!validPng || !characterName.trim() || !expression) {
      failed += 1
      continue
    }
    portraits.push({
      id: idFactory('portrait'),
      expression,
      tags: [expression],
      groups: groupsForExpression(expression, defaultModeId),
      file,
      extension: 'png',
      previewUrl: URL.createObjectURL(file),
    })
  }

  return { portraits, imported: portraits.length, failed }
}

export function applyMissingDefaults(character: CharacterDraft, modes: NarrativeMode[] = [{ id: 'normal', name: '正常', color: '#65b7a5' }]): CharacterDraft {
  const normalizedModes = normalizeNarrativeModes(modes)
  const defaults = { ...character.defaultPortraitIds }
  for (const [index, mode] of normalizedModes.entries()) {
    const available = character.portraits.filter((portrait) => (portrait.groups ?? [normalizedModes[0].id]).includes(mode.id))
    const current = defaults[mode.id] ?? (index === 0 ? character.defaultPortraitId : undefined)
    if (current && available.some((portrait) => portrait.id === current)) defaults[mode.id] = current
    else if (available[0]) defaults[mode.id] = available[0].id
    else delete defaults[mode.id]
  }
  return {
    ...character,
    defaultPortraitId: defaults[normalizedModes[0].id],
    defaultPortraitIds: defaults,
  }
}

export function bindRoleToNarrativeModes(character: CharacterDraft, modes: NarrativeMode[]): CharacterDraft {
  const normalizedModes = normalizeNarrativeModes(modes)
  const defaultModeId = normalizedModes[0].id
  return applyMissingDefaults({
    ...character,
    modeDescriptions: {},
    portraits: character.portraits.map((portrait) => ({ ...portrait, groups: [defaultModeId] })),
    defaultPortraitIds: character.defaultPortraitId ? { [defaultModeId]: character.defaultPortraitId } : {},
  }, normalizedModes)
}

export function removeDraftNarrativeMode(
  settings: RpgDraftSettings,
  characters: CharacterDraft[],
  modeId: string,
): { settings: RpgDraftSettings; characters: CharacterDraft[] } {
  const modes = normalizeNarrativeModes(settings.narrativeModes)
  if (modes.length <= 1) return { settings, characters }
  const index = modes.findIndex((mode) => mode.id === modeId)
  if (index < 0) return { settings, characters }
  const nextModes = modes.filter((mode) => mode.id !== modeId)
  const targetId = index > 0 ? modes[index - 1].id : nextModes[0].id
  const modeStoryStylePrompts = migrateTextRecord(settings.modeStoryStylePrompts, modeId, targetId)
  return {
    settings: { ...settings, narrativeModes: nextModes, modeStoryStylePrompts },
    characters: characters.map((character) => {
      const modeDescriptions = migrateTextRecord(character.modeDescriptions, modeId, targetId)
      const defaults = { ...character.defaultPortraitIds }
      const removedDefault = defaults[modeId]
      delete defaults[modeId]
      if (!defaults[targetId] && removedDefault) defaults[targetId] = removedDefault
      const portraits = character.portraits.map((portrait) => {
        const groups = portrait.groups ?? [modes[0].id]
        const migrated = groups.includes(modeId) && groups.length === 1
          ? [targetId]
          : groups.filter((group) => group !== modeId)
        return { ...portrait, groups: Array.from(new Set(migrated)) }
      })
      return applyMissingDefaults({ ...character, modeDescriptions, portraits, defaultPortraitIds: defaults }, nextModes)
    }),
  }
}

export async function readRolePackage(file: File): Promise<CharacterDraft> {
  if (!file.name.toLowerCase().endsWith('.role.rpgbox')) throw new Error('请选择 .role.rpgbox 人物包')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const xml = zip.file('role.xml')
  if (!xml) throw new Error('人物包缺少 role.xml')
  const role = parseRoleXml(await xml.async('string'))
  const portraits: PortraitDraft[] = []
  for (const portrait of role.portraits ?? []) {
    if (!portrait.assetPath?.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
    const asset = zip.file(portrait.assetPath)
    if (!asset) continue
    const fileBlob = await asset.async('blob')
    const { assetPath, uri: _legacyUri, groups: _groups, ...metadata } = portrait as typeof portrait & { uri?: string }
    portraits.push({
      ...metadata,
      file: fileBlob,
      extension: extensionOf(assetPath),
      previewUrl: URL.createObjectURL(fileBlob),
    })
  }
  return {
    ...role,
    id: createId('npc'),
    role: 'npc',
    modeDescriptions: {},
    statusBar: role.statusBar ?? '',
    portraits: portraits.map((portrait) => ({ ...portrait, groups: undefined })),
    defaultPortraitIds: {},
  }
}

export async function readRpgPackage(file: File): Promise<ImportedRpgDraft> {
  if (!file.name.toLowerCase().endsWith('.rpgbox') || file.name.toLowerCase().endsWith('.role.rpgbox')) throw new Error('请选择 .rpgbox RPG 剧本包')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const xmlFile = zip.file('rpg.xml')
  if (!xmlFile) throw new Error('RPG 剧本包缺少 rpg.xml')
  const xml = await xmlFile.async('string')
  const sections = parseRpgboxXml(xml)
  const sourceSettings = sections.settings ?? {}
  const messages = Array.isArray(sourceSettings.messages) ? sourceSettings.messages : []
  const openingMessage = messages.find((message) => isRecord(message) && message.role === 'assistant' && typeof message.content === 'string')
  const gameState = isRecord(sourceSettings.gameState) ? sourceSettings.gameState : {}
  const narrative = isRecord(sourceSettings.narrative) ? sourceSettings.narrative : {}
  const chapter = isRecord(narrative.chapter) ? narrative.chapter : {}
  const titleAttribute = xml.match(/<rpgbox\b[^>]*\btitle="([^"]*)"/u)?.[1]
  const characters: CharacterDraft[] = []

  for (const serialized of sections.characters ?? []) {
    const portraits: PortraitDraft[] = []
    for (const portrait of serialized.portraits ?? []) {
      if (!portrait.assetPath?.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
      const asset = zip.file(portrait.assetPath)
      if (!asset) continue
      const fileBlob = await asset.async('blob')
      const { assetPath, uri: _legacyUri, ...metadata } = portrait as typeof portrait & { uri?: string }
      portraits.push({ ...metadata, file: fileBlob, extension: extensionOf(assetPath), previewUrl: URL.createObjectURL(fileBlob) })
    }
    const nsfwSettings = sections.nsfw?.characterSettings?.find((item) => item.id === serialized.id)
      ?? sections.nsfw?.characterSettings?.find((item) => item.name === serialized.name)
    characters.push({
      ...serialized,
      role: serialized.role === 'player' ? 'player' : 'npc',
      modeDescriptions: serialized.modeDescriptions ?? (nsfwSettings?.nsfwDescription ? { nsfw: nsfwSettings.nsfwDescription } : {}),
      statusBar: serialized.statusBar ?? '',
      portraits,
    })
  }

  return {
    settings: {
      title: titleAttribute ? decodeXmlAttribute(titleAttribute) : file.name.replace(/\.rpgbox$/iu, ''),
      narrativeModes: normalizeNarrativeModes(Array.isArray(sourceSettings.narrativeModes) ? sourceSettings.narrativeModes as NarrativeMode[] : undefined),
      newStoryChoiceCount: numberValue(sourceSettings.newStoryChoiceCount),
      storyStylePrompt: stringValue(sourceSettings.storyStylePrompt),
      modeStoryStylePrompts: isRecord(sourceSettings.modeStoryStylePrompts)
        ? Object.fromEntries(Object.entries(sourceSettings.modeStoryStylePrompts).map(([key, value]) => [key, stringValue(value)]))
        : {},
      chapterTransitionRules: stringValue(sourceSettings.chapterTransitionRules),
      narrativeModeRulesPrompt: stringValue(sourceSettings.narrativeModeRulesPrompt),
      recommendedChapterTurnsEnabled: Boolean(sourceSettings.recommendedChapterTurnsEnabled),
      recommendedChapterTurns: numberValue(sourceSettings.recommendedChapterTurns),
      statusRulesPrompt: stringValue(sourceSettings.statusRulesPrompt),
      nsfwScenePrompt: sections.nsfw?.nsfwScenePrompt ?? '',
      worldSettingPrompt: stringValue(sourceSettings.worldSettingPrompt),
      openingMessage: isRecord(openingMessage) ? stringValue(openingMessage.content) : '',
      location: stringValue(gameState.location),
      time: stringValue(gameState.time),
      chapterTitle: stringValue(chapter.title),
    },
    characters,
  }
}

export async function buildRolePackage(character: CharacterDraft): Promise<Blob> {
  if (!character.name.trim()) throw new Error('请填写人物姓名')
  const zip = new JSZip()
  const portraits = (await addPortraits(zip, character, 'portraits')).map(({ groups: _groups, ...portrait }) => portrait)
  const { modeDescriptions: _modeDescriptions, defaultPortraitIds: _defaultPortraitIds, narrativeModes: _narrativeModes, ...base } = withoutDraftPortraits(character) as CharacterProfile & { narrativeModes?: unknown }
  const includedIds = new Set(portraits.map((portrait) => portrait.id))
  const role = {
    ...base,
    role: 'npc' as const,
    portraits,
    defaultPortraitId: includedIds.has(base.defaultPortraitId ?? '') ? base.defaultPortraitId : portraits[0]?.id,
  }
  zip.file('role.xml', createRoleXml(role))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function buildRpgPackage(settings: RpgDraftSettings, player: CharacterDraft, participants: CharacterDraft[]): Promise<Blob> {
  if (!settings.title.trim()) throw new Error('请填写 RPG 名称')
  const zip = new JSZip()
  const characters = [player, ...participants]
  const serializedCharacters: SerializedCharacter[] = await Promise.all(characters.map(async (character) => {
    const base = withoutDraftPortraits(character)
    const portraits = await addPortraits(zip, character, `portraits/${safePathPart(character.id)}`)
    const includedIds = new Set(portraits.map((portrait) => portrait.id))
    return {
      ...base,
      portraits,
      defaultPortraitId: includedIds.has(base.defaultPortraitId ?? '') ? base.defaultPortraitId : undefined,
      defaultPortraitIds: Object.fromEntries(Object.entries(base.defaultPortraitIds ?? {})
        .filter(([, id]) => includedIds.has(id ?? ''))),
    }
  }))
  const now = Date.now()
  const narrativeModes = normalizeNarrativeModes(settings.narrativeModes)
  const defaultModeId = narrativeModes[0].id
  const openingId = `opening-${now}`
  const sections: PackageSections = {
    settings: {
      systemPrompt: settings.storyStylePrompt,
      narrativeModes,
      newStoryChoiceCount: clamp(settings.newStoryChoiceCount, 4, 10),
      storyStylePrompt: settings.storyStylePrompt,
      modeStoryStylePrompts: settings.modeStoryStylePrompts ?? {},
      chapterTransitionRules: settings.chapterTransitionRules,
      narrativeModeRulesPrompt: settings.narrativeModeRulesPrompt,
      recommendedChapterTurnsEnabled: settings.recommendedChapterTurnsEnabled,
      recommendedChapterTurns: clamp(settings.recommendedChapterTurns, 10, 30),
      statusRulesPrompt: settings.statusRulesPrompt,
      worldSettingPrompt: settings.worldSettingPrompt,
      messages: [{ id: openingId, role: 'assistant', content: settings.openingMessage || '新的旅程尚未留下文字。', createdAt: now }],
      gameState: { location: settings.location, time: settings.time, contentMode: defaultModeId, values: {} },
      narrative: { chapter: { id: `chapter-${now}`, title: settings.chapterTitle, startedAtMessageId: openingId } },
      memory: { historicalSummary: '', recentChapters: [], recentChapterLimit: 5 },
      rollbackLog: [],
    } satisfies Partial<GameSession>,
    characters: serializedCharacters,
  }
  sections.nsfw = {
    nsfwScenePrompt: settings.nsfwScenePrompt,
  }
  zip.file('rpg.xml', createRpgboxXml(settings.title, sections))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export function downloadPackage(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().slice(0, 60) || '未命名'
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function addPortraits(zip: JSZip, character: CharacterDraft, basePath: string): Promise<SerializedPortrait[]> {
  return Promise.all(character.portraits.flatMap((portrait) => {
    const groups: PortraitGroup[] = portrait.groups ?? ['normal']
    return [async () => {
    const assetPath = `${basePath}/${safePathPart(portrait.id)}.${portrait.extension}`
    zip.file(assetPath, await portrait.file.arrayBuffer(), { compression: 'STORE' })
    const { file: _file, previewUrl: _previewUrl, extension: _extension, ...metadata } = portrait
    return { ...metadata, groups, assetPath }
    }]
  }).map((createPortrait) => createPortrait()))
}

function withoutDraftPortraits(character: CharacterDraft): Omit<CharacterProfile, 'portraits'> {
  const { portraits: _portraits, ...base } = character
  return base
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_') || 'item'
}

function extensionOf(path: string): string {
  return path.match(/\.([a-zA-Z0-9]+)$/u)?.[1]?.toLowerCase() ?? 'png'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function migrateTextRecord(
  source: Partial<Record<string, string>> | undefined,
  removedId: string,
  targetId: string,
): Partial<Record<string, string>> {
  const next = { ...source }
  const removed = next[removedId]?.trim()
  delete next[removedId]
  if (removed) next[targetId] = [next[targetId]?.trim(), removed].filter(Boolean).join('\n')
  return next
}

function decodeXmlAttribute(value: string): string {
  return value.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
}
