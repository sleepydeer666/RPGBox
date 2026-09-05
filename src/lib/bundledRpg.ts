import { createBlankGame } from '../game'
import type { GameSession, ProviderProfile } from '../types'
import { savePortraitFile } from './portraits'
import { importRpgboxSections, importRpgboxV2, parseRpgboxXml, type RpgboxV2Manifest } from './rpgPackage'
import { assetUrl } from '../platform/assetUrl'

export interface BundledRpgPackage {
  key: string
  fileName: string
  game: GameSession
}

export interface BundledRpgPreset {
  key: string
  fileName: string
  title: string
  hasNsfw: boolean
  portraitCount: number
}

interface BundledRpgManifestEntry {
  key: string
  fileName: string
  title: string
  hasNsfw: boolean
  formatVersion?: 1 | 2
  xmlUrl?: string
  portraits?: Record<string, string>
  files?: Record<string, string>
}

interface BundledRpgManifest {
  packages: BundledRpgManifestEntry[]
}

export async function listBundledRpgPresets(): Promise<BundledRpgPreset[]> {
  const entries = await loadManifest()
  return entries.map((entry) => ({
    key: entry.key,
    fileName: entry.fileName,
    title: entry.title || titleFromFileName(entry.fileName),
    hasNsfw: entry.hasNsfw,
    portraitCount: entry.formatVersion === 2
      ? Object.keys(entry.files ?? {}).filter((path) => path.startsWith('portraits/')).length
      : Object.keys(entry.portraits ?? {}).length,
  }))
}

export async function importBundledRpg(
  key: string,
  provider?: ProviderProfile,
  onProgress?: (completed: number, total: number) => void,
): Promise<BundledRpgPackage> {
  const entries = await loadManifest()
  const entry = entries.find((item) => item.key === key)
  if (!entry) throw new Error('找不到所选预设 RPG')

  const blank = createBlankGame(1, provider)
  if (entry.formatVersion === 2 && entry.files) {
    const readText = async (path: string) => {
      const url = entry.files?.[path]
      if (!url) return undefined
      const response = await fetch(url)
      if (!response.ok) throw new Error(`读取预设 RPG 文件失败：HTTP ${response.status}`)
      return response.text()
    }
    const manifestText = await readText('manifest.json')
    if (!manifestText) throw new Error('预设 RPG 文件缺少 manifest.json')
    const manifest = JSON.parse(manifestText) as RpgboxV2Manifest
    if (manifest.format !== 'rpgbox' || manifest.version !== 2) throw new Error('不支持的预设 RPG 文件版本')
    return {
      key: entry.key,
      fileName: entry.fileName,
      game: {
        ...await importRpgboxV2(manifest, blank, { onPortraitProgress: onProgress }, readText, async (characterId, assetPath) => {
          const url = entry.files?.[assetPath]
          if (!url) return undefined
          const response = await fetch(url)
          if (!response.ok) throw new Error(`读取预设立绘失败：HTTP ${response.status}`)
          return savePortraitFile(blank.id, characterId, new File([await response.blob()], assetPath.split('/').at(-1) ?? 'portrait.png'))
        }),
        title: entry.title || titleFromFileName(entry.fileName),
      },
    }
  }
  if (!entry.xmlUrl || !entry.portraits) throw new Error('预设 RPG 缺少兼容导入资源')
  const xmlResponse = await fetch(entry.xmlUrl)
  if (!xmlResponse.ok) throw new Error(`读取预设 RPG 失败：HTTP ${xmlResponse.status}`)
  const sections = parseRpgboxXml(await xmlResponse.text())
  const imported = await importRpgboxSections(sections, blank, {
    onPortraitProgress: onProgress,
  }, async (characterId, assetPath) => {
    const url = entry.portraits?.[assetPath]
    if (!url) return undefined
    const response = await fetch(url)
    if (!response.ok) throw new Error(`读取预设立绘失败：HTTP ${response.status}`)
    const fileName = assetPath.split('/').at(-1) ?? 'portrait.png'
    return savePortraitFile(blank.id, characterId, new File([await response.blob()], fileName))
  })

  return {
    key: entry.key,
    fileName: entry.fileName,
    game: {
      ...imported,
      title: entry.title || titleFromFileName(entry.fileName),
    },
  }
}

async function loadManifest(): Promise<BundledRpgManifestEntry[]> {
  try {
    const response = await fetch(assetUrl('bundled-rpg/manifest.json'), { cache: 'no-store' })
    if (!response.ok) return []
    return ((await response.json()) as BundledRpgManifest).packages ?? []
  } catch {
    return []
  }
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/_v\d+\.rpgbox$/iu, '').replace(/\.rpgbox$/iu, '')
}
