export type Role = 'system' | 'user' | 'assistant'

export interface DebugPromptSegment {
  title: string
  role: Role
  content: string
}

export interface MemorySummaryDebugEntry {
  label: string
  request: string
  response: string
  inputTokens?: number
  outputTokens?: number
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  requestContent?: string
  requestSegments?: DebugPromptSegment[]
  rawContent?: string
  repairContent?: string
  /** String is retained for debug records created by older app versions. */
  memorySummaryDebug?: string | MemorySummaryDebugEntry[]
  inputTokens?: number
  outputTokens?: number
  selectedChoiceIds?: string[]
  customInput?: string
  chapterTitle?: string
  /** Narrative mode in effect before this turn's first visible segment. */
  initialRpgStateId?: PortraitGroup
  /** Client-owned RPG state used to generate and render this turn. */
  rpgStateId?: PortraitGroup
  createdAt: number
}

export interface Choice {
  id: string
  text: string
  targetContentMode?: PortraitGroup
}

export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models: string[]
  temperature: number
  topP: number
  presencePenalty: number
  frequencyPenalty: number
  maxTokens: number
}

export interface GameAiSettings {
  providerId: string
  model: string
  useCompatiblePromptFormat: boolean
  temperature: number
  topP: number
  presencePenalty: number
  frequencyPenalty: number
  maxTokens: number
  contextTurns: number
  warnOnProtocolAnomaly: boolean
}

export interface CharacterPortrait {
  id: string
  expression: string
  uri: string
  tags?: string[]
  groups?: PortraitGroup[]
}

export type PortraitGroup = string

export interface NarrativeMode {
  id: PortraitGroup
  name: string
  color: string
}

export interface CharacterProfile {
  id: string
  role: 'player' | 'npc'
  name: string
  gender: string
  description: string
  modeDescriptions?: Partial<Record<PortraitGroup, string>>
  statusBar?: string
  color: string
  portraits: CharacterPortrait[]
  defaultPortraitId?: string
  defaultPortraitIds?: Partial<Record<PortraitGroup, string>>
}

export interface GameState {
  location: string
  time: string
  contentMode: PortraitGroup
  values: Record<string, string | number | boolean>
  /** Character IDs explicitly reported as present in the current scene. */
  presentCharacterIds?: string[]
}

export interface MemoryState {
  chapterMemoryEnabled?: boolean
  distantMemoryEnabled?: boolean
  characterExperienceEnabled?: boolean
  currentChapterSummary?: string
  recentChapters?: ChapterMemory[]
  recentChapterLimit?: number
  historicalSummary: string
  chapterSummaryInstructions?: string
  distantSummaryInstructions?: string
  characterExperienceInstructions?: string
  characterExperiences?: Record<string, string>
  chapterSummary?: string
  turnsSinceUnitStart?: number
}

export interface ChapterMemory {
  id: string
  title: string
  summary: string
  completedAt: number
  sourceMessageIds?: string[]
}

export interface NarrativeStage {
  id: string
  title: string
  startedAtMessageId: string
}

export interface NarrativeProgress {
  chapter: NarrativeStage
  /** Client-owned chapter lifecycle. Missing values are normalized on load. */
  chapterPhase?: 'opening' | 'active' | 'transition'
  unit?: NarrativeStage
}

export interface RollbackSnapshot {
  id: string
  createdAt: number
  messageCount: number
  gameState: GameState
  narrative: NarrativeProgress
  memory: MemoryState
  characterStatuses?: Record<string, string>
}

export interface ProgressEvent {
  type: 'chapter_start' | 'chapter_end' | 'unit_start'
  title?: string
}

export interface StorySegment {
  type: 'narration' | 'dialogue'
  text: string
  /** Narrative mode in effect while this segment is displayed. */
  rpgStateId?: PortraitGroup
  /** Latest scene state that becomes active at this segment. */
  statePatch?: Record<string, unknown>
  presentCharacterIds?: string[]
  characterId?: string
  characterName?: string
  expression?: string
}

export interface GameSession {
  id: string
  title: string
  note: string
  narrativeModes?: NarrativeMode[]
  newStoryChoiceCount: number
  systemPrompt: string
  aiSettings: GameAiSettings
  storyStylePrompt: string
  modeStoryStylePrompts?: Partial<Record<PortraitGroup, string>>
  chapterTransitionRules?: string
  narrativeModeRulesPrompt?: string
  recommendedChapterTurnsEnabled?: boolean
  recommendedChapterTurns?: number
  statusRulesPrompt?: string
  nsfwScenePrompt: string
  worldSettingPrompt: string
  characters: CharacterProfile[]
  messages: ChatMessage[]
  gameState: GameState
  narrative: NarrativeProgress
  memory: MemoryState
  rollbackLog?: RollbackSnapshot[]
  updatedAt: number
}

export interface GameData {
  choices?: Choice[]
  segments?: StorySegment[]
  statePatch?: Record<string, unknown>
  memoryCandidates?: string[]
  chapterTitle?: string
}

export interface ParsedResponse {
  story: string
  segments: StorySegment[]
  /** Segment indexes that begin after an invisible chapter boundary. */
  chapterBoundaryIndexes: number[]
  choices: Choice[]
  gameData: GameData | null
  progressEvents: ProgressEvent[]
  chapterTitle?: string
  newChapterTitle?: string
  /** Segment indexes where a valid client-requested narrative mode becomes active. */
  narrativeModeSwitchIndexes: number[]
  characterStatusUpdates: CharacterStatusUpdate[]
}

export interface CharacterStatusUpdate {
  characterId: string
  characterName: string
  status: string
}
