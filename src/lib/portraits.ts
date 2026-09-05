import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { isAndroidRuntime, isDesktopRuntime } from '../platform/runtime'
import { RpgStorage } from '../platform/rpgStorage'

export async function savePortraitFile(gameId: string, characterId: string, file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file)
  if (isDesktopRuntime()) {
    return window.rpgboxDesktop!.savePortrait(gameId, characterId, file.name, dataUrl.slice(dataUrl.indexOf(',') + 1))
  }
  if (!isAndroidRuntime()) return dataUrl
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png'
  const path = `rpgbox-v2/rpgs/${safePart(gameId)}/portraits/${safePart(characterId)}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  const result = await Filesystem.writeFile({ path, data: base64, directory: Directory.Data, recursive: true })
  return result.uri
}

export async function deletePortraitFile(uri: string): Promise<void> {
  if (isDesktopRuntime() && uri.startsWith('rpgbox-data:')) {
    await window.rpgboxDesktop!.deletePortrait(uri)
    return
  }
  if (!isAndroidRuntime() || uri.startsWith('data:') || uri.startsWith('blob:')) return
  try {
    await Filesystem.deleteFile({ path: uri })
  } catch {
    // Missing files should not prevent removing stale portrait metadata.
  }
}

export async function readPortraitBase64(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri.slice(uri.indexOf(',') + 1)
  if (uri.startsWith('blob:')) return blobToBase64(await fetch(uri).then((response) => response.blob()))
  if (isDesktopRuntime() && uri.startsWith('rpgbox-data:')) return window.rpgboxDesktop!.readPortrait(uri)
  const result = await Filesystem.readFile({ path: uri })
  if (typeof result.data === 'string') return result.data
  return blobToBase64(result.data)
}

export async function savePortraitBase64(gameId: string, characterId: string, data: string, extension = 'png'): Promise<string> {
  const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png'
  if (isDesktopRuntime()) return window.rpgboxDesktop!.savePortrait(gameId, characterId, `portrait.${safeExtension}`, data)
  if (!isAndroidRuntime()) return `data:${mimeType(safeExtension)};base64,${data}`
  const path = `rpgbox-v2/rpgs/${safePart(gameId)}/portraits/${safePart(characterId)}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExtension}`
  const result = await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true })
  return result.uri
}

export async function copyPortraitFile(uri: string, gameId: string, characterId: string): Promise<string> {
  if (isAndroidRuntime() && !uri.startsWith('data:') && !uri.startsWith('blob:')) {
    const fileName = uri.split(/[?#/]/u).at(-1) || 'portrait.png'
    return (await RpgStorage.copyPortrait({ sourceUri: uri, gameId, characterId, fileName })).uri
  }
  return savePortraitBase64(gameId, characterId, await readPortraitBase64(uri), fileExtension(uri))
}

export function portraitSource(uri: string): string {
  return uri.startsWith('data:') || uri.startsWith('blob:') || uri.startsWith('rpgbox-data:') ? uri : Capacitor.convertFileSrc(normalizeFileUri(uri))
}

function normalizeFileUri(uri: string): string {
  return uri.startsWith('file:/') && !uri.startsWith('file:///') ? `file://${uri.slice('file:/'.length)}` : uri
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
      : reject(new Error('无法读取立绘资源'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取立绘资源'))
    reader.readAsDataURL(blob)
  })
}

function fileExtension(path: string): string {
  return path.split(/[?#]/u)[0].match(/\.([a-zA-Z0-9]+)$/u)?.[1] ?? 'png'
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function mimeType(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}
