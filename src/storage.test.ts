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

  it('keeps an empty library empty instead of restoring the sample RPG', async () => {
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [], activeGameId: '' }),
    })

    const loaded = await loadState()
    expect(loaded.games).toEqual([])
    expect(loaded.activeGameId).toBe('')
  })

  it('keeps legacy RPG behavior enabled when the saved flag is absent', async () => {
    const legacy = createBlankGame(1) as Partial<ReturnType<typeof createBlankGame>>
    delete legacy.nsfwEnabled
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [legacy], activeGameId: legacy.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.[0].nsfwEnabled).toBe(true)
    expect(loaded.games?.[0].newStoryChoiceCount).toBe(4)
    expect(loaded.games?.[0].chapterTransitionRules).toBe('')
    expect(loaded.games?.[0].recommendedChapterTurnsEnabled).toBe(false)
    expect(loaded.games?.[0].recommendedChapterTurns).toBe(20)
    expect(loaded.games?.[0].aiSettings.warnOnProtocolAnomaly).toBe(false)
  })

  it('preserves an explicitly disabled saved RPG', async () => {
    const game = createBlankGame(1)
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [game], activeGameId: game.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.[0].nsfwEnabled).toBe(false)
  })

  it('defaults the format warning to disabled for older saved RPGs', async () => {
    const game = createBlankGame(1)
    delete (game.aiSettings as Partial<typeof game.aiSettings>).warnOnProtocolAnomaly
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [game], activeGameId: game.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.[0].aiSettings.warnOnProtocolAnomaly).toBe(false)
  })

  it('normalizes invalid and out-of-range new-story choice counts', async () => {
    const invalid = { ...createBlankGame(1), id: 'invalid', newStoryChoiceCount: Number.NaN }
    const tooLarge = { ...createBlankGame(2), id: 'large', newStoryChoiceCount: 99 }
    preferenceMocks.get.mockResolvedValue({
      value: JSON.stringify({ games: [invalid, tooLarge], activeGameId: invalid.id }),
    })

    const loaded = await loadState()
    expect(loaded.games?.map((game) => game.newStoryChoiceCount)).toEqual([4, 10])
  })
})
