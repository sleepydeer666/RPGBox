export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  requestContent?: string
  rawContent?: string
  repairContent?: string
  memorySummaryDebug?: string
  chapterTitle?: string
  createdAt: number
}

export interface Choice {
  id: string
  text: string
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
  temperature: number
  topP: number
  presencePenalty: number
  frequencyPenalty: number
  maxTokens: number
  contextTurns: number
}

export interface CharacterPortrait {
  id: string
  expression: string
  uri: string
  tags?: string[]
  groups?: PortraitGroup[]
}

export type PortraitGroup = 'normal' | 'nsfw'

export interface CharacterProfile {
  id: string
  role: 'player' | 'npc'
  name: string
  gender: string
  description: string
  nsfwDescription?: string
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
  currentChapterSummary?: string
  recentChapters?: ChapterMemory[]
  recentChapterLimit?: number
  historicalSummary: string
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
  characterId?: string
  characterName?: string
  expression?: string
}

export interface GameSession {
  id: string
  title: string
  note: string
  nsfwEnabled: boolean
  newStoryChoiceCount: number
  systemPrompt: string
  aiSettings: GameAiSettings
  storyStylePrompt: string
  chapterTransitionRules?: string
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
  sceneChanged: boolean
  progressEvents: ProgressEvent[]
  chapterTitle?: string
  characterStatusUpdates: CharacterStatusUpdate[]
}

export interface CharacterStatusUpdate {
  characterId: string
  characterName: string
  status: string
}
