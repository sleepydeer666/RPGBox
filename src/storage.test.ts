import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from './game'
import { loadState } from './storage'

const preferenceMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferenceMocks,
}))

describe('RPG NSFW setting migration', () => {
  beforeEach(() => {
    preferenceMocks.get.mockReset()
    preferenceMocks.set.mockReset()
  })

  it('keeps newly created RPGs disabled by default', () => {
    expect(createBlankGame(1).nsfwEnabled).toBe(false)
  })

  it('keeps legacy RPG behavior enabled when the saved flag is absent', async () => {
    const legacy = createBlankGame(1) as Partial<ReturnType<typeof createBlankGame>>
    delete legacy.nsfwEnabled
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [legacy], activeGameId: legacy.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.[0].nsfwEnabled).toBe(true)
  })

  it('preserves an explicitly disabled saved RPG', async () => {
    const game = createBlankGame(1)
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [game], activeGameId: game.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.[0].nsfwEnabled).toBe(false)
  })
})
