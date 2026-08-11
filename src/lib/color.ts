export interface HsvColor {
  h: number
  s: number
  v: number
}

const DEFAULT_COLOR = '#ff0000'

export function normalizeHexColor(value: string, fallback = DEFAULT_COLOR): string {
  const normalized = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/u.test(normalized)) return normalized
  if (/^#[0-9a-f]{3}$/u.test(normalized)) {
    return `#${normalized.slice(1).split('').map((digit) => digit.repeat(2)).join('')}`
  }
  return fallback
}

export function hexToHsv(value: string): HsvColor {
  const hex = normalizeHexColor(value)
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360
  return {
    h: Math.round(hue),
    s: Math.round(max ? (delta / max) * 100 : 0),
    v: Math.round(max * 100),
  }
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const value = clamp(v, 0, 100) / 100
  const chroma = value * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const offset = value - chroma
  const [red, green, blue] = hue < 60 ? [chroma, second, 0]
    : hue < 120 ? [second, chroma, 0]
      : hue < 180 ? [0, chroma, second]
        : hue < 240 ? [0, second, chroma]
          : hue < 300 ? [second, 0, chroma]
            : [chroma, 0, second]
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
