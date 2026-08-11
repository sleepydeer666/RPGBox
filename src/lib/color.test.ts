import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, normalizeHexColor } from './color'

describe('character colors', () => {
  it('uses a fully saturated, fully bright fallback for an empty color', () => {
    expect(normalizeHexColor('')).toBe('#ff0000')
    expect(hexToHsv('')).toEqual({ h: 0, s: 100, v: 100 })
  })

  it('round-trips representative HSV colors', () => {
    expect(hsvToHex({ h: 40, s: 100, v: 100 })).toBe('#ffaa00')
    expect(hexToHsv('#ffaa00')).toEqual({ h: 40, s: 100, v: 100 })
  })

  it('expands three-digit hexadecimal colors', () => {
    expect(normalizeHexColor('#fa0')).toBe('#ffaa00')
  })
})
