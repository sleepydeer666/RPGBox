import { Preferences } from '@capacitor/preferences'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { isAndroidRuntime, isDesktopRuntime } from './runtime'

const DATABASE_NAME = 'rpgbox-web'
const DATABASE_VERSION = 1
const STORE_NAME = 'state'
let dataFileWriteQueue = Promise.resolve()

export async function readStoredState(key: string): Promise<string | null> {
  if (isDesktopRuntime()) return window.rpgboxDesktop!.readValue(key)
  if (isAndroidRuntime()) {
    const { value } = await Preferences.get({ key })
    return value
  }
  if (typeof indexedDB === 'undefined') {
    const { value } = await Preferences.get({ key })
    return value
  }
  return withStore('readonly', (store) => requestResult(store.get(key)))
}

export async function writeStoredState(key: string, value: string): Promise<void> {
  if (isDesktopRuntime()) {
    await window.rpgboxDesktop!.writeValue(key, value)
    return
  }
  if (isAndroidRuntime()) {
    await Preferences.set({ key, value })
    return
  }
  if (typeof indexedDB === 'undefined') {
    await Preferences.set({ key, value })
    return
  }
  await withStore('readwrite', async (store) => {
    await requestResult(store.put(value, key))
  })
}

export async function readDataFile(path: string): Promise<string | null> {
  const normalized = normalizeDataPath(path)
  if (isDesktopRuntime()) return window.rpgboxDesktop!.readDataFile(normalized)
  if (isAndroidRuntime()) {
    try {
      const result = await Filesystem.readFile({ path: normalized, directory: Directory.Data, encoding: Encoding.UTF8 })
      return typeof result.data === 'string' ? result.data : await result.data.text()
    } catch (error) {
      if (isMissingFileError(error)) {
        try {
          const backup = await Filesystem.readFile({ path: `${normalized}.bak`, directory: Directory.Data, encoding: Encoding.UTF8 })
          return typeof backup.data === 'string' ? backup.data : await backup.data.text()
        } catch (backupError) {
          if (isMissingFileError(backupError)) return null
          throw backupError
        }
      }
      throw error
    }
  }
  return readStoredState(`file:${normalized}`)
}

export async function writeDataFile(path: string, value: string): Promise<void> {
  const normalized = normalizeDataPath(path)
  JSON.parse(value)
  const operation = () => writeDataFileNow(normalized, value)
  dataFileWriteQueue = dataFileWriteQueue.then(operation, operation)
  return dataFileWriteQueue
}

async function writeDataFileNow(normalized: string, value: string): Promise<void> {
  if (isDesktopRuntime()) {
    await window.rpgboxDesktop!.writeDataFile(normalized, value)
    return
  }
  if (isAndroidRuntime()) {
    const temporaryPath = `${normalized}.tmp`
    await Filesystem.writeFile({ path: temporaryPath, data: value, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
    try {
      await Filesystem.deleteFile({ path: `${normalized}.bak`, directory: Directory.Data })
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    try {
      await Filesystem.copy({ from: normalized, to: `${normalized}.bak`, directory: Directory.Data, toDirectory: Directory.Data })
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    try {
      await Filesystem.deleteFile({ path: normalized, directory: Directory.Data })
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    await Filesystem.rename({ from: temporaryPath, to: normalized, directory: Directory.Data, toDirectory: Directory.Data })
    return
  }
  await writeStoredState(`file:${normalized}`, value)
}

export async function readLocalFlag(key: string): Promise<boolean> {
  return (await readStoredState(key)) === 'true'
}

export async function writeLocalFlag(key: string): Promise<void> {
  await writeStoredState(key, 'true')
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器存储'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, mode)
    const result = await action(transaction.objectStore(STORE_NAME))
    await transactionComplete(transaction)
    return result
  } finally {
    database.close()
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('浏览器存储操作失败'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器存储事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器存储事务已中止'))
  })
}

function normalizeDataPath(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('无效的数据文件路径')
  return normalized
}

function isMissingFileError(error: unknown): boolean {
  return /not found|does not exist|no such file|不存在/iu.test(error instanceof Error ? error.message : String(error))
}
