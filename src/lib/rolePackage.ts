import { Directory, Filesystem } from '@capacitor/filesystem'
import JSZip from 'jszip'
import type { CharacterProfile, NarrativeMode } from '../types'
import { readPortraitBase64, savePortraitBase64 } from './portraits'
import { downloadBlob } from '../platform/browserDownload'
import { isAndroidRuntime } from '../platform/runtime'

export const ROLE_PACKAGE_DIRECTORY = 'RPGBox'
export const ROLE_PACKAGE_DIRECTORY_LABEL = isAndroidRuntime() ? '内部存储/Documents/RPGBox' : '浏览器下载目录'

export type RolePackageImportSource = File

export async function inspectRolePackage(source: RolePackageImportSource): Promise<{ name: string }> {
  const fileName = source.name
  if (!/^[^/\\]+\.role\.rpgbox$/iu.test(fileName)) throw new Error('无效的角色包文件名')
  const zip = await JSZip.loadAsync(await source.arrayBuffer())
  const xmlFile = zip.file('role.xml')
  if (!xmlFile) throw new Error('角色包缺少 role.xml')
  const serialized = parseRoleXml(await xmlFile.async('string'))
  return { name: serialized.name ?? '' }
}

interface SerializedPortrait extends Omit<CharacterProfile['portraits'][number], 'uri'> {
  assetPath: string
}

interface SerializedRole extends Omit<CharacterProfile, 'portraits'> {
  narrativeModes?: NarrativeMode[]
  portraits: SerializedPortrait[]
}

export async function exportRolePackage(character: CharacterProfile, narrativeModes?: NarrativeMode[]): Promise<string> {
  if (character.role !== 'npc') throw new Error('只能导出 NPC')
  const zip = new JSZip()
  const portraits: SerializedPortrait[] = []
  for (const portrait of character.portraits) {
    const assetPath = `portraits/${safePathPart(portrait.id)}.${fileExtension(portrait.uri)}`
    zip.file(assetPath, await readPortraitBase64(portrait.uri), { base64: true })
    const { uri: _uri, ...metadata } = portrait
    portraits.push({ ...metadata, assetPath })
  }
  const includedIds = new Set(portraits.map((portrait) => portrait.id))
  const portableCharacter = structuredClone(character)
  const role: SerializedRole = {
    ...portableCharacter,
    role: 'npc',
    portraits,
    narrativeModes: narrativeModes?.map((mode) => ({ ...mode })),
    defaultPortraitId: includedIds.has(character.defaultPortraitId ?? '') ? character.defaultPortraitId : undefined,
    defaultPortraitIds: Object.fromEntries(Object.entries(character.defaultPortraitIds ?? {}).filter(([, id]) => includedIds.has(id ?? ''))),
  }
  zip.file('role.xml', createRoleXml(role))
  const fileName = `${safeFileName(character.name || '未命名NPC')}-${fileStamp()}.role.rpgbox`
  if (isAndroidRuntime() || typeof document === 'undefined') {
    const data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    await ensureDirectory()
    await Filesystem.writeFile({ path: `${ROLE_PACKAGE_DIRECTORY}/${fileName}`, data, directory: Directory.Documents, recursive: true })
  } else {
    downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), fileName)
  }
  return `${ROLE_PACKAGE_DIRECTORY_LABEL}/${fileName}`
}

export async function importRolePackage(source: RolePackageImportSource, gameId: string, characterId: string, targetModes?: NarrativeMode[]): Promise<CharacterProfile> {
  const fileName = source.name
  if (!/^[^/\\]+\.role\.rpgbox$/iu.test(fileName)) throw new Error('无效的角色包文件名')
  const zip = await JSZip.loadAsync(await source.arrayBuffer())
  const xmlFile = zip.file('role.xml')
  if (!xmlFile) throw new Error('角色包缺少 role.xml')
  const serialized = parseRoleXml(await xmlFile.async('string'))
  const modeMap = createModeNameMap(serialized.narrativeModes, targetModes)
  const portraits: CharacterProfile['portraits'] = []
  for (const portrait of serialized.portraits ?? []) {
    if (!portrait.assetPath.startsWith('portraits/') || portrait.assetPath.includes('..')) continue
    const asset = zip.file(portrait.assetPath)
    if (!asset) continue
    const { assetPath, groups: sourceGroups, ...metadata } = portrait
    const groups = sourceGroups?.flatMap((group) => modeMap.get(group) ?? []).filter((group, index, values) => values.indexOf(group) === index)
    if (serialized.narrativeModes?.length && targetModes && !groups?.length) continue
    const uri = await savePortraitBase64(gameId, characterId, await asset.async('base64'), fileExtension(assetPath))
    portraits.push({ ...metadata, groups: groups?.length ? groups : undefined, uri })
  }
  const portraitIds = new Set(portraits.map((portrait) => portrait.id))
  const legacySerialized = serialized as typeof serialized & { nsfwDescription?: string }
  const { nsfwDescription, narrativeModes: _narrativeModes, ...serializedWithoutNsfwDescription } = legacySerialized
  const modeDescriptions = Object.fromEntries(Object.entries(serialized.modeDescriptions ?? {})
    .flatMap(([group, description]) => modeMap.has(group) ? [[modeMap.get(group)!, description]] : []))
  const defaultPortraitIds = Object.fromEntries(Object.entries(serialized.defaultPortraitIds ?? {})
    .flatMap(([group, portraitId]) => modeMap.has(group) && portraitIds.has(portraitId ?? '') ? [[modeMap.get(group)!, portraitId]] : []))
  const defaultPortraitId = modeMap.get(serialized.narrativeModes?.[0]?.id ?? '')
    ? defaultPortraitIds[modeMap.get(serialized.narrativeModes?.[0]?.id ?? '')!]
    : serialized.defaultPortraitId
  return {
    ...serializedWithoutNsfwDescription,
    id: characterId,
    role: 'npc',
    modeDescriptions,
    statusBar: serialized.statusBar ?? '',
    portraits,
    defaultPortraitId: portraitIds.has(defaultPortraitId ?? '') ? defaultPortraitId : undefined,
    defaultPortraitIds,
  }
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

function createModeNameMap(sourceModes: NarrativeMode[] | undefined, targetModes: NarrativeMode[] | undefined): Map<string, string> {
  if (!sourceModes?.length) return new Map([['normal', targetModes?.[0]?.id ?? 'normal']])
  if (!targetModes?.length) return new Map(sourceModes.map((mode) => [mode.id, mode.id]))
  const targetByName = new Map(targetModes.map((mode) => [mode.name, mode.id]))
  return new Map(sourceModes.flatMap((mode) => {
    const targetId = targetByName.get(mode.name)
    return targetId ? [[mode.id, targetId] as const] : []
  }))
}
