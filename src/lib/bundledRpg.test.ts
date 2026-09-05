import { beforeEach, describe, expect, it, vi } from 'vitest'

const importMocks = vi.hoisted(() => ({
  importRpgboxSections: vi.fn(),
  importRpgboxV2: vi.fn(),
  parseRpgboxXml: vi.fn(),
  savePortraitFile: vi.fn(),
}))

vi.mock('./rpgPackage', () => ({
  importRpgboxSections: importMocks.importRpgboxSections,
  importRpgboxV2: importMocks.importRpgboxV2,
  parseRpgboxXml: importMocks.parseRpgboxXml,
}))
vi.mock('./portraits', () => ({ savePortraitFile: importMocks.savePortraitFile }))

describe('bundled RPG loading', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    importMocks.importRpgboxSections.mockReset()
    importMocks.importRpgboxV2.mockReset()
    importMocks.parseRpgboxXml.mockReset()
    importMocks.savePortraitFile.mockReset()
  })

  it('returns no games when the build contains no bundled RPG assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packages: [] }) }))
    const { listBundledRpgPresets } = await import('./bundledRpg')

    await expect(listBundledRpgPresets()).resolves.toEqual([])
    expect(importMocks.importRpgboxSections).not.toHaveBeenCalled()
  })

  it('imports only the selected preset and loads portraits one asset at a time', async () => {
    const sections = { characters: [] }
    const importedGame = { id: 'new-game', title: 'New RPG' }
    const responses = [
      { ok: true, json: async () => ({ packages: [{ key: 'file:sample.rpgbox', fileName: 'Sample_v2.rpgbox', title: 'Sample Preset', hasNsfw: true, xmlUrl: '/bundled-rpg/package-1/rpg.xml', portraits: { 'portraits/hero/normal.png': '/bundled-rpg/package-1/portraits/hero/normal.png' } }] }) },
      { ok: true, text: async () => '<rpgbox />' },
      { ok: true, blob: async () => new Blob(['portrait']) },
    ]
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift())
    vi.stubGlobal('fetch', fetchMock)
    importMocks.parseRpgboxXml.mockReturnValue(sections)
    importMocks.savePortraitFile.mockResolvedValue('file:///portrait.png')
    importMocks.importRpgboxSections.mockImplementation(async (_sections, _blank, options, importPortrait) => {
      options.onPortraitProgress(0, 1)
      const uri = await importPortrait('hero', 'portraits/hero/normal.png')
      options.onPortraitProgress(1, 1)
      expect(uri).toBe('file:///portrait.png')
      return importedGame
    })

    const { importBundledRpg } = await import('./bundledRpg')
    const progress = vi.fn()
    const result = await importBundledRpg('file:sample.rpgbox', undefined, progress)

    expect(result).toEqual({ key: 'file:sample.rpgbox', fileName: 'Sample_v2.rpgbox', game: { ...importedGame, title: 'Sample Preset' } })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/bundled-rpg/manifest.json',
      '/bundled-rpg/package-1/rpg.xml',
      '/bundled-rpg/package-1/portraits/hero/normal.png',
    ])
    expect(importMocks.parseRpgboxXml).toHaveBeenCalledWith('<rpgbox />')
    expect(importMocks.savePortraitFile).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenNthCalledWith(1, 0, 1)
    expect(progress).toHaveBeenLastCalledWith(1, 1)
  })

  it('imports a V2 preset through its extracted files without fetching the whole package', async () => {
    const entry = {
      key: 'file:sample-v2.rpgbox', fileName: 'Sample_v2.rpgbox', formatVersion: 2, title: 'V2 Preset', hasNsfw: false,
      files: {
        'manifest.json': '/bundled-rpg/package-1/manifest.json',
        'settings.json': '/bundled-rpg/package-1/settings.json',
        'portraits/hero/normal.png': '/bundled-rpg/package-1/portraits/hero/normal.png',
      },
    }
    const responses = new Map<string, unknown>([
      ['/bundled-rpg/manifest.json', { ok: true, json: async () => ({ packages: [entry] }) }],
      [entry.files['manifest.json'], { ok: true, text: async () => JSON.stringify({ format: 'rpgbox', version: 2, title: 'V2 Preset', sections: { settings: true, characters: true } }) }],
      [entry.files['settings.json'], { ok: true, text: async () => '{"storyStylePrompt":"分文件读取"}' }],
      [entry.files['portraits/hero/normal.png'], { ok: true, blob: async () => new Blob(['portrait']) }],
    ])
    const fetchMock = vi.fn(async (url: string) => responses.get(url))
    vi.stubGlobal('fetch', fetchMock)
    importMocks.savePortraitFile.mockResolvedValue('file:///portrait.png')
    importMocks.importRpgboxV2.mockImplementation(async (_manifest, blank, _options, readText, importPortrait) => {
      expect(await readText('settings.json')).toContain('分文件读取')
      expect(await importPortrait('hero', 'portraits/hero/normal.png')).toBe('file:///portrait.png')
      return { ...blank, title: 'Imported V2' }
    })

    const { importBundledRpg, listBundledRpgPresets } = await import('./bundledRpg')
    await expect(listBundledRpgPresets()).resolves.toEqual([expect.objectContaining({ title: 'V2 Preset', portraitCount: 1 })])
    const result = await importBundledRpg(entry.key)

    expect(result.game.title).toBe('V2 Preset')
    expect(importMocks.importRpgboxV2).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('sample-v2.rpgbox')
  })
})
