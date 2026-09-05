import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from '../game'
import { createRpgboxXml, exportRpgbox, importRpgbox, parseRpgboxXml } from './rpgPackage'

const filesystemMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
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
    filesystemMocks.appendFile.mockReset().mockResolvedValue(undefined)
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
    game.modeStoryStylePrompts = { normal: '舒缓叙事', nsfw: '感官叙事' }
    game.aiSettings = {
      ...game.aiSettings,
      providerId: 'private-provider',
      model: 'private-model',
      temperature: 0.42,
    }

    await exportRpgbox(game, { settings: true, characters: false })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, typeof write.data === 'string' ? { base64: true } : undefined)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    const settings = JSON.parse(await zip.file('settings.json')!.async('string'))
    expect(manifest.version).toBe(2)
    expect(settings).not.toHaveProperty('aiSettings')
    expect(settings).not.toHaveProperty('note')
    expect(settings).not.toHaveProperty('nsfwEnabled')
    expect(settings.newStoryChoiceCount).toBe(4)
    expect(settings.modeStoryStylePrompts).toEqual({ normal: '舒缓叙事', nsfw: '感官叙事' })
    expect(await zip.file('chat/recent.json')!.async('string')).not.toContain('private-provider')
  })

  it('exports complete character settings and portraits from every narrative mode', async () => {
    const game = createBlankGame(1)
    game.characters[0].modeDescriptions = { nsfw: 'private-nsfw-setting' }
    game.characters[0].portraits = [
      { id: 'normal', expression: '平静', uri: 'file:///normal.png', groups: ['normal'] },
      { id: 'nsfw', expression: '特殊', uri: 'file:///nsfw.png', groups: ['nsfw'] },
    ]

    await exportRpgbox(game, { settings: false, characters: true })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, typeof write.data === 'string' ? { base64: true } : undefined)
    const characters = JSON.parse(await zip.file('characters.json')!.async('string'))
    expect(characters[0].modeDescriptions?.nsfw).toBe('private-nsfw-setting')
    expect(characters[0].portraits.map((portrait: { id: string }) => portrait.id)).toEqual(['normal', 'nsfw'])
    expect(await zip.file(characters[0].portraits[0].assetPath)!.async('uint8array')).toBeInstanceOf(Uint8Array)
  })

  it('reports portrait packaging progress during export', async () => {
    const game = createBlankGame(1)
    game.characters[0].portraits = [
      { id: 'normal', expression: '平静', uri: 'file:///normal.png', groups: ['normal'] },
      { id: 'smile', expression: '微笑', uri: 'file:///smile.png', groups: ['normal'] },
    ]
    const progress = vi.fn()

    await exportRpgbox(game, { settings: false, characters: true, onPortraitProgress: progress })

    expect(progress).toHaveBeenNthCalledWith(1, 0, 2)
    expect(progress).toHaveBeenNthCalledWith(2, 1, 2)
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  it('includes character NSFW settings with character exports', async () => {
    const game = createBlankGame(1)
    game.characters[0].modeDescriptions = { nsfw: 'shared-nsfw-setting' }

    await exportRpgbox(game, { settings: false, characters: true })

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, { base64: true })
    const characters = JSON.parse(await zip.file('characters.json')!.async('string'))
    expect(characters[0].modeDescriptions?.nsfw).toBe('shared-nsfw-setting')
  })

  it('imports a package selected through the system file picker', async () => {
    const zip = new JSZip()
    zip.file('rpg.xml', createRpgboxXml('Selected RPG', { settings: { storyStylePrompt: '直接读取' } }))
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'selected.rpgbox')

    const imported = await importRpgbox(file, createBlankGame(1))

    expect(imported.storyStylePrompt).toBe('直接读取')
    expect(filesystemMocks.readFile).not.toHaveBeenCalled()
  })

  it('imports NSFW settings without a separate enable flag', async () => {
    const zip = new JSZip()
    zip.file('rpg.xml', createRpgboxXml('NSFW RPG', {
      settings: {},
      nsfw: { nsfwScenePrompt: 'package NSFW settings' },
    }))
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'nsfw.rpgbox')

    const imported = await importRpgbox(file, createBlankGame(1))

    expect(imported.nsfwScenePrompt).toBe('package NSFW settings')
  })
})
