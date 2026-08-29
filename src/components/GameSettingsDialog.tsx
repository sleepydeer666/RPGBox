import { BookOpen, Compass, Download, Eye, FileUp, ImagePlus, Plus, SlidersHorizontal, Star, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { copyPortraitFile, deletePortraitFile, portraitSource, savePortraitFile } from '../lib/portraits'
import { createNpcId } from '../lib/migrations'
import { clampRecentChapterLimit, normalizeMemoryState } from '../lib/memory'
import type { CharacterPortrait, CharacterProfile, GameSession, NarrativeMode, PortraitGroup, ProviderProfile } from '../types'
import { formatPortraitTags, parsePortraitTags } from '../lib/portraitTags'
import { hexToHsv, hsvToHex, normalizeHexColor, type HsvColor } from '../lib/color'
import PortraitCropDialog from './PortraitCropDialog'
import { DeferredInput, DeferredTextarea } from './DeferredFields'
import { exportRolePackage, importRolePackage, inspectRolePackage, ROLE_PACKAGE_DIRECTORY_LABEL } from '../lib/rolePackage'
import { adaptCharacterNarrativeModes, availableNarrativeModes, createNarrativeMode, defaultNarrativeModeId, normalizeNarrativeModes, removeNarrativeMode, uniqueNarrativeModeName } from '../lib/narrativeModes'

interface Props {
  game: GameSession
  games: GameSession[]
  providers: ProviderProfile[]
  fullSystemPrompt: string
  onClose: () => void
  onChange: (game: GameSession) => void
}

type Tab = 'ai' | 'rules' | 'preferences' | 'characters'

type AddCharacterMode = 'new' | 'clone' | 'import'
type RoleImportMode = 'new' | 'replace' | 'portraits'

const RECOMMENDED_CHAPTER_TURNS_DISABLED = 9

export default function GameSettingsDialog({ game, games, providers, fullSystemPrompt, onClose, onChange }: Props) {
  const [tab, setTab] = useState<Tab>('ai')
  const [selectedCharacterId, setSelectedCharacterId] = useState(game.characters[0]?.id ?? '')
  const [selectedCharacterModeId, setSelectedCharacterModeId] = useState(game.gameState.contentMode)
  const [selectedNarrativeStyleId, setSelectedNarrativeStyleId] = useState<PortraitGroup | 'global'>('global')
  const [portraitError, setPortraitError] = useState('')
  const [cropTarget, setCropTarget] = useState<{ characterId: string; file: File } | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [contextTurnsDraft, setContextTurnsDraft] = useState(String(game.aiSettings.contextTurns ?? 15))
  const [memoryLimitDraft, setMemoryLimitDraft] = useState(String(game.memory.recentChapterLimit ?? 5))
  const [maxTokensDraft, setMaxTokensDraft] = useState(String(game.aiSettings.maxTokens))
  const [portraitTagDrafts, setPortraitTagDrafts] = useState<Record<string, string>>({})
  const [narrativeModeNameDrafts, setNarrativeModeNameDrafts] = useState<Record<string, string>>({})
  const [addCharacterOpen, setAddCharacterOpen] = useState(false)
  const [addCharacterMode, setAddCharacterMode] = useState<AddCharacterMode>('new')
  const [cloneGameId, setCloneGameId] = useState(game.id)
  const [cloneCharacterId, setCloneCharacterId] = useState('')
  const [pickedRoleFile, setPickedRoleFile] = useState<File | null>(null)
  const [exportCharacter, setExportCharacter] = useState<CharacterProfile | null>(null)
  const [portraitManagerOpen, setPortraitManagerOpen] = useState(false)
  const [roleWorking, setRoleWorking] = useState(false)
  const [roleNotice, setRoleNotice] = useState('')
  const [roleImportMode, setRoleImportMode] = useState<RoleImportMode | null>(null)
  const cloneGame = games.find((item) => item.id === cloneGameId) ?? game
  const cloneCandidates = cloneGame.characters
  const selectedProvider = providers.find((provider) => provider.id === game.aiSettings.providerId) ?? providers[0]
  const selectedCharacter = game.characters.find((character) => character.id === selectedCharacterId) ?? game.characters[0]
  const narrativeModes = normalizeNarrativeModes(game.narrativeModes)
  const availableModes = availableNarrativeModes(game)
  const defaultModeId = defaultNarrativeModeId(game)
  const selectedCharacterMode = availableModes.find((mode) => mode.id === selectedCharacterModeId) ?? availableModes[0]
  const selectedModeId = selectedCharacterMode?.id ?? defaultModeId
  const sortedPortraits = selectedCharacter ? [...selectedCharacter.portraits].sort((left, right) => {
    const defaultPortraitId = selectedCharacter.defaultPortraitIds?.[selectedModeId]
      ?? (selectedModeId === defaultModeId ? selectedCharacter.defaultPortraitId : undefined)
    const rank = (portrait: CharacterPortrait) => portrait.id === defaultPortraitId
      ? 0
      : (portrait.groups ?? [defaultModeId]).includes(selectedModeId) ? 1 : 2
    return rank(left) - rank(right) || selectedCharacter.portraits.indexOf(left) - selectedCharacter.portraits.indexOf(right)
  }) : []
  const models = useMemo(() => Array.from(new Set([
    ...(selectedProvider?.models?.length ? selectedProvider.models : selectedProvider?.model ? [selectedProvider.model] : []),
    game.aiSettings.model,
  ].filter(Boolean))), [game.aiSettings.model, selectedProvider])

  useEffect(() => {
    if (!selectedCharacter && game.characters[0]) setSelectedCharacterId(game.characters[0].id)
  }, [game.characters, selectedCharacter])

  useEffect(() => {
    if (!availableModes.some((mode) => mode.id === selectedCharacterModeId)) setSelectedCharacterModeId(availableModes[0]?.id ?? '')
  }, [availableModes, selectedCharacterModeId])

  useEffect(() => {
    if (selectedNarrativeStyleId !== 'global' && !availableModes.some((mode) => mode.id === selectedNarrativeStyleId)) {
      setSelectedNarrativeStyleId('global')
    }
  }, [availableModes, selectedNarrativeStyleId])

  useEffect(() => {
    setContextTurnsDraft(String(game.aiSettings.contextTurns ?? 15))
    setMemoryLimitDraft(String(game.memory.recentChapterLimit ?? 5))
    setMaxTokensDraft(String(game.aiSettings.maxTokens))
    setPortraitTagDrafts({})
    setNarrativeModeNameDrafts({})
  }, [game.id])

  useEffect(() => {
    if (!roleImportMode) return
    setRoleNotice({
      new: '将创建全新角色',
      replace: '将替换原有角色',
      portraits: '将仅更新立绘',
    }[roleImportMode])
  }, [roleImportMode])

  function patchGame(patch: Partial<GameSession>) {
    onChange({ ...game, ...patch, updatedAt: Date.now() })
  }

  function commitNumericSettings(closeAfter = false) {
    const parsed = Number(contextTurnsDraft)
    const contextTurns = contextTurnsDraft.trim() && Number.isFinite(parsed)
      ? Math.min(100, Math.max(1, Math.round(parsed)))
      : 15
    const parsedMemoryLimit = Number(memoryLimitDraft)
    const recentChapterLimit = memoryLimitDraft.trim() && Number.isFinite(parsedMemoryLimit)
      ? clampRecentChapterLimit(parsedMemoryLimit)
      : 5
    const parsedMaxTokens = Number(maxTokensDraft)
    const maxTokens = maxTokensDraft.trim() && Number.isFinite(parsedMaxTokens)
      ? Math.min(131072, Math.max(128, Math.round(parsedMaxTokens)))
      : 10000
    setContextTurnsDraft(String(contextTurns))
    setMemoryLimitDraft(String(recentChapterLimit))
    setMaxTokensDraft(String(maxTokens))
    if (contextTurns !== game.aiSettings.contextTurns || recentChapterLimit !== game.memory.recentChapterLimit || maxTokens !== game.aiSettings.maxTokens) {
      onChange({
        ...game,
        aiSettings: { ...game.aiSettings, contextTurns, maxTokens },
        memory: { ...normalizeMemoryState(game.memory), recentChapterLimit },
        updatedAt: Date.now(),
      })
    }
    if (closeAfter) onClose()
  }

  function closeDialog() {
    commitNumericSettings(true)
  }

  function patchCharacter(characterId: string, patch: Partial<CharacterProfile>) {
    let characters = game.characters.map((character) => character.id === characterId ? { ...character, ...patch } : character)
    if (patch.role === 'player') {
      characters = characters.map((character) => character.id !== characterId && character.role === 'player'
        ? { ...character, role: 'npc' as const }
        : character)
    }
    patchGame({ characters })
  }

  function createNpc() {
    const id = createNpcId()
    patchGame({ characters: [...game.characters, {
      id,
      role: 'npc',
      name: `NPC ${game.characters.filter((character) => character.role === 'npc').length + 1}`,
      gender: '',
      description: '',
      modeDescriptions: {},
      statusBar: '',
      color: '#d3ab61',
      portraits: [],
    }] })
    setSelectedCharacterId(id)
  }

  function openAddCharacter() {
    setAddCharacterMode('new')
    setCloneGameId(game.id)
    setCloneCharacterId(game.characters.find((character) => character.role === 'npc')?.id ?? '')
    setPickedRoleFile(null)
    setRoleImportMode(null)
    setRoleNotice('')
    setAddCharacterOpen(true)
  }

  async function confirmAddCharacter() {
    setRoleWorking(true)
    setRoleNotice('')
    try {
      if (addCharacterMode === 'new') {
        createNpc()
      } else if (addCharacterMode === 'clone') {
        const source = cloneCandidates.find((character) => character.id === cloneCharacterId)
        if (!source) throw new Error('请选择要克隆的角色')
        const id = createNpcId()
        const clone = structuredClone(source)
        clone.id = id
        clone.role = 'npc'
        const adaptedClone = adaptCharacterNarrativeModes(clone, cloneGame.narrativeModes, narrativeModes)
        adaptedClone.portraits = await Promise.all(adaptedClone.portraits.map(async (portrait) => ({
          ...portrait,
          uri: await copyPortraitFile(portrait.uri, game.id, id),
        })))
        patchGame({ characters: [...game.characters, adaptedClone] })
        setSelectedCharacterId(id)
      } else {
        if (!pickedRoleFile) throw new Error('请选择要导入的角色包')
        const inspected = await inspectRolePackage(pickedRoleFile)
        const existing = game.characters.find((character) => character.name === inspected.name)
        if (existing && !roleImportMode) {
          setRoleNotice('角色已存在，请选择处理方式：')
          return
        }
        const mode = roleImportMode ?? 'new'
        const id = mode === 'new' ? createNpcId() : existing?.id
        if (!id) throw new Error('找不到要处理的同名角色')
        const imported = await importRolePackage(pickedRoleFile, game.id, id, narrativeModes)
        if (mode === 'replace') {
          await Promise.all((existing?.portraits ?? []).map((portrait) => deletePortraitFile(portrait.uri)))
          patchGame({ characters: game.characters.map((character) => character.id === id ? { ...imported, id } : character) })
          setSelectedCharacterId(id)
        } else if (mode === 'portraits') {
          if (!existing) throw new Error('更新立绘需要已有同名角色')
          const oldByTags = new Map(existing.portraits.map((portrait) => [portraitTagsKey(portrait.tags?.length ? portrait.tags : [portrait.expression]), portrait]))
          const usedIds = new Set(existing.portraits.map((portrait) => portrait.id))
          const replacedIds = new Set<string>()
          const replacements = imported.portraits.flatMap((portrait) => {
            const old = oldByTags.get(portraitTagsKey(portrait.tags?.length ? portrait.tags : [portrait.expression]))
            if (!old || replacedIds.has(old.id)) return []
            replacedIds.add(old.id)
            return [{ old, next: { ...portrait, id: old.id } }]
          })
          const additions = imported.portraits.filter((portrait) => !replacements.some(({ next }) => next.uri === portrait.uri)).map((portrait, index) => {
            let id = portrait.id
            if (usedIds.has(id)) id = `portrait-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`
            usedIds.add(id)
            return { ...portrait, id }
          })
          await Promise.all(replacements.map(({ old }) => deletePortraitFile(old.uri)))
          const replacementMap = new Map(replacements.map(({ old, next }) => [old.id, next]))
          const importedIdMap = new Map(imported.portraits.map((portrait) => [portrait.id, replacements.find(({ next }) => next.uri === portrait.uri)?.next.id ?? additions.find((item) => item.uri === portrait.uri)?.id ?? portrait.id]))
          const importedDefaults = Object.fromEntries(Object.entries(imported.defaultPortraitIds ?? {}).map(([group, portraitId]) => [group, importedIdMap.get(portraitId ?? '')]).filter(([, portraitId]) => Boolean(portraitId)))
          const portraits = [...existing.portraits.map((portrait) => replacementMap.get(portrait.id) ?? portrait), ...additions]
          patchGame({ characters: game.characters.map((character) => character.id === id ? { ...character, portraits, defaultPortraitId: importedIdMap.get(imported.defaultPortraitId ?? '') ?? character.defaultPortraitId, defaultPortraitIds: { ...character.defaultPortraitIds, ...importedDefaults } } : character) })
          setSelectedCharacterId(id)
        } else {
          patchGame({ characters: [...game.characters, imported] })
          setSelectedCharacterId(id)
        }
      }
      setAddCharacterOpen(false)
    } catch (error) {
      setRoleNotice(toMessage(error))
    } finally {
      setRoleWorking(false)
    }
  }

  async function confirmExportCharacter() {
    if (!exportCharacter) return
    setRoleWorking(true)
    setRoleNotice('')
    try {
      const path = await exportRolePackage(exportCharacter, narrativeModes)
      setRoleNotice(`已导出：${path}`)
      setExportCharacter(null)
    } catch (error) {
      setRoleNotice(toMessage(error))
    } finally {
      setRoleWorking(false)
    }
  }

  async function addPortrait(characterId: string, file: File) {
    const character = game.characters.find((item) => item.id === characterId)
    if (!character) return
    setPortraitError('')
    try {
      const uri = await savePortraitFile(game.id, character.id, file)
      const portraitId = `portrait-${Date.now()}-${Math.random().toString(16).slice(2)}`
      patchCharacter(character.id, { portraits: [...character.portraits, {
        id: portraitId,
        expression: character.portraits.length ? `expression-${character.portraits.length + 1}` : 'neutral',
        tags: [character.portraits.length ? `expression-${character.portraits.length + 1}` : 'neutral'],
        groups: [selectedModeId],
        uri,
      }], defaultPortraitId: selectedModeId === defaultModeId ? character.defaultPortraitId ?? portraitId : character.defaultPortraitId, defaultPortraitIds: {
        ...character.defaultPortraitIds,
        [selectedModeId]: character.defaultPortraitIds?.[selectedModeId] ?? (selectedModeId === defaultModeId ? character.defaultPortraitId : undefined) ?? portraitId,
      } })
      setCropTarget(null)
    } catch (error) {
      setPortraitError(error instanceof Error ? error.message : '立绘保存失败')
    }
  }

  async function removePortrait(character: CharacterProfile, portraitId: string) {
    const portrait = character.portraits.find((item) => item.id === portraitId)
    if (!portrait || !window.confirm(`确认删除立绘“${portrait.tags?.[0] || portrait.expression || '未命名立绘'}”？删除后无法恢复。`)) return
    await deletePortraitFile(portrait.uri)
    const portraits = character.portraits.filter((item) => item.id !== portraitId)
    const defaultPortraitIds = { ...character.defaultPortraitIds }
    for (const mode of availableModes) {
      const currentDefault = defaultPortraitIds[mode.id]
        ?? (mode.id === defaultModeId ? character.defaultPortraitId : undefined)
      if (currentDefault === portraitId) {
        const replacement = portraits.find((item) => (item.groups ?? [defaultModeId]).includes(mode.id))
        if (replacement) defaultPortraitIds[mode.id] = replacement.id
        else delete defaultPortraitIds[mode.id]
      }
    }
    patchCharacter(character.id, {
      portraits,
      defaultPortraitId: defaultPortraitIds[defaultModeId],
      defaultPortraitIds,
    })
  }

  function patchPortrait(character: CharacterProfile, portraitId: string, patch: Partial<CharacterPortrait>) {
    patchCharacter(character.id, { portraits: character.portraits.map((portrait) => portrait.id === portraitId ? { ...portrait, ...patch } : portrait) })
  }

  function editPortraitTags(character: CharacterProfile, portrait: CharacterPortrait, value: string) {
    const draftKey = `${character.id}:${portrait.id}`
    setPortraitTagDrafts((current) => ({ ...current, [draftKey]: value }))
  }

  function finishPortraitTagEdit(character: CharacterProfile, portrait: CharacterPortrait, value: string) {
    const draftKey = `${character.id}:${portrait.id}`
    const tags = parsePortraitTags(value)
    setPortraitTagDrafts((current) => ({ ...current, [draftKey]: formatPortraitTags(tags) }))
    patchPortrait(character, portrait.id, { tags, expression: tags[0] ?? '' })
  }

  function togglePortraitGroup(character: CharacterProfile, portrait: CharacterPortrait, group: PortraitGroup, checked: boolean) {
    const groups: PortraitGroup[] = portrait.groups ?? [defaultModeId]
    const nextGroups = checked ? Array.from(new Set([...groups, group])) : groups.filter((item) => item !== group)
    const defaults = { ...character.defaultPortraitIds }
    if (!checked && defaults[group] === portrait.id) delete defaults[group]
    patchCharacter(character.id, {
      portraits: character.portraits.map((item) => item.id === portrait.id ? { ...item, groups: nextGroups } : item),
      defaultPortraitIds: defaults,
      defaultPortraitId: group === defaultModeId && !checked && character.defaultPortraitId === portrait.id ? undefined : character.defaultPortraitId,
    })
  }

  function setGroupDefault(character: CharacterProfile, portrait: CharacterPortrait, group: PortraitGroup) {
    const groups = portrait.groups ?? [defaultModeId]
    patchCharacter(character.id, {
      portraits: groups.includes(group)
        ? character.portraits
        : character.portraits.map((item) => item.id === portrait.id ? { ...item, groups: [...groups, group] } : item),
      defaultPortraitIds: { ...character.defaultPortraitIds, [group]: portrait.id },
      defaultPortraitId: group === defaultModeId ? portrait.id : character.defaultPortraitId,
    })
  }

  function addNarrativeMode() {
    patchGame({ narrativeModes: [...narrativeModes, createNarrativeMode(narrativeModes)] })
  }

  function patchNarrativeMode(modeId: string, patch: Partial<NarrativeMode>) {
    patchGame({ narrativeModes: narrativeModes.map((mode) => mode.id === modeId ? { ...mode, ...patch } : mode) })
  }

  function finishNarrativeModeName(mode: NarrativeMode, value: string) {
    if (!value.trim()) {
      setNarrativeModeNameDrafts((current) => ({ ...current, [mode.id]: mode.name }))
      return
    }
    const name = uniqueNarrativeModeName(narrativeModes, mode.id, value)
    setNarrativeModeNameDrafts((current) => ({ ...current, [mode.id]: name }))
    patchNarrativeMode(mode.id, { name })
  }

  function deleteNarrativeMode(modeId: string) {
    if (narrativeModes.length <= 1) return
    const mode = narrativeModes.find((item) => item.id === modeId)
    if (!mode || !window.confirm(`删除叙事模式“${mode.name}”？仅属于该模式的立绘和特殊设定将迁移到相邻的前一个模式。`)) return
    onChange(removeNarrativeMode(game, modeId))
  }

  function removeCharacter(character: CharacterProfile) {
    if (character.role === 'player') return
    patchGame({ characters: game.characters.filter((item) => item.id !== character.id) })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="RPG设置">
      <button className="backdrop" onClick={closeDialog} aria-label="关闭RPG设置" />
      <section className="modal game-settings-modal">
        <div className="modal-head"><div><span className="eyebrow">CURRENT RPG</span><h2>RPG设置</h2></div><button className="icon-button" onClick={closeDialog} title="关闭"><X size={20} /></button></div>
        <nav className="game-settings-tabs" aria-label="RPG设置分类">
          <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><SlidersHorizontal size={16} />AI设置</button>
          <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}><BookOpen size={16} />RPG规则</button>
          <button className={tab === 'preferences' ? 'active' : ''} onClick={() => setTab('preferences')}><Compass size={16} />设定与偏好</button>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}><Users size={16} />登场人物</button>
        </nav>

        <div className="game-settings-content">
          {tab === 'ai' && <section className="game-tab-panel ai-settings-panel">
            <div className="form-section"><h3>接口与模型</h3>
              <label>API 配置<select value={selectedProvider?.id ?? ''} onChange={(event) => { const provider = providers.find((item) => item.id === event.target.value); if (provider) patchGame({ aiSettings: { ...game.aiSettings, providerId: provider.id, model: provider.models[0] ?? provider.model } }) }}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label>
              <label>模型<select value={game.aiSettings.model} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, model: event.target.value } })}>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
            </div>
            <div className="form-section"><h3>模型参数</h3>
              <label className="setting-toggle"><input type="checkbox" checked={game.aiSettings.useCompatiblePromptFormat ?? true} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, useCompatiblePromptFormat: event.target.checked } })} /><span><strong>使用兼容格式</strong><small>关闭兼容模式理论上能够提升稳定性，但部分API不支持。如果LLM返回的格式、内容不符合要求，请保持此选项开启。</small></span></label>
              <ParameterSlider label="温度" min={0} max={2} step={0.05} value={game.aiSettings.temperature} onChange={(temperature) => patchGame({ aiSettings: { ...game.aiSettings, temperature } })} />
              <ParameterSlider label="Top P" min={0} max={1} step={0.05} value={game.aiSettings.topP} onChange={(topP) => patchGame({ aiSettings: { ...game.aiSettings, topP } })} />
              <label>最大输出 Token<input type="number" min="128" max="131072" step="128" value={maxTokensDraft} onChange={(event) => setMaxTokensDraft(event.target.value)} onBlur={() => commitNumericSettings()} /></label>
              <label>对话轮数<input type="number" min="1" max="100" step="1" value={contextTurnsDraft} onChange={(event) => setContextTurnsDraft(event.target.value)} onBlur={() => commitNumericSettings()} /></label>
            </div>
            <div className="form-section"><h3>输出检查</h3>
              <label className="setting-toggle"><input type="checkbox" checked={game.aiSettings.treatMalformedLinesAsNarration ?? false} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, treatMalformedLinesAsNarration: event.target.checked } })} /><span><strong>错误格式以旁白处理</strong><small>针对如deepseek flash等格式遵守能力较弱的模型，激活此功能将把所有错误格式文本作为旁白显示。</small></span></label>
              <label className="setting-toggle"><input type="checkbox" checked={game.aiSettings.warnOnProtocolAnomaly ?? false} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, warnOnProtocolAnomaly: event.target.checked } })} /><span><strong>LLM输出不符合格式时提醒</strong></span></label>
            </div>
          </section>}

          {tab === 'rules' && <section className="game-tab-panel">
            <div className="form-section"><h3>章节切换规则</h3><p className="form-section-description">设置章节结束、过渡和新章节开启时需要遵守的额外规则。内容会在新游戏开始或章节切换时附加到本轮用户指令。</p><DeferredTextarea className="game-prompt-textarea" value={game.chapterTransitionRules ?? ''} onCommit={(chapterTransitionRules) => patchGame({ chapterTransitionRules })} placeholder="例如：章节结束前收束当前矛盾；新章节应延续既有角色关系和状态……" /><ParameterSlider label="章节开始时选项数" min={4} max={10} step={1} precision={0} value={game.newStoryChoiceCount ?? 4} onChange={(newStoryChoiceCount) => patchGame({ newStoryChoiceCount })} /><ParameterSlider label="每章节推荐对话轮数（到达此轮数则优先生成结束选项。如不想激活，可将滚动条拖至最左）" min={RECOMMENDED_CHAPTER_TURNS_DISABLED} max={30} step={1} precision={0} value={game.recommendedChapterTurnsEnabled ? Math.min(30, Math.max(10, game.recommendedChapterTurns ?? 20)) : RECOMMENDED_CHAPTER_TURNS_DISABLED} valueLabel={game.recommendedChapterTurnsEnabled ? undefined : '未激活'} onChange={(value) => patchGame(value === RECOMMENDED_CHAPTER_TURNS_DISABLED ? { recommendedChapterTurnsEnabled: false } : { recommendedChapterTurnsEnabled: true, recommendedChapterTurns: value })} /></div>
            <div className="form-section"><h3>叙事模式切换规则</h3><p className="form-section-description">描述不同叙事模式之间的切换条件，以及不同章节或剧情内容应采用的叙事模式。此规则会始终注入提示词。</p><DeferredTextarea className="game-prompt-textarea" value={game.narrativeModeRulesPrompt ?? ''} onCommit={(narrativeModeRulesPrompt) => patchGame({ narrativeModeRulesPrompt })} placeholder="例如：日常章节使用正常模式；进入亲密情节前通过选项切换至 NSFW 模式……" /></div>
            <div className="form-section"><h3>状态栏规则</h3><p className="form-section-description">定义角色状态栏需要保存的字段、书写格式和更新条件。留空时不会要求AI输出角色状态，也不会自动更新角色状态栏。</p><DeferredTextarea className="game-prompt-textarea" value={game.statusRulesPrompt ?? ''} onCommit={(statusRulesPrompt) => patchGame({ statusRulesPrompt })} placeholder="例如：记录服装、身体状态、情绪和临时效果；只保留当前仍然有效的信息……" /><label className="setting-toggle"><input type="checkbox" checked={game.clearStatusBarAfterChapter ?? true} onChange={(event) => patchGame({ clearStatusBarAfterChapter: event.target.checked })} /><span><strong>章节结束后自动清空状态栏</strong><small>取消勾选，章节结束后保留状态栏</small></span></label></div>
            <div className="form-section"><h3>记忆规则</h3><p className="form-section-description">记忆和角色经历的内容、生成规则可在 RPG 主界面的“记忆”标签下查看。关闭功能不会删除已有内容。</p>
              <label className="setting-toggle"><input type="checkbox" checked={Boolean(normalizeMemoryState(game.memory).chapterMemoryEnabled)} onChange={(event) => patchGame({ memory: { ...normalizeMemoryState(game.memory), chapterMemoryEnabled: event.target.checked } })} /><span><strong>启用章节记忆</strong><small>每章结束后整理本章剧情，保留最近章节的摘要。</small></span></label>
              <ParameterSlider
                label="主记忆章节数"
                min={3}
                max={10}
                step={1}
                precision={0}
                value={clampRecentChapterLimit(Number(memoryLimitDraft))}
                disabled={!normalizeMemoryState(game.memory).chapterMemoryEnabled}
                onChange={(value) => {
                  const recentChapterLimit = clampRecentChapterLimit(value)
                  setMemoryLimitDraft(String(recentChapterLimit))
                  patchGame({ memory: { ...normalizeMemoryState(game.memory), recentChapterLimit } })
                }}
              />
              <p className="form-section-description memory-limit-description">主记忆章节会加入上下文提示词，更早的记忆会自动整理成远期记忆（如启用）。</p>
              {([['distantMemoryEnabled', '启用远期记忆', '章节摘要超出保留上限时，将较早章节压缩为长期事实。'], ['characterExperienceEnabled', '启用角色经历', '章节结束后，基于该章章节记忆按出场比例整理角色的重要事件与关系变化。']] as const).map(([key, label, description]) => <label className="setting-toggle" key={key}><input type="checkbox" checked={Boolean(normalizeMemoryState(game.memory)[key])} onChange={(event) => patchGame({ memory: { ...normalizeMemoryState(game.memory), [key]: event.target.checked } })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}
            </div>
            <div className="form-section narrative-mode-section"><div className="narrative-mode-heading"><div><h3>叙事模式</h3><p className="form-section-description">叙事模式用于区分当前的故事状态，可针对不同状态设计不同的故事生成规则，人物立绘等</p></div><button type="button" className="secondary-button" onClick={addNarrativeMode}><Plus size={15} />新增模式</button></div><div className="narrative-mode-list">{narrativeModes.map((mode, index) => <div className="narrative-mode-row" key={mode.id}><span className="narrative-mode-order">{index + 1}</span><input className="narrative-mode-name-input" aria-label={`叙事模式 ${index + 1} 名称`} value={narrativeModeNameDrafts[mode.id] ?? mode.name} onChange={(event) => setNarrativeModeNameDrafts((current) => ({ ...current, [mode.id]: event.target.value }))} onBlur={(event) => finishNarrativeModeName(mode, event.target.value)} /><CharacterColorControl compact value={mode.color} onChange={(color) => patchNarrativeMode(mode.id, { color })} /><button type="button" className="danger-icon" disabled={narrativeModes.length <= 1} onClick={() => deleteNarrativeMode(mode.id)} title={narrativeModes.length <= 1 ? '至少保留一个叙事模式' : `删除${mode.name}`}><Trash2 size={16} /></button></div>)}</div></div>
          </section>}

          {tab === 'preferences' && <section className="game-tab-panel">
            <div className="form-section"><h3>故事背景设定</h3><p className="form-section-description">设置世界观、时代、地点、势力、社会规则和故事开始前已经成立的背景事实。</p><DeferredTextarea className="game-prompt-textarea" value={game.worldSettingPrompt} onCommit={(worldSettingPrompt) => patchGame({ worldSettingPrompt })} placeholder="例如：世界结构、主要地区、阵营关系、特殊规则与故事前提……" /></div>
            <div className="form-section"><h3><span className="nsfw-mark">❤</span> 偏好的 NSFW 场景设定</h3><p className="form-section-description">单独设置成人情节的主题、氛围、节奏和内容偏好。留空时，这一部分不会加入系统提示词。</p><DeferredTextarea className="game-prompt-textarea" value={game.nsfwScenePrompt} onCommit={(nsfwScenePrompt) => patchGame({ nsfwScenePrompt })} placeholder="可留空；书写希望在相关情节中生效的偏好" /></div>
            <div className="form-section narrative-style-section"><h3>叙事风格设定</h3><p className="form-section-description">全局设定始终生效；叙事模式设定仅在对应模式下与全局设定共同发送。</p><div className="narrative-style-tabs" role="tablist" aria-label="叙事风格设定范围"><button type="button" role="tab" aria-selected={selectedNarrativeStyleId === 'global'} className={selectedNarrativeStyleId === 'global' ? 'active' : ''} onClick={() => setSelectedNarrativeStyleId('global')}>全局设定</button>{availableModes.map((mode) => <button type="button" role="tab" aria-selected={selectedNarrativeStyleId === mode.id} className={selectedNarrativeStyleId === mode.id ? 'active' : ''} key={mode.id} onClick={() => setSelectedNarrativeStyleId(mode.id)}><span className="narrative-mode-dot" style={{ backgroundColor: mode.color }} />{mode.name}</button>)}</div><DeferredTextarea key={selectedNarrativeStyleId} className="game-prompt-textarea" value={selectedNarrativeStyleId === 'global' ? game.storyStylePrompt : game.modeStoryStylePrompts?.[selectedNarrativeStyleId] ?? ''} onCommit={(value) => selectedNarrativeStyleId === 'global' ? patchGame({ storyStylePrompt: value }) : patchGame({ modeStoryStylePrompts: { ...game.modeStoryStylePrompts, [selectedNarrativeStyleId]: value } })} placeholder={selectedNarrativeStyleId === 'global' ? '设置全局剧情组织方式、文风、叙事视角、氛围、节奏、篇幅和描写偏好' : '填写当前叙事模式专用的叙事风格设定，可留空'} /></div>
          </section>}

          {tab === 'characters' && <section className="character-settings-layout">
            <aside className="character-list">
              <button className="add-character-button" onClick={openAddCharacter}><Plus size={15} />添加 NPC</button>
              {game.characters.map((character) => <button className={character.id === selectedCharacter?.id ? 'active' : ''} key={character.id} onClick={() => setSelectedCharacterId(character.id)}><span className="character-color-dot" style={{ background: character.color }} /><span><strong>{character.name || '未命名'}</strong><small>{character.role === 'player' ? '主角' : 'NPC'}</small></span></button>)}
            </aside>
            {selectedCharacter && <div className="character-editor">
              <div className="character-common-settings">
                <div className="character-editor-head"><div><span className="eyebrow">通用设定</span><h3>{selectedCharacter.name || '未命名角色'}</h3></div><div className="character-editor-actions"><button className="secondary-icon" disabled={selectedCharacter.role === 'player'} onClick={() => { setExportCharacter(selectedCharacter); setRoleNotice('') }} title={selectedCharacter.role === 'player' ? '主角不能导出为 NPC' : '导出 NPC'}><Download size={17} /></button><button className="danger-icon" disabled={selectedCharacter.role === 'player'} onClick={() => removeCharacter(selectedCharacter)} title={selectedCharacter.role === 'player' ? '主角不能删除' : '删除角色'}><Trash2 size={17} /></button></div></div>
                <div className="form-row"><label>姓名<DeferredInput key={`${selectedCharacter.id}:name`} value={selectedCharacter.name} onCommit={(name) => patchCharacter(selectedCharacter.id, { name })} /></label><label>身份<select value={selectedCharacter.role} onChange={(event) => patchCharacter(selectedCharacter.id, { role: event.target.value as CharacterProfile['role'] })}><option value="player">用户扮演的主角</option><option value="npc">NPC</option></select></label></div>
                <div className="form-row"><label>性别<DeferredInput key={`${selectedCharacter.id}:gender`} value={selectedCharacter.gender} onCommit={(gender) => patchCharacter(selectedCharacter.id, { gender })} placeholder="可自定义" /></label><label>主体颜色<CharacterColorControl key={selectedCharacter.id} value={selectedCharacter.color} onChange={(color) => patchCharacter(selectedCharacter.id, { color })} /></label></div>
                <label>人物设定<span className="field-description">描述人物的基本设定、外观特征、性格、背景、人际关系等</span><DeferredTextarea key={`${selectedCharacter.id}:description`} className="character-description" value={selectedCharacter.description} onCommit={(description) => patchCharacter(selectedCharacter.id, { description })} placeholder="填写人物的基础资料与角色设定" /></label>
                {Boolean(game.statusRulesPrompt?.trim()) && <label>状态栏<span className="field-description">角色的当前状态数据缓存；具体字段与更新方式由内置游戏规则决定</span><DeferredTextarea key={`${selectedCharacter.id}:status`} className="character-status-editor" value={selectedCharacter.statusBar ?? ''} onCommit={(statusBar) => patchCharacter(selectedCharacter.id, { statusBar })} placeholder="留空，后续可由状态栏规则设置和更新" /></label>}
              </div>
              <section className="character-mode-settings">
                <div className="character-mode-heading"><div><span className="eyebrow">模式个性化设定</span><h3>{selectedCharacterMode?.name ?? '叙事模式'}</h3></div></div>
                <div className="character-mode-tabs" role="tablist" aria-label="人物叙事模式">{availableModes.map((mode) => <button type="button" role="tab" aria-selected={mode.id === selectedModeId} className={mode.id === selectedModeId ? 'active' : ''} key={mode.id} onClick={() => setSelectedCharacterModeId(mode.id)}><span className="narrative-mode-dot" style={{ backgroundColor: mode.color }} />{mode.name}</button>)}</div>
                <label>特殊设定<span className="field-description">仅在“{selectedCharacterMode?.name}”叙事模式下生效</span><DeferredTextarea key={`${selectedCharacter.id}:${selectedModeId}:description`} className="character-description" value={selectedCharacter.modeDescriptions?.[selectedModeId] ?? ''} onCommit={(value) => patchCharacter(selectedCharacter.id, { modeDescriptions: { ...selectedCharacter.modeDescriptions, [selectedModeId]: value } })} placeholder="可留空；填写当前叙事模式专用的人物设定" /></label>
                <div className="portrait-section-head"><div><h3>立绘与表情</h3><span>{selectedCharacter.portraits.length} 张</span></div><div className="portrait-toolbar"><label className="secondary-button"><ImagePlus size={15} />添加立绘<input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) setCropTarget({ characterId: selectedCharacter.id, file }); event.target.value = '' }} /></label><button type="button" className="secondary-button" onClick={() => setPortraitManagerOpen(true)}><Trash2 size={15} />删除立绘</button></div></div>
                {portraitError && <div className="inline-error">{portraitError}</div>}
                {!sortedPortraits.length ? <div className="portrait-settings-empty">尚未添加立绘</div> : <div className="portrait-settings-list">{sortedPortraits.map((portrait) => {
                  const tags = portrait.tags?.length ? portrait.tags : [portrait.expression].filter(Boolean)
                  const groups: PortraitGroup[] = portrait.groups ?? [defaultModeId]
                  const active = groups.includes(selectedModeId)
                  const isDefault = selectedCharacter.defaultPortraitIds?.[selectedModeId] === portrait.id || (selectedModeId === defaultModeId && !selectedCharacter.defaultPortraitIds?.[selectedModeId] && selectedCharacter.defaultPortraitId === portrait.id)
                  const tagDraftKey = `${selectedCharacter.id}:${portrait.id}`
                  const tagDraft = portraitTagDrafts[tagDraftKey] ?? formatPortraitTags(tags)
                  return <div className={`portrait-settings-row ${isDefault ? 'default' : active ? 'active' : 'inactive'}`} key={portrait.id}>
                    <img src={portraitSource(portrait.uri)} alt="" />
                    <div className="portrait-metadata"><label>表情标签<input value={tagDraft} onChange={(event) => editPortraitTags(selectedCharacter, portrait, event.target.value)} onBlur={(event) => finishPortraitTagEdit(selectedCharacter, portrait, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} placeholder="严肃，担忧" /></label><div className="portrait-mode-actions"><label className="portrait-active-toggle"><input type="checkbox" checked={active} onChange={(event) => togglePortraitGroup(selectedCharacter, portrait, selectedModeId, event.target.checked)} />在此模式激活</label><button type="button" className={`default-portrait-button ${isDefault ? 'active' : ''}`} onClick={() => setGroupDefault(selectedCharacter, portrait, selectedModeId)}><Star size={14} />{isDefault ? '默认立绘' : '设为默认'}</button></div></div>
                  </div>
                })}</div>}
              </section>
            </div>}
          </section>}
        </div>
        <div className="modal-footer"><span>设置仅对本RPG生效</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setPromptPreviewOpen(true)}><Eye size={16} />预览系统提示词</button><button className="primary-button" onClick={closeDialog}>完成</button></div></div>
      </section>
      {promptPreviewOpen && <div className="prompt-preview-layer" role="dialog" aria-modal="true" aria-label="预览系统提示词"><button className="backdrop" onClick={() => setPromptPreviewOpen(false)} aria-label="关闭系统提示词预览" /><section className="modal prompt-preview-modal"><div className="modal-head"><div><span className="eyebrow">COMPILED SYSTEM PROMPT</span><h2>预览系统提示词</h2><p className="prompt-preview-note">提示词还包含部分动态生成内容，需查看完整上下文，请使用RPG页面的debug功能。</p></div><button className="icon-button" onClick={() => setPromptPreviewOpen(false)} title="关闭"><X size={20} /></button></div><pre>{fullSystemPrompt}</pre></section></div>}
      {cropTarget && <PortraitCropDialog file={cropTarget.file} onCancel={() => setCropTarget(null)} onConfirm={(file) => addPortrait(cropTarget.characterId, file)} />}
      {portraitManagerOpen && selectedCharacter && <div className="modal-layer role-dialog-layer" role="dialog" aria-modal="true" aria-label="删除立绘"><button className="backdrop" onClick={() => setPortraitManagerOpen(false)} aria-label="关闭立绘管理" /><section className="modal role-dialog portrait-manager-dialog"><div className="modal-head"><div><span className="eyebrow">PORTRAIT MANAGER</span><h2>删除立绘</h2></div><button className="icon-button" onClick={() => setPortraitManagerOpen(false)} title="关闭"><X size={19} /></button></div><div className="role-dialog-content portrait-manager-list">{selectedCharacter.portraits.length ? selectedCharacter.portraits.map((portrait) => { const appliedModes = availableModes.filter((mode) => (portrait.groups ?? [defaultModeId]).includes(mode.id)); return <div className="portrait-manager-row" key={portrait.id}><img src={portraitSource(portrait.uri)} alt="" /><div><strong>{portrait.tags?.join('、') || portrait.expression || '未命名立绘'}</strong><span>{appliedModes.length ? `应用于：${appliedModes.map((mode) => mode.name).join('、')}` : '未应用于任何叙事模式'}</span></div><button type="button" className="danger-icon" onClick={() => void removePortrait(selectedCharacter, portrait.id)} title="删除立绘"><Trash2 size={16} /></button></div> }) : <div className="portrait-settings-empty">没有可删除的立绘</div>}</div><div className="modal-footer"><span>删除操作无法恢复</span><button className="primary-button" onClick={() => setPortraitManagerOpen(false)}>完成</button></div></section></div>}
      {addCharacterOpen && <div className="modal-layer role-dialog-layer" role="dialog" aria-modal="true" aria-label="添加NPC"><button className="backdrop" onClick={() => !roleWorking && setAddCharacterOpen(false)} aria-label="取消添加NPC" /><section className="modal role-dialog"><div className="modal-head"><div><span className="eyebrow">ADD CHARACTER</span><h2>添加 NPC</h2></div><button className="icon-button" onClick={() => setAddCharacterOpen(false)} disabled={roleWorking} title="关闭"><X size={19} /></button></div><div className="role-dialog-content"><div className="role-mode-tabs"><button className={addCharacterMode === 'new' ? 'active' : ''} onClick={() => setAddCharacterMode('new')}>新建</button><button className={addCharacterMode === 'clone' ? 'active' : ''} onClick={() => setAddCharacterMode('clone')}>克隆</button><button className={addCharacterMode === 'import' ? 'active' : ''} onClick={() => setAddCharacterMode('import')}>导入</button></div>{addCharacterMode === 'new' && <p className="role-mode-description">建立一个空白 NPC，之后手工填写人物设定并添加立绘。</p>}{addCharacterMode === 'clone' && <><label>来源 RPG<select value={cloneGameId} onChange={(event) => { const nextGame = games.find((item) => item.id === event.target.value); setCloneGameId(event.target.value); setCloneCharacterId(nextGame?.characters.find((character) => character.role === 'npc')?.id ?? '') }}>{games.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>来源 NPC<select value={cloneCharacterId} onChange={(event) => setCloneCharacterId(event.target.value)}><option value="">请选择 NPC</option>{cloneCandidates.map((character) => <option value={character.id} key={character.id}>{character.name || '未命名NPC'}</option>)}</select></label><p className="role-mode-description">完整复制人物设定、状态栏、颜色、NSFW 信息和全部立绘，并生成独立的新 NPC。</p></>}{addCharacterMode === 'import' && <><div className="system-file-picker"><span>角色包</span><label className="secondary-button"><FileUp size={16} />{pickedRoleFile?.name ?? '选择文件'}<input type="file" accept=".role.rpgbox,.rpgbox,application/zip,application/octet-stream" hidden onChange={(event) => { setPickedRoleFile(event.target.files?.[0] ?? null); setRoleImportMode(null); setRoleNotice(''); event.target.value = '' }} /></label>{pickedRoleFile && <button type="button" className="text-button" onClick={() => { setPickedRoleFile(null); setRoleImportMode(null); setRoleNotice('') }}>取消选择</button>}</div><p className="directory-note">可从 <strong>{ROLE_PACKAGE_DIRECTORY_LABEL}</strong>、下载目录或其他位置选择 `.role.rpgbox` 文件。</p>{roleImportMode === null && roleNotice === '角色已存在，请选择处理方式：' && <div className="role-import-options"><p>角色已存在，请选择处理方式：</p><label><input type="radio" name="role-import-mode" checked={false} onChange={() => setRoleImportMode('new')} />新建角色</label><label><input type="radio" name="role-import-mode" checked={false} onChange={() => setRoleImportMode('replace')} />替换原有角色</label><label><input type="radio" name="role-import-mode" checked={false} onChange={() => setRoleImportMode('portraits')} />更新立绘</label></div>}</>}{roleNotice && roleImportMode !== null && <div className="role-import-selection">{roleNotice}</div>}</div><div className="modal-footer"><span>导入或克隆后可继续编辑</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setAddCharacterOpen(false)} disabled={roleWorking}>取消</button><button className="primary-button" onClick={() => void confirmAddCharacter()} disabled={roleWorking}>{roleWorking ? '处理中' : '确认添加'}</button></div></div></section></div>}
      {exportCharacter && <div className="modal-layer role-dialog-layer" role="dialog" aria-modal="true" aria-label="导出NPC"><button className="backdrop" onClick={() => !roleWorking && setExportCharacter(null)} aria-label="取消导出NPC" /><section className="modal role-dialog"><div className="modal-head"><div><span className="eyebrow">EXPORT CHARACTER</span><h2>导出“{exportCharacter.name || '未命名NPC'}”</h2></div><button className="icon-button" onClick={() => setExportCharacter(null)} disabled={roleWorking} title="关闭"><X size={19} /></button></div><div className="role-dialog-content"><p className="role-mode-description">人物通用设定、各模式特殊设定、状态栏、颜色及全部立绘都会完整导出。</p><p className="directory-note">文件将保存到 <strong>{ROLE_PACKAGE_DIRECTORY_LABEL}</strong>，扩展名为 `.role.rpgbox`。</p>{roleNotice && <div className="inline-error">{roleNotice}</div>}</div><div className="modal-footer"><span>角色包不包含 RPG 剧情或 AI 配置</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setExportCharacter(null)} disabled={roleWorking}>取消</button><button className="primary-button" onClick={() => void confirmExportCharacter()} disabled={roleWorking}>{roleWorking ? '导出中' : '确认导出'}</button></div></div></section></div>}
    </div>
  )
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function portraitTagsKey(tags: string[]): string {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort().join('\u0001')
}

function ParameterSlider({ label, value, valueLabel, min, max, step, precision = 2, disabled = false, onChange }: { label: string; value: number; valueLabel?: string; min: number; max: number; step: number; precision?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className={`parameter-slider ${disabled ? 'disabled' : ''}`}><span><span>{label}</span><strong>{valueLabel ?? value.toFixed(precision)}</strong></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function CharacterColorControl({ value, compact = false, onChange }: { value: string; compact?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const hsv = hexToHsv(value)
  const hueColor = hsvToHex({ h: hsv.h, s: 100, v: 100 })
  const brightColor = hsvToHex({ h: hsv.h, s: hsv.s, v: 100 })

  function patchHsv(patch: Partial<HsvColor>) {
    onChange(hsvToHex({ ...hsv, ...patch }))
  }

  return <span className={`character-color-control ${compact ? 'compact' : ''}`}>
    <span className="color-input-row">
      <button type="button" className="color-swatch-button" style={{ backgroundColor: normalizeHexColor(value) }} onClick={() => setOpen((current) => !current)} aria-label="自定义主体颜色" aria-expanded={open} />
      {!compact && <DeferredInput value={value} onCommit={(nextValue) => onChange(normalizeHexColor(nextValue))} aria-label="主体颜色十六进制值" />}
    </span>
    {open && <span className="character-hsv-editor">
      <ColorChannel label="色相" value={hsv.h} max={359} background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" onChange={(h) => patchHsv({ h })} />
      <ColorChannel label="饱和度" value={hsv.s} max={100} background={`linear-gradient(90deg, #fff, ${hueColor})`} onChange={(s) => patchHsv({ s })} />
      <ColorChannel label="明度" value={hsv.v} max={100} background={`linear-gradient(90deg, #000, ${brightColor})`} onChange={(v) => patchHsv({ v })} />
    </span>}
  </span>
}

function ColorChannel({ label, value, max, background, onChange }: { label: string; value: number; max: number; background: string; onChange: (value: number) => void }) {
  return <span className="color-channel"><span><span>{label}</span><strong>{value}</strong></span><input type="range" min="0" max={max} step="1" value={value} style={{ background }} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} /></span>
}
