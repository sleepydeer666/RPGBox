import { describe, expect, it } from 'vitest'
import { formatPortraitTags, parsePortraitTags } from './portraitTags'

describe('portrait tag editing', () => {
  it('accepts Chinese commas, English commas, enumeration commas and semicolons', () => {
    expect(parsePortraitTags('严肃，担忧,疑惑、认真；平静')).toEqual(['严肃', '担忧', '疑惑', '认真', '平静'])
  })

  it('removes empty and duplicate tags', () => {
    expect(parsePortraitTags('开心，， 开心,羞涩')).toEqual(['开心', '羞涩'])
  })

  it('formats saved tags consistently without changing their order', () => {
    expect(formatPortraitTags(['严肃', '担忧'])).toBe('严肃，担忧')
  })
})
