import { registerPlugin } from '@capacitor/core'

export interface RpgStoragePlugin {
  copyPortrait(options: { sourceUri: string; gameId: string; characterId: string; fileName: string }): Promise<{ uri: string }>
}

export const RpgStorage = registerPlugin<RpgStoragePlugin>('RpgStorage')
