import { describe, expect, it } from 'vitest'
import { resolveCharacterExpression } from './expressions'
import type { CharacterProfile } from '../types'

const character = (patch: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'venus', role: 'npc', name: '维纳斯', gender: '女', description: '', color: '#ffffff', portraits: [], ...patch,
})

describe('resolveCharacterExpression', () => {
  it('localizes generated states when a character has no portraits', () => {
    expect(resolveCharacterExpression(character(), 'playful').displayExpression).toBe('俏皮')
    expect(resolveCharacterExpression(character(), '若有所思').displayExpression).toBe('若有所思')
    expect(resolveCharacterExpression(character(), '开心、害羞').displayExpression).toBe('开心')
  })

  it('uses the configured default portrait when no state matches', () => {
    const result = resolveCharacterExpression(character({
      defaultPortraitId: 'default',
      portraits: [
        { id: 'smile', expression: '微笑', uri: 'smile.png' },
        { id: 'default', expression: '平静', uri: 'neutral.png' },
      ],
    }), '生气')
    expect(result.portrait?.id).toBe('default')
    expect(result.displayExpression).toBe('平静')
  })

  it('uses the default portrait without inventing a display state for an untagged line', () => {
    const result = resolveCharacterExpression(character({
      defaultPortraitId: 'default',
      portraits: [{ id: 'default', expression: '平静', uri: 'neutral.png' }],
    }), '')
    expect(result.portrait?.id).toBe('default')
    expect(result.displayExpression).toBe('')
    expect(resolveCharacterExpression(character(), '').displayExpression).toBe('')
  })

  it('matches multiple tags only inside the active portrait group', () => {
    const result = resolveCharacterExpression(character({
      defaultPortraitIds: { normal: 'normal', nsfw: 'nsfw' },
      portraits: [
        { id: 'normal', expression: '严肃', tags: ['严肃', '担忧'], groups: ['normal'], uri: 'normal.png' },
        { id: 'nsfw', expression: '兴奋', tags: ['兴奋'], groups: ['nsfw'], uri: 'nsfw.png' },
      ],
    }), '担忧', 'normal')
    expect(result.portrait?.id).toBe('normal')
    expect(resolveCharacterExpression(character({
      defaultPortraitIds: { nsfw: 'nsfw' },
      portraits: [
        { id: 'normal', expression: '严肃', tags: ['严肃'], groups: ['normal'], uri: 'normal.png' },
        { id: 'nsfw', expression: '兴奋', tags: ['兴奋'], groups: ['nsfw'], uri: 'nsfw.png' },
      ],
    }), '严肃', 'nsfw').portrait?.id).toBe('nsfw')
  })

  it('uses only the first valid configured state from a combined model response', () => {
    const result = resolveCharacterExpression(character({
      portraits: [
        { id: 'happy', expression: '开心', tags: ['开心'], groups: ['normal'], uri: 'happy.png' },
        { id: 'worried', expression: '担忧', tags: ['担忧'], groups: ['normal'], uri: 'worried.png' },
      ],
    }), '未知、担忧、开心', 'normal')
    expect(result.portrait?.id).toBe('worried')
    expect(result.displayExpression).toBe('担忧')
  })

  it('does not display a portrait for an invalid tag when the active group has no default', () => {
    const profile = character({
      portraits: [
        { id: 'happy', expression: '开心', tags: ['开心'], groups: ['normal'], uri: 'happy.png' },
        { id: 'nsfw', expression: '迷乱', tags: ['迷乱'], groups: ['nsfw'], uri: 'nsfw.png' },
      ],
    })
    expect(resolveCharacterExpression(profile, '惊讶', 'normal').portrait).toBeUndefined()
    expect(resolveCharacterExpression(profile, '开心', 'normal').portrait?.id).toBe('happy')
    expect(resolveCharacterExpression(profile, '迷乱', 'normal').portrait).toBeUndefined()
  })

  it('keeps portraits with an explicit empty mode list inactive', () => {
    const profile = character({
      defaultPortraitIds: { normal: 'unused' },
      portraits: [{ id: 'unused', expression: '备用', tags: ['备用'], groups: [], uri: 'unused.png' }],
    })
    expect(resolveCharacterExpression(profile, '备用', 'normal').portrait).toBeUndefined()
  })
})
