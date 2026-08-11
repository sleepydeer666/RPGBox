import { describe, expect, it } from 'vitest'
import { applyRpgStatePatch } from './state'

describe('applyRpgStatePatch', () => {
  const current = { location: '旅店', time: '夜晚', contentMode: 'normal' as const, values: {} }

  it('accepts NSFW mode only when the RPG enables it', () => {
    expect(applyRpgStatePatch(current, { contentMode: 'nsfw' }, true).contentMode).toBe('nsfw')
    expect(applyRpgStatePatch(current, { contentMode: 'nsfw' }, false).contentMode).toBe('normal')
  })

  it('normalizes an existing NSFW state when the RPG disables it', () => {
    expect(applyRpgStatePatch({ ...current, contentMode: 'nsfw' }, undefined, false).contentMode).toBe('normal')
  })
})
