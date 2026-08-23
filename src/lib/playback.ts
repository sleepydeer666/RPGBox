import { parseAssistantResponse, type ResponseParseContext } from './parser'
import type { PortraitGroup, StorySegment } from '../types'

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

export function resolvePlaybackContentMode(
  choicesVisible: boolean,
  currentSegment: StorySegment | undefined,
  initialMode: PortraitGroup,
  finalMode: PortraitGroup,
  manualOverride?: PortraitGroup,
): PortraitGroup {
  if (manualOverride) return manualOverride
  return choicesVisible ? finalMode : currentSegment?.rpgStateId ?? initialMode
}

export function hasCompleteVisibleContent(
  text: string,
  context: ResponseParseContext = {},
  responseComplete = false,
): boolean {
  const completeText = responseComplete ? text : completeStreamingLines(text)
  return parseAssistantResponse(completeText, context).segments.length > 0
}

export function reachedChapterBoundaryStart(
  boundaryIndexes: number[],
  segmentIndex: number,
  segmentsComplete: boolean,
): number | undefined {
  return boundaryIndexes
    .filter((index) => index <= segmentIndex || (segmentsComplete && index === segmentIndex + 1))
    .at(-1)
}
