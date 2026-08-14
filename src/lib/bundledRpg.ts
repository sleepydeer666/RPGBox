import { createBlankGame } from '../game'
import type { GameSession, ProviderProfile } from '../types'
import { importRpgbox } from './rpgPackage'

export interface BundledRpgPackage {
  key: string
  fileName: string
  game: GameSession
}

const bundledRpgUrls = import.meta.glob('../assets/default-rpg/*.rpgbox', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

export async function loadBundledRpgs(provider?: ProviderProfile, onProgress?: (fileName: string, index: number, total: number) => void): Promise<BundledRpgPackage[]> {
  const entries = Object.entries(bundledRpgUrls).sort(([left], [right]) => left.localeCompare(right))
  const packages: BundledRpgPackage[] = []

  for (const [index, [path, url]] of entries.entries()) {
    try {
      const fileName = path.split('/').at(-1) ?? 'default.rpgbox'
      onProgress?.(fileName, index + 1, entries.length)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const file = new File([await response.blob()], fileName)
      const blank = createBlankGame(packages.length + 1, provider)
      const imported = await importRpgbox(file, blank)
      packages.push({
        key: `file:${fileName}`,
        fileName,
        game: {
          ...imported,
          title: fileName.replace(/_v\d+\.rpgbox$/iu, '').replace(/\.rpgbox$/iu, ''),
        },
      })
    } catch (error) {
      console.error(`Failed to load bundled RPG: ${path}`, error)
    }
  }

  return packages
}
