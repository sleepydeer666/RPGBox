import { beforeEach, describe, expect, it, vi } from 'vitest'

const importMocks = vi.hoisted(() => ({
  importRpgboxSections: vi.fn(),
  parseRpgboxXml: vi.fn(),
  savePortraitFile: vi.fn(),
}))

vi.mock('./rpgPackage', () => ({
  importRpgboxSections: importMocks.importRpgboxSections,
  parseRpgboxXml: importMocks.parseRpgboxXml,
}))
vi.mock('./portraits', () => ({ savePortraitFile: importMocks.savePortraitFile }))

describe('bundled RPG loading', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    importMocks.importRpgboxSections.mockReset()
    importMocks.parseRpgboxXml.mockReset()
    importMocks.savePortraitFile.mockReset()
  })

  it('returns no games when the build contains no bundled RPG assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packages: [] }) }))
    const { loadBundledRpgs } = await import('./bundledRpg')

    await expect(loadBundledRpgs()).resolves.toEqual([])
    expect(importMocks.importRpgboxSections).not.toHaveBeenCalled()
  })

  it('loads extracted XML and portraits one asset at a time', async () => {
    const sections = { characters: [] }
    const importedGame = { id: 'new-game', title: 'New RPG' }
    const responses = [
      { ok: true, json: async () => ({ packages: [{ key: 'file:sample.rpgbox', fileName: 'Sample_v2.rpgbox', xmlUrl: '/bundled-rpg/package-1/rpg.xml', portraits: { 'portraits/hero/normal.png': '/bundled-rpg/package-1/portraits/hero/normal.png' } }] }) },
      { ok: true, text: async () => '<rpgbox />' },
      { ok: true, blob: async () => new Blob(['portrait']) },
    ]
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift())
    vi.stubGlobal('fetch', fetchMock)
    importMocks.parseRpgboxXml.mockReturnValue(sections)
    importMocks.savePortraitFile.mockResolvedValue('file:///portrait.png')
    importMocks.importRpgboxSections.mockImplementation(async (_sections, _blank, options, importPortrait) => {
      const uri = await importPortrait('hero', 'portraits/hero/normal.png')
      options.onPortraitProgress(1, 1)
      expect(uri).toBe('file:///portrait.png')
      return importedGame
    })

    const { loadBundledRpgs } = await import('./bundledRpg')
    const progress = vi.fn()
    const result = await loadBundledRpgs(undefined, progress)

    expect(result).toEqual([{ key: 'file:sample.rpgbox', fileName: 'Sample_v2.rpgbox', game: { ...importedGame, title: 'Sample' } }])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/bundled-rpg/manifest.json',
      '/bundled-rpg/package-1/rpg.xml',
      '/bundled-rpg/package-1/portraits/hero/normal.png',
    ])
    expect(importMocks.parseRpgboxXml).toHaveBeenCalledWith('<rpgbox />')
    expect(importMocks.savePortraitFile).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenLastCalledWith('Sample_v2.rpgbox', 1, 1, '立绘 1 / 1')
  })
})
