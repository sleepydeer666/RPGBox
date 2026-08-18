import JSZip from 'jszip'
import { createRoleXml, parseRoleXml } from '../lib/rolePackage'
import { createRpgboxXml, parseRpgboxXml, type PackageSections } from '../lib/rpgPackage'
import type { CharacterProfile, CharacterPortrait, GameSession, PortraitGroup } from '../types'

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

interface SerializedCharacter extends Omit<CharacterProfile, 'portraits' | 'nsfwDescription'> {
  portraits: SerializedPortrait[]
}

export interface RpgDraftSettings {
  title: string
  nsfwEnabled: boolean
  newStoryChoiceCount: number
  storyStylePrompt: string
  chapterTransitionRules: string
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

export function groupsForExpression(expression: string): PortraitGroup[] {
  const normalized = expression.trim()
  if (normalized === '性高潮' || normalized === '大笑') return ['nsfw']
  if (normalized === '羞耻') return ['normal', 'nsfw']
  return ['normal']
}

export function importBatchPortraits(files: File[], characterName: string, idFactory = createId): BatchPortraitResult {
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
      groups: groupsForExpression(expression),
      file,
      extension: 'png',
      previewUrl: URL.createObjectURL(file),
    })
  }

  return { portraits, imported: portraits.length, failed }
}

export function applyMissingDefaults(character: CharacterDraft): CharacterDraft {
  const currentNormal = character.defaultPortraitIds?.normal ?? character.defaultPortraitId
  const currentNsfw = character.defaultPortraitIds?.nsfw
  const normalPortraits = character.portraits.filter((portrait) => portrait.groups?.includes('normal'))
  const nsfwPortraits = character.portraits.filter((portrait) => portrait.groups?.includes('nsfw'))
  const normalDefault = currentNormal || normalPortraits.find(hasNormalTag)?.id || normalPortraits[0]?.id
  const nsfwDefault = currentNsfw || nsfwPortraits.find(hasShyTag)?.id || nsfwPortraits[0]?.id
  return {
    ...character,
    defaultPortraitId: normalDefault,
    defaultPortraitIds: {
      ...character.defaultPortraitIds,
      ...(normalDefault ? { normal: normalDefault } : {}),
      ...(nsfwDefault ? { nsfw: nsfwDefault } : {}),
    },
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
    const { assetPath, uri: _legacyUri, ...metadata } = portrait as typeof portrait & { uri?: string }
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
    nsfwDescription: role.nsfwDescription ?? '',
    statusBar: role.statusBar ?? '',
    portraits,
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
      nsfwDescription: nsfwSettings?.nsfwDescription ?? '',
      statusBar: serialized.statusBar ?? '',
      portraits,
    })
  }

  return {
    settings: {
      title: titleAttribute ? decodeXmlAttribute(titleAttribute) : file.name.replace(/\.rpgbox$/iu, ''),
      nsfwEnabled: Boolean(sourceSettings.nsfwEnabled || sections.nsfw),
      newStoryChoiceCount: numberValue(sourceSettings.newStoryChoiceCount),
      storyStylePrompt: stringValue(sourceSettings.storyStylePrompt),
      chapterTransitionRules: stringValue(sourceSettings.chapterTransitionRules),
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
  const portraits = await addPortraits(zip, character, `portraits`, true)
  const role = { ...withoutDraftPortraits(character), role: 'npc' as const, portraits }
  zip.file('role.xml', createRoleXml(role))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function buildRpgPackage(settings: RpgDraftSettings, player: CharacterDraft, participants: CharacterDraft[]): Promise<Blob> {
  if (!settings.title.trim()) throw new Error('请填写 RPG 名称')
  const zip = new JSZip()
  const characters = [player, ...participants]
  const serializedCharacters: SerializedCharacter[] = await Promise.all(characters.map(async (character) => {
    const { nsfwDescription: _nsfwDescription, ...base } = withoutDraftPortraits(character)
    const portraits = await addPortraits(zip, character, `portraits/${safePathPart(character.id)}`, settings.nsfwEnabled)
    const includedIds = new Set(portraits.map((portrait) => portrait.id))
    return {
      ...base,
      portraits,
      defaultPortraitId: includedIds.has(base.defaultPortraitId ?? '') ? base.defaultPortraitId : undefined,
      defaultPortraitIds: Object.fromEntries(Object.entries(base.defaultPortraitIds ?? {})
        .filter(([group, id]) => (settings.nsfwEnabled || group === 'normal') && includedIds.has(id ?? ''))),
    }
  }))
  const now = Date.now()
  const openingId = `opening-${now}`
  const sections: PackageSections = {
    settings: {
      systemPrompt: settings.storyStylePrompt,
      nsfwEnabled: settings.nsfwEnabled,
      newStoryChoiceCount: clamp(settings.newStoryChoiceCount, 4, 10),
      storyStylePrompt: settings.storyStylePrompt,
      chapterTransitionRules: settings.chapterTransitionRules,
      recommendedChapterTurnsEnabled: settings.recommendedChapterTurnsEnabled,
      recommendedChapterTurns: clamp(settings.recommendedChapterTurns, 10, 30),
      statusRulesPrompt: settings.statusRulesPrompt,
      worldSettingPrompt: settings.worldSettingPrompt,
      messages: [{ id: openingId, role: 'assistant', content: settings.openingMessage || '新的旅程尚未留下文字。', createdAt: now }],
      gameState: { location: settings.location, time: settings.time, contentMode: 'normal', values: {} },
      narrative: { chapter: { id: `chapter-${now}`, title: settings.chapterTitle, startedAtMessageId: openingId } },
      memory: { historicalSummary: '', recentChapters: [], recentChapterLimit: 5 },
      rollbackLog: [],
    } satisfies Partial<GameSession>,
    characters: serializedCharacters,
  }
  if (settings.nsfwEnabled) {
    sections.nsfw = {
      nsfwScenePrompt: settings.nsfwScenePrompt,
      characterSettings: characters.map((character) => ({ id: character.id, name: character.name, nsfwDescription: character.nsfwDescription ?? '' })),
    }
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

async function addPortraits(zip: JSZip, character: CharacterDraft, basePath: string, includeNsfw: boolean): Promise<SerializedPortrait[]> {
  return Promise.all(character.portraits.flatMap((portrait) => {
    const groups: PortraitGroup[] = portrait.groups?.length ? portrait.groups : ['normal']
    const exportedGroups = includeNsfw ? groups : groups.filter((group) => group === 'normal')
    if (!exportedGroups.length) return []
    return [async () => {
    const assetPath = `${basePath}/${safePathPart(portrait.id)}.${portrait.extension}`
    zip.file(assetPath, await portrait.file.arrayBuffer(), { compression: 'STORE' })
    const { file: _file, previewUrl: _previewUrl, extension: _extension, ...metadata } = portrait
    return { ...metadata, groups: exportedGroups, assetPath }
    }]
  }).map((createPortrait) => createPortrait()))
}

function withoutDraftPortraits(character: CharacterDraft): Omit<CharacterProfile, 'portraits'> {
  const { portraits: _portraits, ...base } = character
  return base
}

function hasNormalTag(portrait: PortraitDraft): boolean {
  return portrait.expression.trim() === '正常' || portrait.tags?.some((tag) => tag.trim() === '正常') === true
}

function hasShyTag(portrait: PortraitDraft): boolean {
  return portrait.expression.trim() === '羞耻' || portrait.tags?.some((tag) => tag.trim() === '羞耻') === true
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

function decodeXmlAttribute(value: string): string {
  return value.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
}
