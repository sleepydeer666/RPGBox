import { describe, expect, it } from 'vitest'
import { applyChromaKey, type ImageDataLike } from './chromaKey'

function makeImage(width: number, height: number, color: [number, number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color[0]
    data[index * 4 + 1] = color[1]
    data[index * 4 + 2] = color[2]
    data[index * 4 + 3] = color[3]
  }
  return { width, height, data }
}

describe('applyChromaKey', () => {
  it('uses corner colors as the background key and removes nearby pixels', () => {
    const image = makeImage(4, 4, [77, 194, 127, 255])
    image.data.set([240, 60, 90, 255], (1 * 4 + 1) * 4)

    const result = applyChromaKey(image, {
      preferredScreen: 'auto',
      cornerSize: 1,
      cornerThreshold: 20,
      tolerance: 20,
      opaqueDistance: 80,
    })

    expect(result.method).toBe('corner-auto')
    expect(result.keyColor).toEqual([77, 194, 127])
    expect(result.transparentPixels).toBeGreaterThan(0)
    expect(result.data[3]).toBe(0)
    expect(result.data[(1 * 4 + 1) * 4 + 3]).toBe(255)
  })

  it('grays near-background edge pixels without changing transparency', () => {
    const image = makeImage(3, 3, [77, 194, 127, 255])
    image.data.set([90, 205, 140, 255], (1 * 3 + 1) * 4)
    const result = applyChromaKey(image, {
      preferredScreen: 'auto',
      cornerSize: 1,
      cornerThreshold: 20,
      tolerance: 20,
      edgeGrayDistance: 80,
      edgeGrayRadius: 1,
    })

    expect(result.data[3]).toBe(0)
    const center = (1 * 3 + 1) * 4
    expect(result.data[center + 3]).toBe(255)
    expect(result.data[center + 1]).toBeLessThan(205)
    expect(result.data[center]).toBeGreaterThan(90)
    expect(result.data[center + 2]).toBeGreaterThan(140)
  })
})
