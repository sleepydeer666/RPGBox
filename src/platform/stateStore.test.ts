import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLegacyStorage, hasLegacyStorage } from './stateStore'

const runtimeMocks = vi.hoisted(() => ({
  android: true,
}))

const preferenceMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}))

const filesystemMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  rmdir: vi.fn(),
  copy: vi.fn(),
  rename: vi.fn(),
}))

vi.mock('./runtime', () => ({
  isAndroidRuntime: () => runtimeMocks.android,
  isDesktopRuntime: () => false,
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferenceMocks,
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: filesystemMocks,
}))

const missingFile = new Error('File does not exist')

describe('legacy Android storage cleanup', () => {
  beforeEach(() => {
    runtimeMocks.android = true
    for (const mock of Object.values(preferenceMocks)) mock.mockReset()
    for (const mock of Object.values(filesystemMocks)) mock.mockReset()
    preferenceMocks.get.mockResolvedValue({ value: null })
    preferenceMocks.remove.mockResolvedValue(undefined)
    filesystemMocks.readdir.mockRejectedValue(missingFile)
    filesystemMocks.readFile.mockRejectedValue(missingFile)
    filesystemMocks.rmdir.mockResolvedValue(undefined)
    filesystemMocks.deleteFile.mockResolvedValue(undefined)
  })

  it('detects the retained v1 preference without probing files', async () => {
    preferenceMocks.get.mockResolvedValue({ value: '{"games":[]}' })

    await expect(hasLegacyStorage()).resolves.toBe(true)
    expect(filesystemMocks.readdir).not.toHaveBeenCalled()
    expect(filesystemMocks.readFile).not.toHaveBeenCalled()
  })

  it('detects the legacy portrait directory', async () => {
    filesystemMocks.readdir.mockResolvedValue({ files: [] })

    await expect(hasLegacyStorage()).resolves.toBe(true)
    expect(filesystemMocks.readdir).toHaveBeenCalledWith({ path: 'portraits', directory: 'DATA' })
  })

  it('detects a retained migration backup even when other legacy data is gone', async () => {
    filesystemMocks.readFile.mockResolvedValue({ data: '{}' })

    await expect(hasLegacyStorage()).resolves.toBe(true)
    expect(filesystemMocks.readFile).toHaveBeenCalledWith({
      path: 'rpgbox-v2/migration/legacy-v1-backup.json',
      directory: 'DATA',
    })
  })

  it('reports no remnants when all legacy locations are missing', async () => {
    await expect(hasLegacyStorage()).resolves.toBe(false)
  })

  it('removes only the v1 preference, portrait directory, and migration backup', async () => {
    await clearLegacyStorage()

    expect(filesystemMocks.rmdir).toHaveBeenCalledWith({ path: 'portraits', directory: 'DATA', recursive: true })
    expect(preferenceMocks.remove).toHaveBeenCalledWith({ key: 'rpgbox-state-v1' })
    expect(filesystemMocks.deleteFile).toHaveBeenCalledWith({
      path: 'rpgbox-v2/migration/legacy-v1-backup.json',
      directory: 'DATA',
    })
    expect(filesystemMocks.rmdir).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('rpgbox-v2/rpgs') }))
    expect(filesystemMocks.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('rpgbox-v2/rpgs') }))
  })

  it('does not inspect or mutate legacy Android storage on other platforms', async () => {
    runtimeMocks.android = false

    await expect(hasLegacyStorage()).resolves.toBe(false)
    await clearLegacyStorage()
    expect(preferenceMocks.get).not.toHaveBeenCalled()
    expect(preferenceMocks.remove).not.toHaveBeenCalled()
    expect(filesystemMocks.readdir).not.toHaveBeenCalled()
    expect(filesystemMocks.rmdir).not.toHaveBeenCalled()
  })
})
