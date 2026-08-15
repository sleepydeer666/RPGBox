import { createBlankGame } from '../game'
import type { GameSession, ProviderProfile } from '../types'
import { savePortraitFile } from './portraits'
import { importRpgboxSections, parseRpgboxXml } from './rpgPackage'

export interface BundledRpgPackage {
  key: string
  fileName: string
  game: GameSession
}

interface BundledRpgManifestEntry {
  key: string
  fileName: string
  xmlUrl: string
  portraits: Record<string, string>
}

interface BundledRpgManifest {
  packages: BundledRpgManifestEntry[]
}

export async function loadBundledRpgs(provider?: ProviderProfile, onProgress?: (fileName: string, index: number, total: number, detail?: string) => void): Promise<BundledRpgPackage[]> {
  let entries: BundledRpgManifestEntry[] = []
  try {
    const response = await fetch('/bundled-rpg/manifest.json', { cache: 'no-store' })
    if (!response.ok) return []
    entries = ((await response.json()) as BundledRpgManifest).packages ?? []
  } catch {
    return []
  }

  const packages: BundledRpgPackage[] = []
  for (const [index, entry] of entries.entries()) {
    try {
      onProgress?.(entry.fileName, index + 1, entries.length)
      const xmlResponse = await fetch(entry.xmlUrl)
      if (!xmlResponse.ok) throw new Error(`HTTP ${xmlResponse.status}`)
      const sections = parseRpgboxXml(await xmlResponse.text())
      const blank = createBlankGame(packages.length + 1, provider)
      const imported = await importRpgboxSections(sections, blank, {
        onPortraitProgress: (completed, total) => onProgress?.(entry.fileName, index + 1, entries.length, `立绘 ${completed} / ${total}`),
      }, async (characterId, assetPath) => {
        const url = entry.portraits[assetPath]
        if (!url) return undefined
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const fileName = assetPath.split('/').at(-1) ?? 'portrait.png'
        return savePortraitFile(blank.id, characterId, new File([await response.blob()], fileName))
      })
      packages.push({
        key: entry.key,
        fileName: entry.fileName,
        game: {
          ...imported,
          title: entry.fileName.replace(/_v\d+\.rpgbox$/iu, '').replace(/\.rpgbox$/iu, ''),
        },
      })
    } catch (error) {
      console.error(`Failed to load bundled RPG: ${entry.fileName}`, error)
    }
  }

  return packages
}
