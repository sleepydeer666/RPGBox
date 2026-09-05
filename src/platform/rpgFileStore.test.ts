import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGame } from '../game'
import type { PersistedState } from '../storage'
import { listStoredChapters, readStoredActiveGame, readStoredChapter, readStoredRpgCatalog, readV2State, writeV2State } from './rpgFileStore'

const files = vi.hoisted(() => new Map<string, string>())

vi.mock('./stateStore', () => ({
  readDataFile: vi.fn(async (path: string) => files.get(path) ?? null),
  writeDataFile: vi.fn(async (path: string, value: string) => { files.set(path, value) }),
}))

function stateWithTurns(count: number): PersistedState {
  const game = createBlankGame(1)
  game.messages = []
  for (let index = 1; index <= count; index += 1) {
    const chapterTitle = index <= 55 ? '第一章' : '第二章'
    game.messages.push(
      { id: `u${index}`, role: 'user', content: `user-${index}`, chapterTitle, createdAt: index },
      { id: `a${index}`, role: 'assistant', content: `assistant-${index}`, chapterTitle, createdAt: index },
    )
  }
  return {
    providers: [],
    activeProviderId: '',
    globalJailbreakPrompt: '',
    games: [game],
    activeGameId: game.id,
    bundledRpgImportKeys: [],
  }
}

describe('v2 RPG file storage', () => {
  beforeEach(() => files.clear())

  it('stores global state separately and bounds chapter parts to 50 turns', async () => {
    const state = stateWithTurns(61)
    await writeV2State(state)

    const root = `rpgbox-v2/rpgs/${state.games[0].id}`
    const global = JSON.parse(files.get('rpgbox-v2/global/state.json')!)
    const index = JSON.parse(files.get(`${root}/chat/chapter-index.json`)!)
    const recent = JSON.parse(files.get(`${root}/chat/recent.json`)!)

    expect(global.games).toBeUndefined()
    expect(global.gameIds).toEqual([state.games[0].id])
    expect(index.chapters.map((chapter: { title: string; turnCount: number; parts: string[] }) => [chapter.title, chapter.turnCount, chapter.parts.length]))
      .toEqual([['第一章', 55, 2], ['第二章', 6, 1]])
    expect(recent.turns).toHaveLength(50)
    expect(await readStoredRpgCatalog()).toEqual([expect.objectContaining({ id: state.games[0].id, characterCount: state.games[0].characters.length })])
    expect((await readStoredActiveGame(state.games[0].id))?.messages).toEqual(state.games[0].messages.slice(-100))
    const chapters = await listStoredChapters(state.games[0].id)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章'])
    expect(await readStoredChapter(state.games[0].id, chapters[0].id)).toEqual(state.games[0].messages.slice(0, 110))
  })

  it('writes schema v3 RPG files while accepting the v2 layout', async () => {
    const state = stateWithTurns(1)
    await writeV2State(state)
    const global = JSON.parse(files.get('rpgbox-v2/global/state.json')!)
    const manifest = JSON.parse(files.get(`rpgbox-v2/rpgs/${state.games[0].id}/manifest.json`)!)
    expect(global.schemaVersion).toBe(3)
    expect(manifest.schemaVersion).toBe(3)
  })

  it('persists the status controls preference and normalizes legacy transition titles', async () => {
    const state = stateWithTurns(1)
    state.games[0].showStatusControls = false
    state.games[0].messages[0].chapterTitle = '未分类记录'
    await writeV2State(state)

    const root = `rpgbox-v2/rpgs/${state.games[0].id}`
    expect(JSON.parse(files.get(`${root}/settings.json`)!)).toMatchObject({ showStatusControls: false })

    const index = JSON.parse(files.get(`${root}/chat/chapter-index.json`)!)
    index.chapters[0].title = '未分类记录'
    files.set(`${root}/chat/chapter-index.json`, JSON.stringify(index))
    expect((await listStoredChapters(state.games[0].id))[0].title).toBe('章节过渡')
  })

  it('reconstructs the compatibility snapshot without losing messages', async () => {
    const state = stateWithTurns(61)
    await writeV2State(state)
    const restored = await readV2State()
    expect(restored?.games[0].messages).toEqual(state.games[0].messages)
    expect(restored?.games[0].characters).toEqual(state.games[0].characters)
    expect(restored?.activeGameId).toBe(state.activeGameId)
  })
})
