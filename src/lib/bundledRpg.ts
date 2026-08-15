import { createBlankGame } from '../game'
import type { GameSession, ProviderProfile } from '../types'
import { savePortraitFile } from './portraits'
import { importRpgboxSections, parseRpgboxXml } from './rpgPackage'

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
  xmlUrl: string
  portraits: Record<string, string>
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
    portraitCount: Object.keys(entry.portraits).length,
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

  const xmlResponse = await fetch(entry.xmlUrl)
  if (!xmlResponse.ok) throw new Error(`读取预设 RPG 失败：HTTP ${xmlResponse.status}`)
  const sections = parseRpgboxXml(await xmlResponse.text())
  const blank = createBlankGame(1, provider)
  const imported = await importRpgboxSections(sections, blank, {
    onPortraitProgress: onProgress,
  }, async (characterId, assetPath) => {
    const url = entry.portraits[assetPath]
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
    const response = await fetch('/bundled-rpg/manifest.json', { cache: 'no-store' })
    if (!response.ok) return []
    return ((await response.json()) as BundledRpgManifest).packages ?? []
  } catch {
    return []
  }
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/_v\d+\.rpgbox$/iu, '').replace(/\.rpgbox$/iu, '')
}
