import { describe, expect, it } from 'vitest'
import { clampOffset, getImageLayout } from './PortraitCropDialog'

describe('portrait crop geometry', () => {
  it('covers a fixed 2:3 crop frame without changing image ratio', () => {
    const layout = getImageLayout({ width: 1600, height: 900 }, { width: 400, height: 600 }, 1)
    expect(layout.width / layout.height).toBeCloseTo(1600 / 900)
    expect(layout.width).toBeGreaterThanOrEqual(400)
    expect(layout.height).toBeGreaterThanOrEqual(600)
  })

  it('keeps dragging inside the covered image', () => {
    expect(clampOffset({ x: 999, y: -999 }, { width: 800, height: 600 }, { width: 400, height: 600 }))
      .toEqual({ x: 200, y: 0 })
  })
})
