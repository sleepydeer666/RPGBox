import { Directory, Filesystem } from '@capacitor/filesystem'
import JSZip from 'jszip'
import { copyPortraitFile, readPortraitBase64, savePortraitFile } from './portraits'
import type { CharacterProfile, GameSession, PortraitGroup } from '../types'
import { normalizeGameNarrativeModes } from './narrativeModes'
import { flattenConversationTurns, groupConversationTurns, splitMessagesByChapter, takeRecentConversationTurns, type ConversationTurn } from './chatChunks'
import { BlobWriter, TextWriter } from '@zip.js/zip.js'
import { downloadBlob } from '../platform/browserDownload'
import { isAndroidRuntime } from '../platform/runtime'

export const RPGBOX_DIRECTORY = 'RPGBox'
export const RPGBOX_DIRECTORY_LABEL = isAndroidRuntime() ? '内部存储/Documents/RPGBox' : '浏览器下载目录'

export interface RpgExportOptions {
  settings: boolean
  characters: boolean
  onPortraitProgress?: (completed: number, total: number) => void
}

export type RpgboxImportSource = File

export interface RpgboxImportOptions {
  onPortraitProgress?: (completed: number, total: number) => void
}

interface SerializedPortrait extends Omit<CharacterProfile['portraits'][number], 'uri'> {
  assetPath: string
}

interface SerializedCharacter extends Omit<CharacterProfile, 'portraits'> {
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

interface RpgboxV2Manifest {
  format: 'rpgbox'
  version: 2
  title: string
  sections: { settings?: boolean; characters?: boolean }
}

export async function exportRpgbox(game: GameSession, options: RpgExportOptions): Promise<string> {
  if (!options.settings && !options.characters) throw new Error('请至少选择一项导出内容')
  const zip = new JSZip()
  const manifest: RpgboxV2Manifest = {
    format: 'rpgbox',
    version: 2,
    title: game.title,
    sections: { settings: options.settings, characters: options.characters },
  }
  zip.file('manifest.json', JSON.stringify(manifest))
  if (options.settings) {
    const { messages: _messages, gameState: _gameState, narrative: _narrative, memory: _memory, rollbackLog: _rollbackLog, ...settings } = exportSettings(game)
    zip.file('settings.json', JSON.stringify(settings))
    zip.file('runtime-state.json', JSON.stringify({ gameState: game.gameState, narrative: game.narrative, memory: game.memory, rollbackLog: game.rollbackLog ?? [] }))
    const turns = groupConversationTurns(game.messages)
    const recentTurns = takeRecentConversationTurns(turns, 50)
    const chunks = splitMessagesByChapter(game.messages, 50)
    const chapters: Array<{ id: string; title: string; turnCount: number; parts: string[] }> = []
    let chapter: typeof chapters[number] | undefined
    for (const [index, chunk] of chunks.entries()) {
      const title = chunk.chapterTitle?.trim() || '章节过渡'
      if (!chapter || chapter.title !== title) {
        chapter = { id: `chapter-${String(chapters.length + 1).padStart(6, '0')}`, title, turnCount: 0, parts: [] }
        chapters.push(chapter)
      }
      const path = `chat/chapters/${chapter.id}/part-${String(chapter.parts.length + 1).padStart(6, '0')}.json`
      chapter.parts.push(path)
      chapter.turnCount += chunk.turns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length
      zip.file(path, JSON.stringify({ sequence: index, turns: chunk.turns }))
    }
    zip.file('chat/recent.json', JSON.stringify({ turns: recentTurns }))
    zip.file('chat/chapter-index.json', JSON.stringify({ recentTurnCount: recentTurns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length, chapters }))
  }
  if (options.characters) zip.file('characters.json', JSON.stringify(await serializeCharacters(game, zip, options.onPortraitProgress)))
  await ensureRpgboxDirectory()
  const fileName = `${safeFileName(game.title || '未命名RPG')}-${fileStamp()}.rpgbox`
  const path = `${RPGBOX_DIRECTORY}/${fileName}`
  if (isAndroidRuntime()) {
    await writeZipInChunks(zip, path)
  } else if (typeof document === 'undefined') {
    const data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true })
  } else {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    downloadBlob(blob, fileName)
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
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js')
  const zip = new ZipReader(new BlobReader(source), { useWebWorkers: false })
  try {
    const entries = await zip.getEntries()
    const files = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry]))
    const v2Manifest = files.get('manifest.json')
    if (v2Manifest) {
      const manifest = JSON.parse(await v2Manifest.getData(new TextWriter())) as RpgboxV2Manifest
      if (manifest.format !== 'rpgbox' || manifest.version !== 2) throw new Error('不支持的 RPGBox 文件版本')
      return importRpgboxV2(files, manifest, baseGame, options)
    }
    const xmlFile = files.get('rpg.xml')
    if (!xmlFile || xmlFile.directory) throw new Error('RPGBox 文件缺少 rpg.xml')
    const sections = parseRpgboxXml(await xmlFile.getData(new TextWriter()))
    return importRpgboxSections(sections, baseGame, options, async (characterId, assetPath) => {
      const asset = files.get(assetPath)
      if (!asset || asset.directory) return undefined
      const blob = await asset.getData(new BlobWriter())
      const fileName = assetPath.split('/').at(-1) ?? 'portrait.png'
      return savePortraitFile(baseGame.id, characterId, new File([blob], fileName))
    })
  } finally {
    await zip.close()
  }
}

async function serializeCharacters(game: GameSession, zip: JSZip, onPortraitProgress?: (completed: number, total: number) => void): Promise<SerializedCharacter[]> {
  const characters: SerializedCharacter[] = []
  const totalPortraits = game.characters.reduce((total, character) => total + character.portraits.length, 0)
  let completedPortraits = 0
  if (totalPortraits > 0) onPortraitProgress?.(0, totalPortraits)
  for (const character of game.characters) {
    const portraits: SerializedPortrait[] = []
    for (const portrait of character.portraits) {
      const groups: PortraitGroup[] = portrait.groups ?? ['normal']
      const extension = fileExtension(portrait.uri)
      const assetPath = `portraits/${safePathPart(character.id)}/${safePathPart(portrait.id)}.${extension}`
      zip.file(assetPath, decodeBase64Bytes(await readPortraitBase64(portrait.uri)), { compression: 'STORE' })
      completedPortraits += 1
      if (totalPortraits > 0) onPortraitProgress?.(completedPortraits, totalPortraits)
      const { uri: _uri, ...metadata } = portrait
      portraits.push({ ...metadata, groups, assetPath })
    }
    characters.push({ ...character, modeDescriptions: character.modeDescriptions ?? {}, portraits })
  }
  return characters
}

async function importRpgboxV2(files: Map<string, any>, manifest: RpgboxV2Manifest, baseGame: GameSession, options: RpgboxImportOptions): Promise<GameSession> {
  const readText = async (path: string) => {
    const file = files.get(path)
    return file ? file.getData(new TextWriter()) : undefined
  }
  let game: GameSession = { ...baseGame }
  if (manifest.sections.settings) {
    const settingsText = await readText('settings.json')
    const runtimeText = await readText('runtime-state.json')
    if (!settingsText || !runtimeText) throw new Error('RPGBox 文件缺少设置或运行状态')
    const settings = JSON.parse(settingsText) as Record<string, unknown>
    const runtime = JSON.parse(runtimeText) as Partial<GameSession>
    const recentText = await readText('chat/recent.json')
    const indexText = await readText('chat/chapter-index.json')
    if (!recentText || !indexText) throw new Error('RPGBox 文件缺少聊天记录索引')
    const index = JSON.parse(indexText) as { chapters: Array<{ parts: string[] }> }
    const turns: ConversationTurn[] = []
    for (const chapter of index.chapters ?? []) for (const part of chapter.parts ?? []) {
      const partText = await readText(part)
      if (partText) turns.push(...(JSON.parse(partText) as { turns: ConversationTurn[] }).turns)
    }
    const recent = JSON.parse(recentText) as { turns: ConversationTurn[] }
    const messages = turns.length ? flattenConversationTurns(turns) : flattenConversationTurns(recent.turns)
    game = { ...game, ...importSettings(settings), ...runtime, messages }
  }
  if (manifest.sections.characters) {
    const charactersFile = files.get('characters.json')
    if (!charactersFile) throw new Error('RPGBox 文件缺少角色数据')
    const characters = JSON.parse(await charactersFile.getData(new TextWriter())) as SerializedCharacter[]
    game = await importRpgboxSections({ characters }, game, options, async (characterId, assetPath) => {
      const asset = files.get(assetPath)
      if (!asset) return undefined
      const blob = await asset.getData(new BlobWriter())
      return savePortraitFile(baseGame.id, characterId, new File([blob], assetPath.split('/').at(-1) ?? 'portrait.png'))
    })
  }
  return normalizeGameNarrativeModes({ ...game, id: baseGame.id, updatedAt: Date.now(), rollbackLog: (game.rollbackLog ?? []).slice(-5) })
}

export async function importRpgboxSections(
  sections: PackageSections,
  baseGame: GameSession,
  options: RpgboxImportOptions = {},
  importPortrait?: (characterId: string, assetPath: string) => Promise<string | undefined>,
): Promise<GameSession> {
  let game: GameSession = { ...baseGame }

  if (sections.settings) game = { ...game, ...importSettings(sections.settings) }
  if (sections.nsfw) {
    game.nsfwScenePrompt = sections.nsfw.nsfwScenePrompt ?? ''
  }
  if (sections.characters) {
    const characters: CharacterProfile[] = []
    const portraitTotal = sections.characters.reduce((count, character) => count + (character.portraits?.length ?? 0), 0)
    let portraitCompleted = 0
    options.onPortraitProgress?.(portraitCompleted, portraitTotal)
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
      characters.push({
        ...character,
        modeDescriptions: character.modeDescriptions ?? {},
        statusBar: character.statusBar ?? '',
        portraits,
      })
    }
    if (characters.length) game.characters = characters
  }
  if (sections.nsfw?.characterSettings?.length) {
    game.characters = game.characters.map((character) => {
      const settings = sections.nsfw?.characterSettings?.find((item) => item.id === character.id)
        ?? sections.nsfw?.characterSettings?.find((item) => item.name === character.name)
      return settings ? { ...character, modeDescriptions: { ...character.modeDescriptions, nsfw: settings.nsfwDescription ?? '' } } : character
    })
  }

  return normalizeGameNarrativeModes({ ...game, id: baseGame.id, title: baseGame.title, updatedAt: Date.now(), rollbackLog: (game.rollbackLog ?? []).slice(-5) })
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
    narrativeModes: game.narrativeModes,
    nsfwScenePrompt: game.nsfwScenePrompt,
    newStoryChoiceCount: game.newStoryChoiceCount,
    storyStylePrompt: game.storyStylePrompt,
    modeStoryStylePrompts: game.modeStoryStylePrompts ?? {},
    chapterTransitionRules: game.chapterTransitionRules ?? '',
    narrativeModeRulesPrompt: game.narrativeModeRulesPrompt ?? '',
    recommendedChapterTurnsEnabled: game.recommendedChapterTurnsEnabled ?? false,
    recommendedChapterTurns: game.recommendedChapterTurns ?? 20,
    statusRulesPrompt: game.statusRulesPrompt ?? '',
    clearStatusBarAfterChapter: game.clearStatusBarAfterChapter ?? true,
    worldSettingPrompt: game.worldSettingPrompt,
    messages: game.messages,
    gameState: game.gameState,
    narrative: game.narrative,
    memory: game.memory,
    rollbackLog: game.rollbackLog ?? [],
    showStatusControls: game.showStatusControls ?? true,
  }
}

function importSettings(settings: Record<string, unknown>): Partial<GameSession> {
  const allowed = ['systemPrompt', 'narrativeModes', 'newStoryChoiceCount', 'storyStylePrompt', 'modeStoryStylePrompts', 'chapterTransitionRules', 'narrativeModeRulesPrompt', 'recommendedChapterTurnsEnabled', 'recommendedChapterTurns', 'statusRulesPrompt', 'clearStatusBarAfterChapter', 'nsfwScenePrompt', 'worldSettingPrompt', 'showStatusControls', 'messages', 'gameState', 'narrative', 'memory', 'rollbackLog'] as const
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

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
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
