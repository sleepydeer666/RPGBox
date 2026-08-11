import { afterEach, describe, expect, it, vi } from 'vitest'
import { completionUrl, extractModelIds, modelsUrl, normalizeBaseUrl, streamCompletion } from './openai'

afterEach(() => vi.restoreAllMocks())

describe('OpenAI-compatible URLs', () => {
  it('builds endpoints from a v1 base URL', () => {
    expect(completionUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions')
    expect(modelsUrl('https://example.com/v1/')).toBe('https://example.com/v1/models')
  })

  it('replaces a full completion URL when listing models', () => {
    expect(modelsUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/models')
  })

  it('normalizes a bare proxy domain to an OpenAI v1 base URL', () => {
    expect(normalizeBaseUrl('example.com')).toBe('https://example.com/v1')
    expect(modelsUrl('example.com')).toBe('https://example.com/v1/models')
  })
})

describe('extractModelIds', () => {
  it('reads and deduplicates the standard OpenAI response', () => {
    expect(extractModelIds({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: 'claude-3.5' }] })).toEqual([
      'claude-3.5',
      'gpt-4o',
    ])
  })

  it('accepts common proxy response variants', () => {
    expect(extractModelIds({ models: ['model-10', { name: 'model-2' }] })).toEqual(['model-2', 'model-10'])
  })
})

describe('streamCompletion', () => {
  it('publishes progressively accumulated SSE content', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"段"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const updates: string[] = []

    const result = await streamCompletion({
      provider: { id: 'test', name: 'test', baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model', models: ['model'], temperature: 1, topP: 1, presencePenalty: 0, frequencyPenalty: 0, maxTokens: 100 },
      messages: [],
      onToken: (text) => updates.push(text),
    })

    expect(updates).toEqual(['第一', '第一段'])
    expect(result).toBe('第一段')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      temperature: 1,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      max_tokens: 100,
      stream: true,
    })
  })
})
