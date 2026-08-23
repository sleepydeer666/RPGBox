import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from '../game'
import { createRoleXml, exportRolePackage, importRolePackage, parseRoleXml } from './rolePackage'

const filesystemMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Data: 'DATA' },
  Filesystem: filesystemMocks,
}))

describe('RPGBox role package', () => {
  beforeEach(() => {
    filesystemMocks.mkdir.mockReset().mockResolvedValue(undefined)
    filesystemMocks.readFile.mockReset().mockResolvedValue({ data: 'aW1hZ2U=' })
    filesystemMocks.writeFile.mockReset().mockResolvedValue({ uri: 'file:///portrait.png' })
  })

  it('round-trips a role manifest without exposing RPG or AI settings', () => {
    const game = createBlankGame(1)
    const npc = { ...game.characters[0], role: 'npc' as const, name: '莉亚', nsfwDescription: '成人设定' }
    const xml = createRoleXml({ ...npc, portraits: [] })
    const parsed = parseRoleXml(xml)

    expect(parsed.name).toBe('莉亚')
    expect(parsed.role).toBe('npc')
    expect(parsed).not.toHaveProperty('messages')
    expect(parsed).not.toHaveProperty('aiSettings')
  })

  it('rejects malformed role manifests', () => {
    expect(() => parseRoleXml('<rpgbox-role version="1" encoding="base64-json">bad</rpgbox-role>')).toThrow('角色包数据损坏')
  })

  it('keeps only allowed portrait groups when normal sharing is selected', async () => {
    const module = await import('./rolePackage')
    const zip = new JSZip()
    zip.file('role.xml', createRoleXml({
      id: 'npc-1', role: 'npc', name: '莉亚', gender: '', description: '', color: '#fff', portraits: [
        { id: 'normal', expression: '平静', groups: ['normal'], assetPath: 'portraits/normal.png' },
      ],
    }))
    zip.file('portraits/normal.png', 'image-data', { base64: false })
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'lia.role.rpgbox')
    const imported = await module.importRolePackage(file, 'game-1', 'npc-new')
    expect(imported.id).toBe('npc-new')
    expect(imported.role).toBe('npc')
    expect(imported.portraits).toHaveLength(1)
  })

  it('imports a role package selected through the system file picker', async () => {
    const zip = new JSZip()
    zip.file('role.xml', createRoleXml({
      id: 'old-id', role: 'npc', name: '系统文件', gender: '', description: '', color: '#fff', portraits: [],
    }))
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'selected.role.rpgbox')

    const imported = await importRolePackage(file, 'game-1', 'npc-new')

    expect(imported.name).toBe('系统文件')
    expect(imported.id).toBe('npc-new')
    expect(filesystemMocks.readFile).not.toHaveBeenCalled()
  })

  it('exports complete character fields and narrative modes for app backup', async () => {
    const npc = { ...createBlankGame(1).characters[0], role: 'npc' as const }
    npc.modeDescriptions = { normal: '日常设定', battle: '战斗设定' }
    npc.portraits = [{ id: 'portrait-1', expression: '认真', tags: ['认真'], groups: ['battle'], uri: 'file:///portrait.png' }]
    npc.defaultPortraitId = 'portrait-1'
    npc.defaultPortraitIds = { battle: 'portrait-1' }

    await exportRolePackage(npc, [
      { id: 'normal', name: '日常', color: '#65b7a5' },
      { id: 'battle', name: '战斗', color: '#d46c64' },
    ])

    const write = filesystemMocks.writeFile.mock.calls.at(-1)?.[0]
    const zip = await JSZip.loadAsync(write.data, { base64: true })
    const serialized = parseRoleXml(await zip.file('role.xml')!.async('string'))
    expect(serialized.narrativeModes?.map((mode) => mode.name)).toEqual(['日常', '战斗'])
    expect(serialized.modeDescriptions).toEqual({ normal: '日常设定', battle: '战斗设定' })
    expect(serialized.defaultPortraitIds).toEqual({ battle: 'portrait-1' })
    expect(serialized.defaultPortraitId).toBe('portrait-1')
    expect(serialized.portraits[0].groups).toEqual(['battle'])
  })

  it('imports only modes whose names exactly match the target RPG', async () => {
    const zip = new JSZip()
    zip.file('role.xml', createRoleXml({
      id: 'old-id', role: 'npc', name: '匹配测试', gender: '', description: '', color: '#fff',
      narrativeModes: [
        { id: 'source-daily', name: '日常', color: '#65b7a5' },
        { id: 'source-battle', name: '战斗', color: '#d46c64' },
      ],
      modeDescriptions: { 'source-daily': '日常设定', 'source-battle': '战斗设定' },
      defaultPortraitIds: { 'source-daily': 'daily', 'source-battle': 'battle' },
      portraits: [
        { id: 'daily', expression: '平静', groups: ['source-daily'], assetPath: 'portraits/daily.png' },
        { id: 'battle', expression: '战斗', groups: ['source-battle'], assetPath: 'portraits/battle.png' },
      ],
    }))
    zip.file('portraits/daily.png', 'daily', { base64: false })
    zip.file('portraits/battle.png', 'battle', { base64: false })
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'matched.role.rpgbox')
    const imported = await importRolePackage(file, 'game-1', 'npc-new', [
      { id: 'target-daily', name: '日常', color: '#65b7a5' },
      { id: 'target-other', name: '其他', color: '#d3ab61' },
    ])
    expect(imported.modeDescriptions).toEqual({ 'target-daily': '日常设定' })
    expect(imported.defaultPortraitIds).toEqual({ 'target-daily': 'daily' })
    expect(imported.portraits.map((portrait) => [portrait.id, portrait.groups])).toEqual([['daily', ['target-daily']]])
  })
})
