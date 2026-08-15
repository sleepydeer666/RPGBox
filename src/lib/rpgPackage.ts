import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import JSZip from 'jszip'
import { copyPortraitFile, readPortraitBase64, savePortraitBase64 } from './portraits'
import type { CharacterProfile, GameSession, PortraitGroup } from '../types'

export const RPGBOX_DIRECTORY = 'RPGBox'
export const RPGBOX_DIRECTORY_LABEL = '内部存储/Documents/RPGBox'

export interface RpgExportOptions {
  settings: boolean
  characters: boolean
  nsfw: boolean
}

export type RpgboxImportSource = File

export interface RpgboxImportOptions {
  onPortraitProgress?: (completed: number, total: number) => void
}

interface SerializedPortrait extends Omit<CharacterProfile['portraits'][number], 'uri'> {
  assetPath: string
}

interface SerializedCharacter extends Omit<CharacterProfile, 'portraits' | 'nsfwDescription'> {
  portraits: SerializedPortrait[]
}

interface SerializedCharacterNsfwSettings {
  id: string
  name: string
  nsfwDescription: string
}

export interface PackageSections {
  settings?: Record<string, unknown>
  characters?: SerializedCharacter[]
  nsfw?: { nsfwScenePrompt: string; characterSettings?: SerializedCharacterNsfwSettings[] }
}

export async function exportRpgbox(game: GameSession, options: RpgExportOptions): Promise<string> {
  if (!options.settings && !options.characters && !options.nsfw) throw new Error('请至少选择一项导出内容')
  const zip = new JSZip()
  const sections: PackageSections = {}

  if (options.settings) sections.settings = exportSettings(game)
  if (options.nsfw) sections.nsfw = {
    nsfwScenePrompt: game.nsfwScenePrompt,
    characterSettings: game.characters.map(({ id, name, nsfwDescription }) => ({ id, name, nsfwDescription: nsfwDescription ?? '' })),
  }
  if (options.characters) {
    sections.characters = []
    for (const character of game.characters) {
      const portraits: SerializedPortrait[] = []
      for (const portrait of character.portraits) {
        const groups: PortraitGroup[] = portrait.groups?.length ? portrait.groups : ['normal']
        const exportedGroups = options.nsfw ? groups : groups.filter((group) => group === 'normal')
        if (!exportedGroups.length) continue
        const extension = fileExtension(portrait.uri)
        const assetPath = `portraits/${safePathPart(character.id)}/${safePathPart(portrait.id)}.${extension}`
        // Portraits are already compressed image files; storing them avoids a costly DEFLATE pass.
        zip.file(assetPath, await readPortraitBase64(portrait.uri), { base64: true, compression: 'STORE' })
        const { uri: _uri, ...metadata } = portrait
        portraits.push({ ...metadata, groups: exportedGroups, assetPath })
      }
      const { nsfwDescription: _nsfwDescription, ...shareableCharacter } = character
      sections.characters.push({ ...shareableCharacter, portraits })
    }
  }

  zip.file('rpg.xml', createRpgboxXml(game.title, sections))
  await ensureRpgboxDirectory()
  const fileName = `${safeFileName(game.title || '未命名RPG')}-${fileStamp()}.rpgbox`
  const path = `${RPGBOX_DIRECTORY}/${fileName}`
  if (Capacitor.isNativePlatform()) {
    await writeZipInChunks(zip, path)
  } else {
    const data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true })
  }
  return `${RPGBOX_DIRECTORY_LABEL}/${fileName}`
}

async function writeZipInChunks(zip: JSZip, path: string): Promise<void> {
  const stream = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'STORE' })
  await new Promise<void>((resolve, reject) => {
    let firstChunk = true
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    stream.on('data', (chunk) => {
      stream.pause()
      const data = encodeBase64Bytes(chunk)
      const write = firstChunk
        ? Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true })
        : Filesystem.appendFile({ path, data, directory: Directory.Documents })
      write.then(() => {
        firstChunk = false
        stream.resume()
      }).catch(fail)
    })
    stream.on('error', fail)
    stream.on('end', () => {
      if (!settled) {
        settled = true
        resolve()
      }
    })
    stream.resume()
  })
}

export async function importRpgbox(source: RpgboxImportSource, baseGame: GameSession, options: RpgboxImportOptions = {}): Promise<GameSession> {
  const fileName = source.name
  if (!/^[^/\\]+\.rpgbox$/iu.test(fileName)) throw new Error('无效的 RPGBox 文件名')
  const zipInput = typeof window === 'undefined' ? await source.arrayBuffer() : source
  const zip = await JSZip.loadAsync(zipInput)
  const xmlFile = zip.file('rpg.xml')
  if (!xmlFile) throw new Error('RPGBox 文件缺少 rpg.xml')
  const sections = parseRpgboxXml(await xmlFile.async('string'))
  return importRpgboxSections(sections, baseGame, options, async (characterId, assetPath) => {
    const asset = zip.file(assetPath)
    if (!asset) return undefined
    return savePortraitBase64(baseGame.id, characterId, await asset.async('base64'), fileExtension(assetPath))
  })
}

export async function importRpgboxSections(
  sections: PackageSections,
  baseGame: GameSession,
  options: RpgboxImportOptions = {},
  importPortrait?: (characterId: string, assetPath: string) => Promise<string | undefined>,
): Promise<GameSession> {
  let game: GameSession = { ...baseGame }

  if (sections.settings) game = { ...game, ...importSettings(sections.settings) }
  if (sections.nsfw) game.nsfwScenePrompt = sections.nsfw.nsfwScenePrompt ?? ''
  if (sections.characters) {
    const characters: CharacterProfile[] = []
    const portraitTotal = sections.characters.reduce((count, character) => count + (character.portraits?.length ?? 0), 0)
    let portraitCompleted = 0
    for (const character of sections.characters) {
      const portraits: CharacterProfile['portraits'] = []
      for (const portrait of character.portraits ?? []) {
        if (!portrait.assetPath.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
        const { assetPath, ...metadata } = portrait
        const uri = await importPortrait?.(character.id, assetPath)
        if (!uri) continue
        portraits.push({ ...metadata, uri })
        portraitCompleted += 1
        options.onPortraitProgress?.(portraitCompleted, portraitTotal)
      }
      const { nsfwDescription: _legacyNsfwDescription, ...shareableCharacter } = character as SerializedCharacter & { nsfwDescription?: string }
      characters.push({
        ...shareableCharacter,
        nsfwDescription: '',
        statusBar: shareableCharacter.statusBar ?? '',
        portraits,
      })
    }
    if (characters.length) game.characters = characters
  }
  if (sections.nsfw?.characterSettings?.length) {
    game.characters = game.characters.map((character) => {
      const settings = sections.nsfw?.characterSettings?.find((item) => item.id === character.id)
        ?? sections.nsfw?.characterSettings?.find((item) => item.name === character.name)
      return settings ? { ...character, nsfwDescription: settings.nsfwDescription ?? '' } : character
    })
  }

  return { ...game, id: baseGame.id, title: baseGame.title, updatedAt: Date.now(), rollbackLog: (game.rollbackLog ?? []).slice(-5) }
}

export async function cloneGameSession(game: GameSession, id: string, title: string): Promise<GameSession> {
  const clone = structuredClone(game)
  clone.id = id
  clone.title = title
  clone.updatedAt = Date.now()
  for (const character of clone.characters) {
    for (const portrait of character.portraits) {
      portrait.uri = await copyPortraitFile(portrait.uri, id, character.id)
    }
  }
  return clone
}

export function createRpgboxXml(title: string, sections: PackageSections): string {
  const payloads = Object.entries(sections).filter(([, value]) => value !== undefined)
    .map(([name, value]) => `  <section name="${name}" encoding="base64-json">${encodeBase64Utf8(JSON.stringify(value))}</section>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rpgbox version="1" title="${escapeXml(title)}">\n${payloads}\n</rpgbox>`
}

export function parseRpgboxXml(xml: string): PackageSections {
  if (!/<rpgbox\b[^>]*\bversion="1"[^>]*>/u.test(xml)) throw new Error('不支持的 RPGBox 文件版本')
  const sections: PackageSections = {}
  for (const match of xml.matchAll(/<section\s+name="(settings|characters|nsfw)"\s+encoding="base64-json">([A-Za-z0-9+/=\s]+)<\/section>/gu)) {
    try {
      const value = JSON.parse(decodeBase64Utf8(match[2].replace(/\s+/gu, '')))
      if (match[1] === 'settings') sections.settings = value
      if (match[1] === 'characters') sections.characters = value
      if (match[1] === 'nsfw') sections.nsfw = value
    } catch {
      throw new Error(`RPGBox 文件中的 ${match[1]} 数据损坏`)
    }
  }
  if (!Object.keys(sections).length) throw new Error('RPGBox 文件没有可导入内容')
  return sections
}

function exportSettings(game: GameSession): Record<string, unknown> {
  return {
    systemPrompt: game.systemPrompt,
    nsfwEnabled: game.nsfwEnabled,
    newStoryChoiceCount: game.newStoryChoiceCount,
    storyStylePrompt: game.storyStylePrompt,
    chapterTransitionRules: game.chapterTransitionRules ?? '',
    recommendedChapterTurnsEnabled: game.recommendedChapterTurnsEnabled ?? false,
    recommendedChapterTurns: game.recommendedChapterTurns ?? 20,
    statusRulesPrompt: game.statusRulesPrompt ?? '',
    worldSettingPrompt: game.worldSettingPrompt,
    messages: game.messages,
    gameState: game.gameState,
    narrative: game.narrative,
    memory: game.memory,
    rollbackLog: game.rollbackLog ?? [],
  }
}

function importSettings(settings: Record<string, unknown>): Partial<GameSession> {
  const allowed = ['systemPrompt', 'nsfwEnabled', 'newStoryChoiceCount', 'storyStylePrompt', 'chapterTransitionRules', 'recommendedChapterTurnsEnabled', 'recommendedChapterTurns', 'statusRulesPrompt', 'worldSettingPrompt', 'messages', 'gameState', 'narrative', 'memory', 'rollbackLog'] as const
  const imported = Object.fromEntries(allowed.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]])) as Partial<GameSession>
  if (settings.newStoryChoiceCount !== undefined) {
    const parsed = Number(settings.newStoryChoiceCount)
    imported.newStoryChoiceCount = Number.isFinite(parsed) ? Math.min(10, Math.max(4, Math.round(parsed))) : 4
  }
  if (settings.recommendedChapterTurns !== undefined) {
    const parsed = Number(settings.recommendedChapterTurns)
    imported.recommendedChapterTurns = Number.isFinite(parsed) ? Math.min(30, Math.max(10, Math.round(parsed))) : 20
  }
  return imported
}

async function ensureRpgboxDirectory() {
  try {
    await Filesystem.mkdir({ path: RPGBOX_DIRECTORY, directory: Directory.Documents, recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/exist/iu.test(message)) throw error
  }
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_') || 'item'
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().slice(0, 60) || '未命名RPG'
}

function fileExtension(path: string): string {
  return path.split(/[?#]/u)[0].match(/\.([a-zA-Z0-9]+)$/u)?.[1]?.toLowerCase() ?? 'png'
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, '').replace('T', '-')
}
