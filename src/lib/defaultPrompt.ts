let cachedDefaultPrompt: string | undefined

export function resolveGlobalJailbreakPrompt(userPrompt: string, bundledPrompt: string): string {
  return userPrompt.trim() ? userPrompt : bundledPrompt
}

export async function loadBundledDefaultPrompt(): Promise<string> {
  if (cachedDefaultPrompt !== undefined) return cachedDefaultPrompt
  try {
    const response = await fetch('/defaultprompt.txt', { cache: 'no-store' })
    if (!response.ok) return ''
    cachedDefaultPrompt = await response.text()
    return cachedDefaultPrompt
  } catch {
    return ''
  }
}
