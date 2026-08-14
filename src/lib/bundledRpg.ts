import { createBlankGame } from '../game'
import type { GameSession, ProviderProfile } from '../types'
import { importRpgbox } from './rpgPackage'

const bundledRpgUrls = import.meta.glob('../assets/default-rpg/*.rpgbox', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

export async function loadBundledRpgs(provider?: ProviderProfile): Promise<GameSession[]> {
  const entries = Object.entries(bundledRpgUrls).sort(([left], [right]) => left.localeCompare(right))
  const games: GameSession[] = []

  for (const [path, url] of entries) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const fileName = path.split('/').at(-1) ?? 'default.rpgbox'
      const file = new File([await response.blob()], fileName)
      const blank = createBlankGame(games.length + 1, provider)
      const imported = await importRpgbox(file, blank)
      games.push({
        ...imported,
        title: fileName.replace(/_v\d+\.rpgbox$/iu, '').replace(/\.rpgbox$/iu, ''),
      })
    } catch (error) {
      console.error(`Failed to load bundled RPG: ${path}`, error)
    }
  }

  return games
}
