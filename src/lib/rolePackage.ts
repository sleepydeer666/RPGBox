import { Directory, Filesystem } from '@capacitor/filesystem'
import JSZip from 'jszip'
import type { CharacterProfile, PortraitGroup } from '../types'
import { readPortraitBase64, savePortraitBase64 } from './portraits'

export const ROLE_PACKAGE_DIRECTORY = 'RPGBox'
export const ROLE_PACKAGE_DIRECTORY_LABEL = '内部存储/Documents/RPGBox'

export type RolePackageImportSource = string | File

interface SerializedPortrait extends Omit<CharacterProfile['portraits'][number], 'uri'> {
  assetPath: string
}

interface SerializedRole extends Omit<CharacterProfile, 'portraits'> {
  portraits: SerializedPortrait[]
}

export async function listRolePackageFiles(): Promise<string[]> {
  await ensureDirectory()
  const result = await Filesystem.readdir({ path: ROLE_PACKAGE_DIRECTORY, directory: Directory.Documents })
  return result.files
    .filter((file) => file.type === 'file' && file.name.toLocaleLowerCase().endsWith('.role.rpgbox'))
    .map((file) => file.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

export async function exportRolePackage(character: CharacterProfile, includeNsfw: boolean): Promise<string> {
  if (character.role !== 'npc') throw new Error('只能导出 NPC')
  const zip = new JSZip()
  const portraits: SerializedPortrait[] = []
  for (const portrait of character.portraits) {
    const groups: PortraitGroup[] = portrait.groups?.length ? portrait.groups : ['normal']
    const exportedGroups = includeNsfw ? groups : groups.filter((group) => group === 'normal')
    if (!exportedGroups.length) continue
    const assetPath = `portraits/${safePathPart(portrait.id)}.${fileExtension(portrait.uri)}`
    zip.file(assetPath, await readPortraitBase64(portrait.uri), { base64: true })
    const { uri: _uri, ...metadata } = portrait
    portraits.push({ ...metadata, groups: exportedGroups, assetPath })
  }
  const includedIds = new Set(portraits.map((portrait) => portrait.id))
  const { nsfwDescription: sourceNsfwDescription, ...baseCharacter } = structuredClone(character)
  const role: SerializedRole = {
    ...baseCharacter,
    ...(includeNsfw ? { nsfwDescription: sourceNsfwDescription ?? '' } : {}),
    role: 'npc',
    portraits,
    defaultPortraitId: includedIds.has(character.defaultPortraitId ?? '') ? character.defaultPortraitId : undefined,
    defaultPortraitIds: Object.fromEntries(Object.entries(character.defaultPortraitIds ?? {})
      .filter(([group, id]) => (includeNsfw || group === 'normal') && includedIds.has(id ?? ''))),
  }
  zip.file('role.xml', createRoleXml(role))
  const data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  await ensureDirectory()
  const fileName = `${safeFileName(character.name || '未命名NPC')}-${fileStamp()}.role.rpgbox`
  await Filesystem.writeFile({ path: `${ROLE_PACKAGE_DIRECTORY}/${fileName}`, data, directory: Directory.Documents, recursive: true })
  return `${ROLE_PACKAGE_DIRECTORY_LABEL}/${fileName}`
}

export async function importRolePackage(source: RolePackageImportSource, gameId: string, characterId: string): Promise<CharacterProfile> {
  const fileName = typeof source === 'string' ? source : source.name
  if (!/^[^/\\]+\.role\.rpgbox$/iu.test(fileName)) throw new Error('无效的角色包文件名')
  const zip = typeof source === 'string'
    ? await loadFilesystemZip(`${ROLE_PACKAGE_DIRECTORY}/${fileName}`)
    : await JSZip.loadAsync(await source.arrayBuffer())
  const xmlFile = zip.file('role.xml')
  if (!xmlFile) throw new Error('角色包缺少 role.xml')
  const serialized = parseRoleXml(await xmlFile.async('string'))
  const portraits: CharacterProfile['portraits'] = []
  for (const portrait of serialized.portraits ?? []) {
    if (!portrait.assetPath.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
    const asset = zip.file(portrait.assetPath)
    if (!asset) continue
    const { assetPath, ...metadata } = portrait
    const uri = await savePortraitBase64(gameId, characterId, await asset.async('base64'), fileExtension(assetPath))
    portraits.push({ ...metadata, uri })
  }
  const portraitIds = new Set(portraits.map((portrait) => portrait.id))
  return {
    ...serialized,
    id: characterId,
    role: 'npc',
    nsfwDescription: serialized.nsfwDescription ?? '',
    statusBar: serialized.statusBar ?? '',
    portraits,
    defaultPortraitId: portraitIds.has(serialized.defaultPortraitId ?? '') ? serialized.defaultPortraitId : undefined,
    defaultPortraitIds: Object.fromEntries(Object.entries(serialized.defaultPortraitIds ?? {}).filter(([, id]) => portraitIds.has(id ?? ''))),
  }
}

async function loadFilesystemZip(path: string) {
  const file = await Filesystem.readFile({ path, directory: Directory.Documents })
  const base64 = typeof file.data === 'string' ? file.data : await blobToBase64(file.data)
  return JSZip.loadAsync(base64, { base64: true })
}

export function createRoleXml(role: SerializedRole): string {
  const payload = encodeBase64Utf8(JSON.stringify(role))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rpgbox-role version="1" encoding="base64-json">${payload}</rpgbox-role>`
}

export function parseRoleXml(xml: string): SerializedRole {
  const match = xml.match(/<rpgbox-role\b[^>]*\bversion="1"[^>]*\bencoding="base64-json"[^>]*>([A-Za-z0-9+/=\s]+)<\/rpgbox-role>/u)
  if (!match) throw new Error('不支持的角色包版本')
  try {
    const role = JSON.parse(decodeBase64Utf8(match[1].replace(/\s+/gu, ''))) as SerializedRole
    if (!role || typeof role !== 'object' || !Array.isArray(role.portraits)) throw new Error('invalid')
    return role
  } catch {
    throw new Error('角色包数据损坏')
  }
}

async function ensureDirectory() {
  try {
    await Filesystem.mkdir({ path: ROLE_PACKAGE_DIRECTORY, directory: Directory.Documents, recursive: true })
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
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_') || 'portrait'
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().slice(0, 60) || '未命名NPC'
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
      : reject(new Error('无法读取角色包'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取角色包'))
    reader.readAsDataURL(blob)
  })
}
