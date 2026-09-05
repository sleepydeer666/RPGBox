import { describe, expect, it } from 'vitest'
import { applyChromaKey, isBackgroundPixelV2, type ImageDataLike } from './chromaKeyV2'

function makeImage(width: number, height: number, color: [number, number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(color, index * 4)
  return { width, height, data }
}

describe('chromaKeyV2', () => {
  it('keeps a bright green-gradient background removable by hue', () => {
    const image = makeImage(3, 3, [77, 194, 127, 255])
    image.data.set([145, 235, 165, 255], 4)
    image.data.set([244, 244, 226, 255], 8)
    const result = applyChromaKey(image, {
      preferredScreen: 'green',
      tolerance: 20,
      hueTolerance: 42,
      minSaturation: 0.18,
      minChannelDominance: 18,
      edgeGrayRadius: 0,
    })
    expect(result.data[3]).toBe(0)
    expect(result.data[7]).toBe(0)
    expect(result.data[11]).toBe(255)
  })

  it('does not remove a pale low-saturation subject pixel', () => {
    expect(isBackgroundPixelV2([232, 226, 201], [77, 194, 127], {
      tolerance: 20,
      hueTolerance: 42,
      minSaturation: 0.18,
      minChannelDominance: 18,
    })).toBe(false)
  })

  it('clears RGB when a pixel is removed and preserves subject RGB', () => {
    const image = makeImage(2, 1, [77, 194, 127, 255])
    image.data.set([120, 55, 80, 255], 4)
    const result = applyChromaKey(image, { preferredScreen: 'green', edgeGrayRadius: 0 })
    expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(result.data.slice(4, 8))).toEqual([120, 55, 80, 255])
  })
})
