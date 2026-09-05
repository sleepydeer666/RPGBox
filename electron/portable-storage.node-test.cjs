const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { APP_STATE_KEY, createPortableStorage } = require('./portable-storage.cjs')

test('portable storage keeps profiles, RPG state, and portraits inside its root', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgbox-portable-test-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const storage = createPortableStorage(root)
  await storage.ensure()

  const state = {
    providers: [{ id: 'provider-example', baseUrl: 'https://example.com/v1', apiKey: 'sk-example-not-real' }],
    activeProviderId: 'provider-example',
    globalJailbreakPrompt: '',
    activeGameId: 'game-alpha',
    bundledRpgImportKeys: ['file:example.rpgbox'],
    games: [
      { id: 'game-alpha', title: 'Alpha', createdAt: 1, updatedAt: 2, messages: [{ id: 'message-1', content: 'hello' }] },
      { id: 'game-beta', title: 'Beta', createdAt: 3, updatedAt: 4, messages: [] },
    ],
  }
  await storage.writeValue(APP_STATE_KEY, JSON.stringify(state))

  await storage.writeDataFile('rpgbox-v2/global/example.json', JSON.stringify({ schemaVersion: 2, value: 'ok' }))
  assert.deepEqual(JSON.parse(await storage.readDataFile('rpgbox-v2/global/example.json')), { schemaVersion: 2, value: 'ok' })
  await storage.writeValue('tutorial-seen', 'true')
  await storage.writeValue('tutorial-seen', 'true')

  const restored = JSON.parse(await storage.readValue(APP_STATE_KEY))
  assert.deepEqual(restored, state)
  assert.equal(await storage.readValue('tutorial-seen'), 'true')

  const globalState = JSON.parse(await fs.readFile(path.join(root, 'profiles', 'global.json'), 'utf8'))
  assert.equal(globalState.games, undefined)
  assert.deepEqual(globalState.gameIds, ['game-alpha', 'game-beta'])
  assert.equal((await fs.stat(path.join(root, 'profiles', 'preferences.json.bak'))).isFile(), true)
  assert.equal((await fs.stat(path.join(root, 'rpg_data', 'game-alpha', 'state.json'))).isFile(), true)
  assert.equal((await fs.stat(path.join(root, 'rpg_data', 'game-beta', 'manifest.json'))).isFile(), true)

  const sourcePortrait = Buffer.from('portable portrait')
  const portraitUri = await storage.savePortrait({
    gameId: 'game-alpha',
    characterId: 'npc-example',
    fileName: 'normal.png',
    base64: sourcePortrait.toString('base64'),
  })
  assert.match(portraitUri, /^rpgbox-data:\/\/\/rpg_data\/game-alpha\/portraits\/npc-example\//u)
  assert.deepEqual(Buffer.from(await storage.readPortrait(portraitUri), 'base64'), sourcePortrait)
  assert.equal((await fs.stat(storage.pathFromUri(portraitUri))).isFile(), true)
  const canonicalPortraitUri = portraitUri.replace(':///rpg_data/', '://rpg_data/')
  assert.equal(storage.pathFromUri(canonicalPortraitUri), storage.pathFromUri(portraitUri))
  const portraitResponse = await storage.portraitResponse(canonicalPortraitUri)
  assert.equal(portraitResponse.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await portraitResponse.arrayBuffer()), sourcePortrait)

  await storage.writeValue(APP_STATE_KEY, JSON.stringify({ ...state, games: [state.games[0]] }))
  await assert.rejects(fs.access(path.join(root, 'rpg_data', 'game-beta')), { code: 'ENOENT' })
  await storage.deletePortrait(portraitUri)
  await assert.rejects(fs.access(storage.pathFromUri(portraitUri)), { code: 'ENOENT' })
  assert.throws(() => storage.pathFromUri('rpgbox-data:///profiles/global.json'), /不属于 RPG 数据目录/u)
  assert.throws(() => storage.pathFromUri('rpgbox-data://profiles/global.json'), /不属于 RPG 数据目录/u)
})
