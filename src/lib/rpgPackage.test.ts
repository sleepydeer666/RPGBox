import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from '../game'
import { createRpgboxXml, exportRpgbox, parseRpgboxXml } from './rpgPackage'

const filesystemMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Filesystem: filesystemMocks,
}))

describe('RPGBox XML manifest', () => {
  beforeEach(() => {
    filesystemMocks.mkdir.mockReset().mockResolvedValue(undefined)
    filesystemMocks.readFile.mockReset().mockResolvedValue({ data: 'aW1hZ2U=' })
    filesystemMocks.writeFile.mockReset().mockResolvedValue({ uri: 'file:///export.rpgbox' })
  })

  it('round-trips selected package sections and escapes the title', () => {
    const xml = createRpgboxXml('测试 & RPG', {
      settings: { storyStylePrompt: '细腻叙事' },
      nsfw: { nsfwScenePrompt: '偏好内容' },
    })
    expect(xml).toContain('title="测试 &amp; RPG"')
    expect(parseRpgboxXml(xml)).toEqual({
      settings: { storyStylePrompt: '细腻叙事' },
      nsfw: { nsfwScenePrompt: '偏好内容' },
    })
  })

  it('rejects manifests without importable sections', () => {
    expect(() => parseRpgboxXml('<?xml version="1.0"?><rpgbox version="1"></rpgbox>')).toThrow('没有可导入内容')
  })

  it('never exports per-RPG AI settings in a share package', async () => {
    const game = createBlankGame(1)
    game.aiSettings = {
      ...game.aiSettings,
      providerId: 'private-provider',
      model: 'private-model',
      temperature: 0.42,
    }

    await exportRpgbox(game, { settings: true, characters: false, nsfw: false })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, { base64: true })
    const xml = await zip.file('rpg.xml')!.async('string')
    const sections = parseRpgboxXml(xml)
    expect(sections.settings).not.toHaveProperty('aiSettings')
    expect(sections.settings?.nsfwEnabled).toBe(false)
    expect(xml).not.toContain('private-provider')
    expect(xml).not.toContain('private-model')
  })

  it('keeps character NSFW settings and NSFW-only portraits out of a normal character export', async () => {
    const game = createBlankGame(1)
    game.characters[0].nsfwDescription = 'private-nsfw-setting'
    game.characters[0].portraits = [
      { id: 'normal', expression: '平静', uri: 'file:///normal.png', groups: ['normal'] },
      { id: 'nsfw', expression: '特殊', uri: 'file:///nsfw.png', groups: ['nsfw'] },
    ]

    await exportRpgbox(game, { settings: false, characters: true, nsfw: false })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, { base64: true })
    const xml = await zip.file('rpg.xml')!.async('string')
    const sections = parseRpgboxXml(xml)
    expect(sections.characters?.[0]).not.toHaveProperty('nsfwDescription')
    expect(sections.characters?.[0].portraits.map((portrait) => portrait.id)).toEqual(['normal'])
    expect(xml).not.toContain('private-nsfw-setting')
  })

  it('includes character NSFW settings when the NSFW section is selected', async () => {
    const game = createBlankGame(1)
    game.characters[0].nsfwDescription = 'shared-nsfw-setting'

    await exportRpgbox(game, { settings: false, characters: false, nsfw: true })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, { base64: true })
    const sections = parseRpgboxXml(await zip.file('rpg.xml')!.async('string'))
    expect(sections.nsfw?.characterSettings?.[0].nsfwDescription).toBe('shared-nsfw-setting')
  })
})
