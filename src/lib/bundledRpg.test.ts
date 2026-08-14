import { beforeEach, describe, expect, it, vi } from 'vitest'

const importMocks = vi.hoisted(() => ({
  importRpgbox: vi.fn(),
}))

vi.mock('./rpgPackage', () => ({ importRpgbox: importMocks.importRpgbox }))

describe('bundled RPG loading', () => {
  beforeEach(() => {
    importMocks.importRpgbox.mockReset()
  })

  it('returns no games when the build contains no bundled RPG assets', async () => {
    const { loadBundledRpgs } = await import('./bundledRpg')

    await expect(loadBundledRpgs()).resolves.toEqual([])
    expect(importMocks.importRpgbox).not.toHaveBeenCalled()
  })
})
