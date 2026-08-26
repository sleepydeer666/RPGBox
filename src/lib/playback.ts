import { parseAssistantResponse, type ResponseParseContext } from './parser'
import type { ParsedResponse, PortraitGroup, StorySegment } from '../types'

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

function playbackSegmentKey(segment: StorySegment): string {
  return [segment.type, segment.characterId ?? segment.characterName ?? '', segment.text].join('\u0000')
}

export function reconcilePlaybackIndex(
  streaming: StorySegment[],
  completed: StorySegment[],
  requestedIndex: number,
): number {
  if (!streaming.length || !completed.length) return Math.min(Math.max(0, requestedIndex), Math.max(0, completed.length - 1))
  const streamingIndex = Math.min(Math.max(0, requestedIndex), streaming.length - 1)
  const key = playbackSegmentKey(streaming[streamingIndex])
  const occurrence = streaming.slice(0, streamingIndex + 1).filter((segment) => playbackSegmentKey(segment) === key).length - 1
  const matches = completed.flatMap((segment, index) => playbackSegmentKey(segment) === key ? [index] : [])
  return matches[occurrence] ?? matches.sort((a, b) => Math.abs(a - streamingIndex) - Math.abs(b - streamingIndex))[0]
    ?? Math.min(streamingIndex, completed.length - 1)
}

export function completedTurnPlaybackIndex(segmentCount: number, choiceCount: number): number {
  return choiceCount > 0 ? segmentCount : Math.max(0, segmentCount - 1)
}

export function isChoicePageVisible(
  busy: boolean,
  segmentCount: number,
  choiceCount: number,
  requestedIndex: number,
): boolean {
  return !busy && choiceCount > 0 && (segmentCount === 0 || requestedIndex >= segmentCount)
}

export function completeStreamingLines(text: string): string {
  const lastLineBreak = text.lastIndexOf('\n')
  return lastLineBreak < 0 ? '' : text.slice(0, lastLineBreak + 1)
}

export function parsePlaybackResponse(
  raw: string,
  context: ResponseParseContext = {},
  responseComplete = false,
): ParsedResponse {
  const parseable = responseComplete ? raw : completeStreamingLines(raw)
  return parseAssistantResponse(parseable, context)
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

function normalizedPresentCharacters(segment: StorySegment | undefined): string[] {
  const ids = segment?.presentCharacterIds ?? segment?.statePatch?.presentCharacterIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice().sort() : []
}

export function scenePresentationChanged(previous: StorySegment | undefined, current: StorySegment | undefined): boolean {
  const previousLocation = typeof previous?.statePatch?.location === 'string' ? previous.statePatch.location : ''
  const currentLocation = typeof current?.statePatch?.location === 'string' ? current.statePatch.location : ''
  if (previousLocation !== currentLocation) return true
  const previousCharacters = normalizedPresentCharacters(previous)
  const currentCharacters = normalizedPresentCharacters(current)
  return previousCharacters.length !== currentCharacters.length
    || previousCharacters.some((id, index) => id !== currentCharacters[index])
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
