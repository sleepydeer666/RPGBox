import { describe, expect, it } from 'vitest'
import { createDefaultAiSettings } from './game'

describe('createDefaultAiSettings', () => {
  it('uses a conservative default temperature without a provider', () => {
    expect(createDefaultAiSettings().temperature).toBe(0.5)
  })

  it('uses the RPG defaults instead of inheriting the provider output limit', () => {
    const settings = createDefaultAiSettings({
      id: 'provider',
      name: 'Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'fake-key',
      model: 'model',
      models: ['model'],
      temperature: 0.7,
      topP: 0.9,
      presencePenalty: 0,
      frequencyPenalty: 0,
      maxTokens: 5000,
    })

    expect(settings.maxTokens).toBe(10000)
    expect(settings.contextTurns).toBe(15)
  })
})
