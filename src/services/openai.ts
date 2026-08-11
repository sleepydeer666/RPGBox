import type { ProviderProfile } from '../types'

export interface CompletionRequest {
  provider: ProviderProfile
  messages: Array<{ role: string; content: string }>
  signal?: AbortSignal
  onToken?: (fullText: string) => void
}

export function normalizeBaseUrl(baseUrl: string): string {
  const raw = baseUrl.trim()
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withProtocol)
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1'
  return url.toString().replace(/\/+$/, '')
}

export function completionUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

export function modelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/models')) return normalized
  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/models`
  }
  return `${normalized}/models`
}

export function extractModelIds(payload: unknown): string[] {
  let candidates: unknown = payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    candidates = record.data ?? record.models ?? []
  }
  if (!Array.isArray(candidates)) return []

  const ids = candidates.flatMap((candidate) => {
    if (typeof candidate === 'string') return [candidate]
    if (!candidate || typeof candidate !== 'object') return []
    const record = candidate as Record<string, unknown>
    const id = record.id ?? record.name ?? record.model
    return typeof id === 'string' ? [id] : []
  })

  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

export async function fetchAvailableModels(
  provider: Pick<ProviderProfile, 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!provider.baseUrl.trim()) throw new Error('Base URL 不能为空')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`

  const response = await fetch(modelsUrl(provider.baseUrl), { headers, signal })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`获取模型失败 (${response.status}): ${detail.slice(0, 300)}`)
  }
  const models = extractModelIds(await response.json())
  if (!models.length) throw new Error('接口返回成功，但没有找到可用模型')
  return models
}

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return ''
  const choice = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } }
  if (typeof choice.delta?.content === 'string') return choice.delta.content
  if (typeof choice.message?.content === 'string') return choice.message.content
  return ''
}

export async function streamCompletion({
  provider,
  messages,
  signal,
  onToken,
}: CompletionRequest): Promise<string> {
  if (!provider.apiKey.trim()) throw new Error('请先在 API 设置中填写密钥')
  if (!provider.baseUrl.trim() || !provider.model.trim()) throw new Error('Base URL 和模型名不能为空')

  const response = await fetch(completionUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: provider.model.trim(),
      messages,
      temperature: provider.temperature,
      top_p: provider.topP,
      presence_penalty: provider.presencePenalty,
      frequency_penalty: provider.frequencyPenalty,
      max_tokens: provider.maxTokens,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`API 请求失败 (${response.status}): ${detail.slice(0, 300)}`)
  }

  if (!response.body) {
    const payload = await response.json()
    return extractDelta(payload)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const text = extractDelta(await response.json())
    onToken?.(text)
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      fullText = consumeEventLine(line, fullText, onToken)
    }
  }

  if (buffer.trim()) fullText = consumeEventLine(buffer, fullText, onToken)

  return fullText
}

function consumeEventLine(line: string, current: string, onToken?: (fullText: string) => void) {
  const data = line.trim().replace(/^data:\s*/, '')
  if (!data || data === '[DONE]') return current
  try {
    const next = current + extractDelta(JSON.parse(data))
    onToken?.(next)
    return next
  } catch {
    // Providers may insert keepalive comments between SSE events.
    return current
  }
}
