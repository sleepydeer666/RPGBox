export function resolvePlayback<T>(busy: boolean, completed: T[], streaming: T[], requestedIndex: number) {
  const segments = busy ? streaming : completed
  const index = Math.min(Math.max(0, requestedIndex), Math.max(0, segments.length - 1))
  const atAvailableEnd = segments.length === 0 || index >= segments.length - 1
  return {
    segments,
    index,
    current: segments[index],
    atAvailableEnd,
    canAdvance: segments.length > 0 && !atAvailableEnd,
    complete: !busy && atAvailableEnd,
  }
}

export function completeStreamingLines(text: string): string {
  const lastLineBreak = text.lastIndexOf('\n')
  return lastLineBreak < 0 ? '' : text.slice(0, lastLineBreak + 1)
}
