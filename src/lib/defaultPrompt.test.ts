import { describe, expect, it } from 'vitest'
import { resolveGlobalJailbreakPrompt } from './defaultPrompt'

describe('default jailbreak prompt fallback', () => {
  it('uses the user value when it contains non-whitespace text', () => {
    expect(resolveGlobalJailbreakPrompt(' user prompt ', 'bundled prompt')).toBe(' user prompt ')
  })

  it('uses the bundled value when the user value is empty', () => {
    expect(resolveGlobalJailbreakPrompt(' \n\t', 'bundled prompt')).toBe('bundled prompt')
  })
})
