import { Preferences } from '@capacitor/preferences'
import { isAndroidRuntime, isDesktopRuntime } from './runtime'

const DATABASE_NAME = 'rpgbox-web'
const DATABASE_VERSION = 1
const STORE_NAME = 'state'

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
