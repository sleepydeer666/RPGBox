export type Rgb = [number, number, number]

export interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface CornerColorSample {
  name: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  color: Rgb
}

export interface ChromaKeyOptions {
  preferredScreen?: 'auto' | 'green' | 'blue' | 'red'
  fallbackScreen?: 'auto' | 'green' | 'blue' | 'red'
  screenColor?: Rgb
  cornerSize?: number
  cornerThreshold?: number
  borderWidth?: number
  minAlpha?: number
  tolerance?: number
  edgeGrayDistance?: number
  edgeGrayRadius?: number
  edgeGrayBias?: number
  opaqueDistance?: number
  gamma?: number
  despill?: number
  keepTransparentRgb?: boolean
  hueTolerance?: number
  minSaturation?: number
  minChannelDominance?: number
}

export interface ChromaKeyResult extends ImageDataLike {
  method: 'manual' | 'screen' | 'corner-auto' | 'border-auto'
  keyColor: Rgb
  cornerColors: CornerColorSample[]
  transparentPixels: number
}

const SCREEN_COLORS: Record<'green' | 'blue' | 'red', Rgb> = {
  green: [0, 255, 0],
  blue: [0, 0, 255],
  red: [255, 0, 0],
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampByte(value: number) {
  return clamp(Math.round(value), 0, 255)
}

function distanceL1(left: Rgb, right: Rgb) {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2])
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function medianColor(samples: Rgb[]): Rgb {
  if (!samples.length) throw new Error('No samples available')
  const channels = [0, 1, 2].map((index) => median(samples.map((sample) => sample[index])))
  return [clampByte(channels[0]), clampByte(channels[1]), clampByte(channels[2])]
}

function getPixel(image: ImageDataLike, x: number, y: number): [number, number, number, number] {
  const index = (y * image.width + x) * 4
  return [
    image.data[index],
    image.data[index + 1],
    image.data[index + 2],
    image.data[index + 3],
  ]
}

function setPixel(image: ImageDataLike, x: number, y: number, pixel: [number, number, number, number]) {
  const index = (y * image.width + x) * 4
  image.data[index] = pixel[0]
  image.data[index + 1] = pixel[1]
  image.data[index + 2] = pixel[2]
  image.data[index + 3] = pixel[3]
}

export function sampleCornerColors(image: ImageDataLike, cornerSize = 1): CornerColorSample[] {
  const size = clamp(Math.floor(cornerSize), 1, Math.min(image.width, image.height))
  const corners: Array<[CornerColorSample['name'], number, number]> = [
    ['topLeft', 0, 0],
    ['topRight', Math.max(0, image.width - size), 0],
    ['bottomLeft', 0, Math.max(0, image.height - size)],
    ['bottomRight', Math.max(0, image.width - size), Math.max(0, image.height - size)],
  ]

  return corners.map(([name, startX, startY]) => {
    const samples: Rgb[] = []
    for (let y = startY; y < Math.min(image.height, startY + size); y += 1) {
      for (let x = startX; x < Math.min(image.width, startX + size); x += 1) {
        const [r, g, b] = getPixel(image, x, y)
        samples.push([r, g, b])
      }
    }
    return { name, color: medianColor(samples) }
  })
}

export function clusterCornerColors(samples: CornerColorSample[], threshold = 20) {
  const clusters: CornerColorSample[][] = []
  for (const sample of samples) {
    const target = clusters.find((cluster) => distanceL1(cluster[0].color, sample.color) <= threshold)
    if (target) target.push(sample)
    else clusters.push([sample])
  }
  clusters.sort((left, right) => right.length - left.length)
  return clusters
}

export function sampleBorderColors(image: ImageDataLike, minAlpha = 64, borderWidth = 24): Rgb[] {
  const samples: Rgb[] = []
  const width = Math.max(1, Math.min(borderWidth, Math.floor(image.width / 2)))
  const height = Math.max(1, Math.min(borderWidth, Math.floor(image.height / 2)))

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const isBorder = x < width || y < height || x >= image.width - width || y >= image.height - height
      if (!isBorder) continue
      const [r, g, b, a] = getPixel(image, x, y)
      if (a >= minAlpha) samples.push([r, g, b])
    }
  }

  return samples
}

export function estimateKeyColor(
  image: ImageDataLike,
  options: ChromaKeyOptions = {},
): { method: ChromaKeyResult['method']; keyColor: Rgb; cornerColors: CornerColorSample[] } {
  const preferredScreen = options.preferredScreen ?? 'auto'
  const fallbackScreen = options.fallbackScreen ?? 'auto'
  const cornerSize = options.cornerSize ?? 1
  const cornerThreshold = options.cornerThreshold ?? 20
  const borderWidth = options.borderWidth ?? 24
  const minAlpha = options.minAlpha ?? 64

  if (options.screenColor) {
    return { method: 'manual', keyColor: options.screenColor, cornerColors: sampleCornerColors(image, cornerSize) }
  }
  if (preferredScreen !== 'auto') {
    return {
      method: 'screen',
      keyColor: SCREEN_COLORS[preferredScreen],
      cornerColors: sampleCornerColors(image, cornerSize),
    }
  }
  if (fallbackScreen !== 'auto') {
    return {
      method: 'screen',
      keyColor: SCREEN_COLORS[fallbackScreen],
      cornerColors: sampleCornerColors(image, cornerSize),
    }
  }

  const cornerColors = sampleCornerColors(image, cornerSize)
  const clusters = clusterCornerColors(cornerColors, cornerThreshold)
  if (clusters[0]?.length >= 3) {
    return {
      method: 'corner-auto',
      keyColor: medianColor(clusters[0].map((sample) => sample.color)),
      cornerColors,
    }
  }

  const borderSamples = sampleBorderColors(image, minAlpha, borderWidth)
  if (borderSamples.length) {
    return { method: 'border-auto', keyColor: medianColor(borderSamples), cornerColors }
  }

  return { method: 'corner-auto', keyColor: medianColor(cornerColors.map((sample) => sample.color)), cornerColors }
}

function rgbToHsv([red, green, blue]: Rgb): [number, number, number] {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  if (hue < 0) hue += 360
  return [hue, max ? delta / max : 0, max]
}

function hueDistance(left: number, right: number) {
  const distance = Math.abs(left - right)
  return Math.min(distance, 360 - distance)
}

function dominantChannel(color: Rgb) {
  return color.indexOf(Math.max(...color))
}

export function isBackgroundPixelV2(
  pixel: Rgb,
  keyColor: Rgb,
  options: Pick<ChromaKeyOptions, 'tolerance' | 'hueTolerance' | 'minSaturation' | 'minChannelDominance'> = {},
) {
  const tolerance = clamp(options.tolerance ?? 20, 0, 441.67)
  const hueTolerance = clamp(options.hueTolerance ?? 42, 0, 180)
  const minSaturation = clamp(options.minSaturation ?? 0.18, 0, 1)
  const minChannelDominance = clamp(options.minChannelDominance ?? 18, 0, 255)
  const [hue, saturation] = rgbToHsv(pixel)
  const [keyHue] = rgbToHsv(keyColor)
  const channel = dominantChannel(keyColor)
  const otherChannels = [0, 1, 2].filter((index) => index !== channel)
  const dominance = pixel[channel] - Math.max(pixel[otherChannels[0]], pixel[otherChannels[1]])

  const closeInRgb = distanceL1(pixel, keyColor) <= tolerance
  if (closeInRgb) return true

  // Hue and channel dominance tolerate brightness gradients while protecting
  // pale hair, skin, and clothing that happen to be close in RGB distance.
  if (saturation < minSaturation || dominance < minChannelDominance) return false
  return hueDistance(hue, keyHue) <= hueTolerance
}

function buildTransparentMaskV2(image: ImageDataLike, keyColor: Rgb, options: ChromaKeyOptions) {
  const mask = new Uint8Array(image.width * image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x
      const pixel: Rgb = [image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]]
      if (image.data[index * 4 + 3] > 0 && isBackgroundPixelV2(pixel, keyColor, options)) {
        mask[index] = 1
      }
    }
  }
  return mask
}

function isNearTransparent(mask: Uint8Array, width: number, height: number, x: number, y: number, radius: number) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const targetY = y + offsetY
    if (targetY < 0 || targetY >= height) continue
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const targetX = x + offsetX
      if (targetX < 0 || targetX >= width) continue
      if (mask[targetY * width + targetX]) return true
    }
  }
  return false
}

function grayEdgePixel(
  pixel: [number, number, number, number],
  keyColor: Rgb,
  tolerance: number,
  edgeGrayDistance: number,
  edgeGrayBias: number,
): [number, number, number, number] {
  const [r, g, b, a] = pixel
  const rgb: Rgb = [r, g, b]
  const keyIndex = keyColor.indexOf(Math.max(...keyColor))
  const maxOther = Math.max(rgb[(keyIndex + 1) % 3], rgb[(keyIndex + 2) % 3])
  const keyBias = rgb[keyIndex] - maxOther
  const distance = distanceL1(rgb, keyColor)
  if (distance > edgeGrayDistance && keyBias < edgeGrayBias) return [r, g, b, a]

  const gray = clampByte(r * 0.299 + g * 0.587 + b * 0.114)
  const distanceBlend = distance >= edgeGrayDistance
    ? 0
    : 1 - ((distance - tolerance) / Math.max(1, edgeGrayDistance - tolerance))
  const biasBlend = keyBias <= edgeGrayBias ? 0 : clamp((keyBias - edgeGrayBias) / 64, 0, 1)
  const blend = clamp(Math.max(distanceBlend, biasBlend), 0, 1)
  return [
    clampByte(r * (1 - blend) + gray * blend),
    clampByte(g * (1 - blend) + gray * blend),
    clampByte(b * (1 - blend) + gray * blend),
    a,
  ]
}

export function applyChromaKey(
  image: ImageDataLike,
  options: ChromaKeyOptions = {},
): ChromaKeyResult {
  const { keyColor, cornerColors, method } = estimateKeyColor(image, options)
  const tolerance = options.tolerance ?? 20
  const edgeGrayDistance = options.edgeGrayDistance ?? (tolerance + 24)
  const edgeGrayRadius = Math.max(0, Math.floor(options.edgeGrayRadius ?? 2))
  const edgeGrayBias = options.edgeGrayBias ?? 8
  const gamma = options.gamma ?? 1.15
  const despill = options.despill ?? 0.28

  if (gamma <= 0) throw new Error('gamma must be positive')
  if (despill < 0 || despill > 1) throw new Error('despill must be between 0 and 1')
  if (edgeGrayDistance <= tolerance) throw new Error('edgeGrayDistance must be greater than tolerance')

  const result: ChromaKeyResult = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data.length),
    method,
    keyColor,
    cornerColors,
    transparentPixels: 0,
  }
  const transparentMask = buildTransparentMaskV2(image, keyColor, options)

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x
      const pixel = getPixel(image, x, y)
      if (transparentMask[pixelIndex] || pixel[3] === 0) {
        result.transparentPixels += 1
        setPixel(result, x, y, [0, 0, 0, 0])
        continue
      }
      const next = edgeGrayRadius > 0 && isNearTransparent(transparentMask, image.width, image.height, x, y, edgeGrayRadius)
        ? grayEdgePixel(pixel, keyColor, tolerance, edgeGrayDistance, edgeGrayBias)
        : pixel
      setPixel(result, x, y, next)
    }
  }

  return result
}

export function rgbaToImageDataLike(imageData: ImageData): ImageDataLike {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  }
}

export function imageDataLikeToImageData(image: ImageDataLike): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
}
