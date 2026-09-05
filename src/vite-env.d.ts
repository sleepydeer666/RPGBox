/// <reference types="vite/client" />

interface Window {
  RpgStorage?: {
    copyPortrait(options: { sourceUri: string; gameId: string; characterId: string; fileName: string }): Promise<{ uri: string }>
  }
  rpgboxDesktop?: {
    platform: 'desktop'
    version: string
    readValue(key: string): Promise<string | null>
    writeValue(key: string, value: string): Promise<void>
    readDataFile(path: string): Promise<string | null>
    writeDataFile(path: string, value: string): Promise<void>
    savePortrait(gameId: string, characterId: string, fileName: string, base64: string): Promise<string>
    readPortrait(uri: string): Promise<string>
    deletePortrait(uri: string): Promise<void>
  }
}
