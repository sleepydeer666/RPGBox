const fs = require('node:fs/promises')
const path = require('node:path')

const APP_STATE_KEY = 'rpgbox-state-v1'
const PORTABLE_SCHEME = 'rpgbox-data'
const STORAGE_SCHEMA_VERSION = 1

function createPortableStorage(rootDirectory) {
  const root = path.resolve(rootDirectory)
  const profilesDirectory = path.join(root, 'profiles')
  const rpgDataDirectory = path.join(root, 'rpg_data')
  let writeQueue = Promise.resolve()

  function safeId(value, label) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`无效的${label}`)
    return value
  }

  function resolveWithin(base, ...segments) {
    const resolvedBase = path.resolve(base)
    const target = path.resolve(resolvedBase, ...segments)
    if (target !== resolvedBase && !target.startsWith(`${resolvedBase}${path.sep}`)) throw new Error('存储路径超出 RPGBox 目录')
    return target
  }

  async function ensure() {
    await fs.mkdir(profilesDirectory, { recursive: true })
    await fs.mkdir(rpgDataDirectory, { recursive: true })
    const probe = path.join(profilesDirectory, `.write-test-${process.pid}`)
    await fs.writeFile(probe, 'ok', 'utf8')
    await fs.rm(probe, { force: true })
  }

  async function readJsonWithBackup(filePath) {
    for (const candidate of [filePath, `${filePath}.bak`]) {
      try {
        return JSON.parse(await fs.readFile(candidate, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        if (candidate.endsWith('.bak')) throw error
      }
    }
    return null
  }

  async function atomicWriteJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
      await fs.copyFile(filePath, `${filePath}.bak`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      await fs.rename(temporaryPath, filePath)
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
      await fs.rm(filePath, { force: true })
      await fs.rename(temporaryPath, filePath)
    }
  }

  async function readPortableState() {
    const globalState = await readJsonWithBackup(path.join(profilesDirectory, 'global.json'))
    if (!globalState) return null
    const { schemaVersion: _schemaVersion, gameIds = [], ...profile } = globalState
    const games = []
    for (const gameId of gameIds) {
      const safeGameId = safeId(gameId, 'RPG ID')
      const game = await readJsonWithBackup(path.join(rpgDataDirectory, safeGameId, 'state.json'))
      if (game) games.push(game)
    }
    return JSON.stringify({ ...profile, games })
  }

  async function writePortableState(serializedState) {
    const state = JSON.parse(serializedState)
    if (!state || !Array.isArray(state.games)) throw new Error('PC 存档数据格式无效')
    const gameIds = []
    for (const game of state.games) {
      const gameId = safeId(game?.id, 'RPG ID')
      gameIds.push(gameId)
      const gameDirectory = resolveWithin(rpgDataDirectory, gameId)
      await atomicWriteJson(path.join(gameDirectory, 'state.json'), game)
      await atomicWriteJson(path.join(gameDirectory, 'manifest.json'), {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        id: gameId,
        title: typeof game.title === 'string' ? game.title : '',
        createdAt: game.createdAt ?? null,
        updatedAt: game.updatedAt ?? null,
      })
    }
    const { games: _games, ...profile } = state
    await atomicWriteJson(path.join(profilesDirectory, 'global.json'), {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      ...profile,
      gameIds,
    })
    await removeUnreferencedRpgDirectories(new Set(gameIds))
  }

  async function removeUnreferencedRpgDirectories(gameIds) {
    const entries = await fs.readdir(rpgDataDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || gameIds.has(entry.name) || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue
      const directory = resolveWithin(rpgDataDirectory, entry.name)
      try {
        await fs.access(path.join(directory, 'state.json'))
      } catch {
        continue
      }
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  async function readPreference(key) {
    const preferences = await readJsonWithBackup(path.join(profilesDirectory, 'preferences.json')) ?? {}
    return typeof preferences[key] === 'string' ? preferences[key] : null
  }

  async function writePreference(key, value) {
    const preferencesPath = path.join(profilesDirectory, 'preferences.json')
    const preferences = await readJsonWithBackup(preferencesPath) ?? {}
    await atomicWriteJson(preferencesPath, { ...preferences, [key]: value })
  }

  function portableUri(relativePath) {
    return `${PORTABLE_SCHEME}:///${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`
  }

  function pathFromUri(uri) {
    const parsed = new URL(uri)
    if (parsed.protocol !== `${PORTABLE_SCHEME}:`) throw new Error('无效的 PC 立绘路径')
    const pathname = decodeURIComponent(parsed.pathname).replace(/^[/\\]+/u, '')
    const relativePath = parsed.hostname
      ? parsed.hostname === 'rpg_data' ? pathname : ''
      : pathname.startsWith('rpg_data/') ? pathname.slice('rpg_data/'.length) : ''
    if (!relativePath) throw new Error('立绘路径不属于 RPG 数据目录')
    return resolveWithin(rpgDataDirectory, ...relativePath.split('/'))
  }

  function portraitExtension(fileName) {
    const extension = path.extname(fileName).slice(1).toLowerCase()
    return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? extension : 'png'
  }

  async function readValue(key) {
    return key === APP_STATE_KEY ? readPortableState() : readPreference(key)
  }

  function writeValue(key, value) {
    const operation = () => key === APP_STATE_KEY ? writePortableState(value) : writePreference(key, value)
    writeQueue = writeQueue.then(operation, operation)
    return writeQueue
  }

  async function savePortrait({ gameId: rawGameId, characterId: rawCharacterId, fileName, base64 }) {
    const gameId = safeId(rawGameId, 'RPG ID')
    const characterId = safeId(rawCharacterId, '角色 ID')
    const extension = portraitExtension(fileName ?? '')
    const relativePath = path.join('rpg_data', gameId, 'portraits', characterId, `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`)
    const target = resolveWithin(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, Buffer.from(base64 ?? '', 'base64'))
    return portableUri(relativePath)
  }

  async function readPortrait(uri) {
    return (await fs.readFile(pathFromUri(uri))).toString('base64')
  }

  async function portraitResponse(uri) {
    const filePath = pathFromUri(uri)
    const data = await fs.readFile(filePath)
    return new Response(data, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': portraitMimeType(filePath),
      },
    })
  }

  async function deletePortrait(uri) {
    await fs.rm(pathFromUri(uri), { force: true })
  }

  return { ensure, readValue, writeValue, savePortrait, readPortrait, portraitResponse, deletePortrait, pathFromUri }
}

function portraitMimeType(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}

module.exports = { APP_STATE_KEY, PORTABLE_SCHEME, createPortableStorage }
