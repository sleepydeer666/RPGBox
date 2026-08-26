import { describe, expect, it } from 'vitest'
import { buildTurnStateInstruction, choiceActionText, narrativeModeSwitchLine, parseChoiceStateTransition, parseNarrativeModeSwitchLine, resolveTurnContentMode } from './rpgState'

describe('RPG state transitions', () => {
  const choices = [
    { id: 'A', text: '保持距离（后续叙事模式：正常）', targetContentMode: 'normal' as const },
    { id: 'B', text: '靠近她（后续叙事模式：NSFW）', targetContentMode: 'nsfw' as const },
    { id: 'C', text: '返回大厅（后续叙事模式：正常）', targetContentMode: 'normal' as const },
  ]

  it('parses the next-mode marker with full-width or half-width punctuation', () => {
    expect(parseChoiceStateTransition('靠近她（后续叙事模式：NSFW）')).toBe('nsfw')
    expect(parseChoiceStateTransition('返回大厅（后续叙事模式：正常）（结束章节）')).toBe('normal')
    expect(parseChoiceStateTransition('靠近她(后续叙事模式：NSFW)')).toBe('nsfw')
    expect(parseChoiceStateTransition('返回大厅(后续叙事模式:正常)(结束章节)')).toBe('normal')
    expect(parseChoiceStateTransition('靠近她（后续叙事模式：NSFW)')).toBe('nsfw')
    expect(parseChoiceStateTransition('靠近她（后续状态：NSFW）')).toBeUndefined()
    expect(parseChoiceStateTransition('靠近她（状态切换：NSFW）')).toBeUndefined()
    expect(parseChoiceStateTransition('提到（状态切换：NSFW）但不切换')).toBeUndefined()
    expect(choiceActionText('返回大厅（后续叙事模式：正常）（结束章节）')).toBe('返回大厅')
    expect(choiceActionText('返回大厅(后续叙事模式:正常)(结束章节)')).toBe('返回大厅')
  })

  it('uses lock, then the earliest selected transition, then the current state', () => {
    expect(resolveTurnContentMode('normal', true, choices, ['B'])).toBe('normal')
    expect(resolveTurnContentMode('normal', false, choices, ['C', 'B'])).toBe('nsfw')
    expect(resolveTurnContentMode('nsfw', false, choices, ['A'])).toBe('normal')
  })

  it('resets to the default state when a chapter ends, overriding labels and locks', () => {
    expect(resolveTurnContentMode('nsfw', true, choices, ['B'], true)).toBe('normal')
    expect(resolveTurnContentMode('normal', false, choices, ['B'], true)).toBe('normal')
  })

  it('builds client-owned current and mandatory next-state instructions', () => {
    expect(buildTurnStateInstruction('normal', true)).toContain('当前叙事模式：正常')
    expect(buildTurnStateInstruction('normal', true)).toContain('本轮叙事模式锁定')
    expect(buildTurnStateInstruction('normal', true)).toContain('后续叙事模式：正常、NSFW')
    expect(buildTurnStateInstruction('normal', true)).toContain('可选章节操作：结束章节')
    expect(buildTurnStateInstruction('normal', true)).toContain('每个选项末尾必须标记')
    expect(buildTurnStateInstruction('normal', true)).toContain('在后续叙事模式标签之后标记“（结束章节）”')
    expect(buildTurnStateInstruction('normal', false)).toContain('后续叙事模式：正常、NSFW')
  })

  it('accepts only the client-requested narrative mode switch label', () => {
    const modes = [{ id: 'battle', name: '战斗服', color: '#f00' }, { id: 'work', name: '工作服', color: '#0f0' }]
    expect(narrativeModeSwitchLine('work', modes)).toBe('[叙事模式切换] 工作服')
    expect(parseNarrativeModeSwitchLine('[叙事模式切换] 工作服', 'work', modes)).toBe('work')
    expect(parseNarrativeModeSwitchLine('[叙事模式切换] 战斗服', 'work', modes)).toBeUndefined()
    expect(parseNarrativeModeSwitchLine('[状态] 叙事模式：工作服', 'work', modes)).toBeUndefined()
  })
})
