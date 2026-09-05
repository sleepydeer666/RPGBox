import type { GameSession } from '../types'
import type { PersistedState } from '../storage'
import { flattenConversationTurns, groupConversationTurns, splitMessagesByChapter, takeRecentConversationTurns, type ConversationTurn } from '../lib/chatChunks'
import { readDataFile, writeDataFile } from './stateStore'

const ROOT = 'rpgbox-v2'
const SCHEMA_VERSION = 3
const PART_TURN_LIMIT = 50
const fileCache = new Map<string, string>()

interface GlobalState extends Omit<PersistedState, 'games'> {
  schemaVersion: number
  gameIds: string[]
  catalog?: StoredRpgSummary[]
}

export interface StoredRpgSummary {
  id: string
  title: string
  updatedAt: number
  characterCount: number
  characterPreviewNames: string[]
}

export interface StoredChapterSummary {
  id: string
  title: string
  turnCount: number
}

interface ChapterIndexEntry extends StoredChapterSummary {
  parts: string[]
}

interface ChapterIndex {
  schemaVersion: number
  recentTurnCount: number
  chapters: ChapterIndexEntry[]
}

export async function readV2State(): Promise<PersistedState | null> {
  const global = await readJson<GlobalState>(`${ROOT}/global/state.json`)
  if (!global || ![2, SCHEMA_VERSION].includes(global.schemaVersion)) return null
  const games: GameSession[] = []
  for (const id of global.gameIds) {
    const game = await readGame(id)
    if (game) games.push(game)
  }
  const { schemaVersion: _schemaVersion, gameIds: _gameIds, ...profile } = global
  return { ...profile, games }
}

export async function readStoredRpgCatalog(): Promise<StoredRpgSummary[] | null> {
  const global = await readJson<GlobalState>(`${ROOT}/global/state.json`)
  if (!global || ![2, SCHEMA_VERSION].includes(global.schemaVersion)) return null
  if (global.catalog) return global.catalog
  const catalog: StoredRpgSummary[] = []
  for (const id of global.gameIds) {
    const manifest = await readJson<StoredRpgSummary & { schemaVersion: number }>(`${ROOT}/rpgs/${safeId(id)}/manifest.json`)
    if (manifest) catalog.push({
      id: manifest.id,
      title: manifest.title,
      updatedAt: manifest.updatedAt,
      characterCount: manifest.characterCount,
      characterPreviewNames: manifest.characterPreviewNames ?? [],
    })
  }
  return catalog
}

export async function readStoredActiveGame(rawId: string): Promise<GameSession | null> {
  const id = safeId(rawId)
  const root = `${ROOT}/rpgs/${id}`
  const core = await readGameCore(root, id)
  const recent = await readJson<{ turns: ConversationTurn[] }>(`${root}/chat/recent.json`)
  if (!core || !recent) return null
  return { ...core, messages: flattenConversationTurns(recent.turns) }
}

export async function writeV2State(state: PersistedState): Promise<void> {
  for (const game of state.games) await writeGame(game)
  const { games: _games, ...profile } = state
  await writeJson(`${ROOT}/global/state.json`, {
    schemaVersion: SCHEMA_VERSION,
    ...profile,
    gameIds: state.games.map((game) => game.id),
    catalog: state.games.map(gameSummary),
  })
}

export async function migrateLegacyState(serializedLegacyState: string, state: PersistedState): Promise<void> {
  await writeJson(`${ROOT}/migration/state.json`, { schemaVersion: SCHEMA_VERSION, status: 'in-progress', startedAt: Date.now() })
  await writeDataFile(`${ROOT}/migration/legacy-v1-backup.json`, serializedLegacyState)
  await writeV2State(state)
  await writeJson(`${ROOT}/migration/state.json`, { schemaVersion: SCHEMA_VERSION, status: 'complete', completedAt: Date.now() })
}

export function isStoredPortraitUri(uri: string): boolean {
  return uri.startsWith('rpgbox-v2/rpgs/') || uri.includes('/rpgbox-v2/rpgs/')
}

export async function listStoredChapters(rawGameId: string): Promise<StoredChapterSummary[]> {
  const root = `${ROOT}/rpgs/${safeId(rawGameId)}`
  const index = await readJson<ChapterIndex>(`${root}/chat/chapter-index.json`)
  return index?.chapters.map(({ id, title, turnCount }) => ({ id, title: normalizeChapterTitle(title), turnCount })) ?? []
}

export async function readStoredChapter(rawGameId: string, chapterId: string): Promise<GameSession['messages']> {
  const root = `${ROOT}/rpgs/${safeId(rawGameId)}`
  const index = await readJson<ChapterIndex>(`${root}/chat/chapter-index.json`)
  const chapter = index?.chapters.find((item) => item.id === chapterId)
  if (!chapter) return []
  const turns: ConversationTurn[] = []
  for (const part of chapter.parts) {
    const stored = await readJson<{ turns: ConversationTurn[] }>(`${root}/${part}`)
    if (stored?.turns) turns.push(...stored.turns)
  }
  return flattenConversationTurns(turns)
}

async function writeGame(game: GameSession): Promise<void> {
  const id = safeId(game.id)
  const root = `${ROOT}/rpgs/${id}`
  const { characters, messages, gameState, narrative, memory, rollbackLog, updatedAt, ...settings } = game
  const turns = groupConversationTurns(messages)
  const recentTurns = takeRecentConversationTurns(turns, PART_TURN_LIMIT)
  const chunks = splitMessagesByChapter(messages, PART_TURN_LIMIT)
  const chapters: ChapterIndexEntry[] = []
  let chapter: ChapterIndexEntry | undefined

  for (const [index, chunk] of chunks.entries()) {
    const title = chunk.chapterTitle?.trim() || '章节过渡'
    if (!chapter || chapter.title !== title) {
      chapter = { id: `chapter-${String(chapters.length + 1).padStart(6, '0')}`, title, turnCount: 0, parts: [] }
      chapters.push(chapter)
    }
    const path = `chat/chapters/${chapter.id}/part-${String(chapter.parts.length + 1).padStart(6, '0')}.json`
    chapter.parts.push(path)
    chapter.turnCount += chunk.turns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length
    await writeJson(`${root}/${path}`, { schemaVersion: SCHEMA_VERSION, sequence: index, turns: chunk.turns })
  }

  await writeJson(`${root}/manifest.json`, {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: game.title,
    updatedAt,
    characterCount: characters.length,
    totalTurns: turns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length,
    characterPreviewNames: characters.slice(0, 3).map((character) => character.name),
  })
  await writeJson(`${root}/settings.json`, settings)
  await writeJson(`${root}/characters.json`, characters)
  await writeJson(`${root}/runtime-state.json`, { gameState, narrative, memory, rollbackLog: rollbackLog ?? [], updatedAt })
  await writeJson(`${root}/chat/recent.json`, { schemaVersion: SCHEMA_VERSION, turns: recentTurns })
  await writeJson(`${root}/chat/chapter-index.json`, {
    schemaVersion: SCHEMA_VERSION,
    recentTurnCount: recentTurns.filter((turn) => turn.messages.some((message) => message.role === 'user')).length,
    chapters,
  } satisfies ChapterIndex)
}

async function readGame(rawId: string): Promise<GameSession | null> {
  const id = safeId(rawId)
  const root = `${ROOT}/rpgs/${id}`
  const core = await readGameCore(root, id)
  if (!core) return null
  const index = await readJson<ChapterIndex>(`${root}/chat/chapter-index.json`)
  if (!index) return null
  const turns: ConversationTurn[] = []
  for (const chapter of index.chapters) {
    for (const part of chapter.parts) {
      const stored = await readJson<{ turns: ConversationTurn[] }>(`${root}/${part}`)
      if (stored?.turns) turns.push(...stored.turns)
    }
  }
  return { ...core, messages: flattenConversationTurns(turns) }
}

async function readGameCore(root: string, id: string): Promise<Omit<GameSession, 'messages'> | null> {
  const settings = await readJson<Omit<GameSession, 'characters' | 'messages' | 'gameState' | 'narrative' | 'memory' | 'rollbackLog' | 'updatedAt'>>(`${root}/settings.json`)
  const characters = await readJson<GameSession['characters']>(`${root}/characters.json`)
  const runtime = await readJson<Pick<GameSession, 'gameState' | 'narrative' | 'memory' | 'rollbackLog' | 'updatedAt'>>(`${root}/runtime-state.json`)
  if (!settings || !characters || !runtime) return null
  return { ...settings, ...runtime, id, characters } as Omit<GameSession, 'messages'>
}

async function readJson<T>(path: string): Promise<T | null> {
  const value = await readDataFile(path)
  if (!value) return null
  fileCache.set(path, value)
  return JSON.parse(value) as T
}

function writeJson(path: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value)
  if (fileCache.get(path) === serialized) return Promise.resolve()
  return writeDataFile(path, serialized).then(() => { fileCache.set(path, serialized) })
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) throw new Error('无效的 RPG ID')
  return value
}

function gameSummary(game: GameSession): StoredRpgSummary {
  return {
    id: game.id,
    title: game.title,
    updatedAt: game.updatedAt,
    characterCount: game.characters.length,
    characterPreviewNames: game.characters.slice(0, 3).map((character) => character.name),
  }
}

function normalizeChapterTitle(title: string | undefined): string {
  const normalized = title?.trim()
  return !normalized || normalized === '未分类记录' ? '章节过渡' : normalized
}
