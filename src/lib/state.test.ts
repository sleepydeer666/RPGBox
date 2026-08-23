import { describe, expect, it } from 'vitest'
import { applyRpgStatePatch } from './state'

describe('applyRpgStatePatch', () => {
  const current = { location: '旅店', time: '夜晚', contentMode: 'normal' as const, values: {} }

  it('accepts a narrative mode update without an RPG-level gate', () => {
    expect(applyRpgStatePatch(current, { contentMode: 'nsfw' }).contentMode).toBe('nsfw')
  })

  it('preserves the current narrative mode without a patch', () => {
    expect(applyRpgStatePatch({ ...current, contentMode: 'nsfw' }, undefined).contentMode).toBe('nsfw')
  })
})
