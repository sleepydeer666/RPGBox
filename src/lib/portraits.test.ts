import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deletePortraitFile } from './portraits'

const filesystemMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
}))

vi.mock('../platform/runtime', () => ({
  isAndroidRuntime: () => true,
  isDesktopRuntime: () => false,
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: filesystemMocks,
}))

describe('portrait file deletion', () => {
  beforeEach(() => filesystemMocks.deleteFile.mockReset())

  it('deletes an Android portrait URI', async () => {
    filesystemMocks.deleteFile.mockResolvedValue(undefined)

    await deletePortraitFile('file:///portrait.png')
    expect(filesystemMocks.deleteFile).toHaveBeenCalledWith({ path: 'file:///portrait.png' })
  })

})
