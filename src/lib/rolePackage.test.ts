import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from '../game'
import { createRoleXml, importRolePackage, parseRoleXml } from './rolePackage'

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
    const encoded = await zip.generateAsync({ type: 'base64' })
    filesystemMocks.readFile.mockResolvedValue({ data: encoded })
    const imported = await module.importRolePackage('lia.role.rpgbox', 'game-1', 'npc-new')
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
})
