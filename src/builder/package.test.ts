import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createBlankGame } from '../game'
import { parseRoleXml } from '../lib/rolePackage'
import { importRpgboxSections, parseRpgboxXml } from '../lib/rpgPackage'
import type { CharacterDraft, PortraitDraft } from './package'
import { applyMissingDefaults, buildRolePackage, buildRpgPackage, groupsForExpression, readRolePackage, readRpgPackage } from './package'

function portrait(id: string, expression: string, groups: PortraitDraft['groups']): PortraitDraft {
  return { id, expression, tags: [expression], groups, file: new Blob(['image']), extension: 'png', previewUrl: `blob:${id}` }
}

function character(portraits: PortraitDraft[]): CharacterDraft {
  return {
    id: 'npc-1', role: 'npc', name: '测试角色', gender: '女', description: '人物设定', nsfwDescription: '成人设定',
    statusBar: '正常', color: '#d3ab61', portraits, defaultPortraitIds: {},
  }
}

describe('PC package builder', () => {
  it('assigns the requested expression groups', () => {
    expect(groupsForExpression('性高潮')).toEqual(['nsfw'])
    expect(groupsForExpression('大笑')).toEqual(['nsfw'])
    expect(groupsForExpression('羞耻')).toEqual(['normal', 'nsfw'])
    expect(groupsForExpression('正常')).toEqual(['normal'])
  })

  it('fills missing defaults with normal and shy before falling back to first', () => {
    const result = applyMissingDefaults(character([
      portrait('normal-first', '微笑', ['normal']),
      portrait('nsfw-first', '性高潮', ['nsfw']),
      portrait('normal', '正常', ['normal']),
      portrait('shy', '羞耻', ['normal', 'nsfw']),
    ]))
    expect(result.defaultPortraitIds).toEqual({ normal: 'normal', nsfw: 'shy' })
    expect(result.defaultPortraitId).toBe('normal')
  })

  it('does not replace defaults that are already set', () => {
    const source = character([portrait('first', '正常', ['normal']), portrait('second', '羞耻', ['normal', 'nsfw'])])
    source.defaultPortraitId = 'first'
    source.defaultPortraitIds = { normal: 'first', nsfw: 'first' }
    expect(applyMissingDefaults(source).defaultPortraitIds).toEqual({ normal: 'first', nsfw: 'first' })
  })

  it('creates a role package readable by the app protocol', async () => {
    const blob = await buildRolePackage(character([portrait('normal', '正常', ['normal'])]))
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('role.xml')?.async('string')
    const parsed = parseRoleXml(xml ?? '')
    expect(parsed.name).toBe('测试角色')
    expect(parsed.portraits[0].assetPath).toBe('portraits/normal.png')
    expect(zip.file('portraits/normal.png')).not.toBeNull()
    const imported = await readRolePackage(new File([blob], '测试角色.role.rpgbox'))
    expect(imported.name).toBe('测试角色')
    expect(imported.portraits.map((item) => item.expression)).toEqual(['正常'])
    expect(imported.portraits[0].file.size).toBeGreaterThan(0)
  })

  it('creates an RPG package with settings, cast, and no AI configuration', async () => {
    const blob = await buildRpgPackage({
      title: '测试剧本', nsfwEnabled: true, newStoryChoiceCount: 6, storyStylePrompt: '文风',
      chapterTransitionRules: '切章', recommendedChapterTurnsEnabled: true, recommendedChapterTurns: 24,
      statusRulesPrompt: '状态规则', nsfwScenePrompt: '成人偏好', worldSettingPrompt: '世界观', openingMessage: '开场',
      location: '测试地点', time: '清晨', chapterTitle: '第一章',
    }, { ...character([]), id: 'player', role: 'player', name: '主角' }, [character([])])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const sections = parseRpgboxXml(await zip.file('rpg.xml')!.async('string'))
    expect(sections.settings?.aiSettings).toBeUndefined()
    expect(sections.characters?.map((item) => item.name)).toEqual(['主角', '测试角色'])
    const imported = await importRpgboxSections(sections, createBlankGame(1))
    expect(imported.nsfwScenePrompt).toBe('成人偏好')
    expect(imported.characters).toHaveLength(2)
    const editable = await readRpgPackage(new File([blob], '测试剧本.rpgbox'))
    expect(editable.settings).toMatchObject({
      title: '测试剧本', storyStylePrompt: '文风', openingMessage: '开场', location: '测试地点', time: '清晨', chapterTitle: '第一章',
      nsfwEnabled: true, nsfwScenePrompt: '成人偏好',
    })
    expect(editable.characters.map((item) => [item.role, item.name, item.nsfwDescription])).toEqual([
      ['player', '主角', '成人设定'],
      ['npc', '测试角色', '成人设定'],
    ])
  })

  it('excludes NSFW-only portraits from a normal RPG package', async () => {
    const npc = character([
      portrait('normal', '正常', ['normal']),
      portrait('dual', '羞耻', ['normal', 'nsfw']),
      portrait('nsfw', '大笑', ['nsfw']),
    ])
    npc.defaultPortraitIds = { normal: 'normal', nsfw: 'nsfw' }
    const blob = await buildRpgPackage({
      title: '常规剧本', nsfwEnabled: false, newStoryChoiceCount: 4, storyStylePrompt: '', chapterTransitionRules: '',
      recommendedChapterTurnsEnabled: false, recommendedChapterTurns: 20, statusRulesPrompt: '', nsfwScenePrompt: '',
      worldSettingPrompt: '', openingMessage: '', location: '', time: '', chapterTitle: '',
    }, { ...character([]), id: 'player', role: 'player', name: '主角' }, [npc])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const sections = parseRpgboxXml(await zip.file('rpg.xml')!.async('string'))
    const importedNpc = sections.characters?.[1]
    expect(importedNpc?.portraits.map((item) => [item.id, item.groups])).toEqual([
      ['normal', ['normal']],
      ['dual', ['normal']],
    ])
    expect(importedNpc?.defaultPortraitIds).toEqual({ normal: 'normal' })
    expect(sections.nsfw).toBeUndefined()
    expect(zip.file('portraits/npc-1/nsfw.png')).toBeNull()
  })
})
