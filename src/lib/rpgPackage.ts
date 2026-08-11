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

interface PackageSections {
  settings?: Record<string, unknown>
  characters?: SerializedCharacter[]
  nsfw?: { nsfwScenePrompt: string; characterSettings?: SerializedCharacterNsfwSettings[] }
}

export async function listRpgboxFiles(): Promise<string[]> {
  await ensureRpgboxDirectory()
  const result = await Filesystem.readdir({ path: RPGBOX_DIRECTORY, directory: Directory.Documents })
  return result.files
    .filter((file) => file.type === 'file' && file.name.toLocaleLowerCase().endsWith('.rpgbox'))
    .map((file) => file.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
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
        zip.file(assetPath, await readPortraitBase64(portrait.uri), { base64: true })
        const { uri: _uri, ...metadata } = portrait
        portraits.push({ ...metadata, groups: exportedGroups, assetPath })
      }
      const { nsfwDescription: _nsfwDescription, ...shareableCharacter } = character
      sections.characters.push({ ...shareableCharacter, portraits })
    }
  }

  zip.file('rpg.xml', createRpgboxXml(game.title, sections))
  const data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  await ensureRpgboxDirectory()
  const fileName = `${safeFileName(game.title || '未命名RPG')}-${fileStamp()}.rpgbox`
  await Filesystem.writeFile({ path: `${RPGBOX_DIRECTORY}/${fileName}`, data, directory: Directory.Documents, recursive: true })
  return `${RPGBOX_DIRECTORY_LABEL}/${fileName}`
}

export async function importRpgbox(fileName: string, baseGame: GameSession): Promise<GameSession> {
  if (!/^[^/\\]+\.rpgbox$/iu.test(fileName)) throw new Error('无效的 RPGBox 文件名')
  const file = await Filesystem.readFile({ path: `${RPGBOX_DIRECTORY}/${fileName}`, directory: Directory.Documents })
  const base64 = typeof file.data === 'string' ? file.data : await blobToBase64(file.data)
  const zip = await JSZip.loadAsync(base64, { base64: true })
  const xmlFile = zip.file('rpg.xml')
  if (!xmlFile) throw new Error('RPGBox 文件缺少 rpg.xml')
  const sections = parseRpgboxXml(await xmlFile.async('string'))
  let game: GameSession = { ...baseGame }

  if (sections.settings) game = { ...game, ...importSettings(sections.settings) }
  if (sections.nsfw) game.nsfwScenePrompt = sections.nsfw.nsfwScenePrompt ?? ''
  if (sections.characters) {
    const characters: CharacterProfile[] = []
    for (const character of sections.characters) {
      const portraits: CharacterProfile['portraits'] = []
      for (const portrait of character.portraits ?? []) {
        if (!portrait.assetPath.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
        const asset = zip.file(portrait.assetPath)
        if (!asset) continue
        const { assetPath, ...metadata } = portrait
        const uri = await savePortraitBase64(baseGame.id, character.id, await asset.async('base64'), fileExtension(assetPath))
        portraits.push({ ...metadata, uri })
      }
      const { nsfwDescription: _legacyNsfwDescription, ...shareableCharacter } = character as SerializedCharacter & { nsfwDescription?: string }
      characters.push({ ...shareableCharacter, nsfwDescription: '', statusBar: shareableCharacter.statusBar ?? '', portraits })
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
    storyStylePrompt: game.storyStylePrompt,
    statusRulesPrompt: game.statusRulesPrompt ?? '',
    worldSettingPrompt: game.worldSettingPrompt,
    note: game.note,
    messages: game.messages,
    gameState: game.gameState,
    narrative: game.narrative,
    memory: game.memory,
    rollbackLog: game.rollbackLog ?? [],
  }
}

function importSettings(settings: Record<string, unknown>): Partial<GameSession> {
  const allowed = ['systemPrompt', 'storyStylePrompt', 'statusRulesPrompt', 'worldSettingPrompt', 'note', 'messages', 'gameState', 'narrative', 'memory', 'rollbackLog'] as const
  return Object.fromEntries(allowed.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]])) as Partial<GameSession>
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
      : reject(new Error('无法读取 RPGBox 文件'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取 RPGBox 文件'))
    reader.readAsDataURL(blob)
  })
}
