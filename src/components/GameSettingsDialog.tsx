import { BookOpen, Download, Eye, FileUp, ImagePlus, Plus, SlidersHorizontal, Star, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { copyPortraitFile, deletePortraitFile, portraitSource, savePortraitFile } from '../lib/portraits'
import { createNpcId } from '../lib/migrations'
import { clampRecentChapterLimit, normalizeMemoryState } from '../lib/memory'
import type { CharacterPortrait, CharacterProfile, GameSession, PortraitGroup, ProviderProfile } from '../types'
import { formatPortraitTags, parsePortraitTags } from '../lib/portraitTags'
import { hexToHsv, hsvToHex, normalizeHexColor, type HsvColor } from '../lib/color'
import PortraitCropDialog from './PortraitCropDialog'
import { exportRolePackage, importRolePackage, ROLE_PACKAGE_DIRECTORY_LABEL } from '../lib/rolePackage'

interface Props {
  game: GameSession
  games: GameSession[]
  providers: ProviderProfile[]
  fullSystemPrompt: string
  onClose: () => void
  onChange: (game: GameSession) => void
}

type Tab = 'ai' | 'game' | 'characters'

type AddCharacterMode = 'new' | 'clone' | 'import'

export default function GameSettingsDialog({ game, games, providers, fullSystemPrompt, onClose, onChange }: Props) {
  const [tab, setTab] = useState<Tab>('ai')
  const [selectedCharacterId, setSelectedCharacterId] = useState(game.characters[0]?.id ?? '')
  const [portraitError, setPortraitError] = useState('')
  const [cropTarget, setCropTarget] = useState<{ characterId: string; file: File } | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [contextTurnsDraft, setContextTurnsDraft] = useState(String(game.aiSettings.contextTurns ?? 15))
  const [memoryLimitDraft, setMemoryLimitDraft] = useState(String(game.memory.recentChapterLimit ?? 5))
  const [portraitTagDrafts, setPortraitTagDrafts] = useState<Record<string, string>>({})
  const [addCharacterOpen, setAddCharacterOpen] = useState(false)
  const [addCharacterMode, setAddCharacterMode] = useState<AddCharacterMode>('new')
  const [cloneGameId, setCloneGameId] = useState(game.id)
  const [cloneCharacterId, setCloneCharacterId] = useState('')
  const [pickedRoleFile, setPickedRoleFile] = useState<File | null>(null)
  const [exportCharacter, setExportCharacter] = useState<CharacterProfile | null>(null)
  const [exportNsfw, setExportNsfw] = useState(false)
  const [roleWorking, setRoleWorking] = useState(false)
  const [roleNotice, setRoleNotice] = useState('')
  const cloneGame = games.find((item) => item.id === cloneGameId) ?? game
  const cloneCandidates = cloneGame.characters.filter((character) => character.role === 'npc')
  const selectedProvider = providers.find((provider) => provider.id === game.aiSettings.providerId) ?? providers[0]
  const selectedCharacter = game.characters.find((character) => character.id === selectedCharacterId) ?? game.characters[0]
  const visiblePortraits = selectedCharacter?.portraits.filter((portrait) => game.nsfwEnabled
    || (portrait.groups?.length ? portrait.groups : ['normal']).includes('normal')) ?? []
  const models = useMemo(() => Array.from(new Set([
    ...(selectedProvider?.models?.length ? selectedProvider.models : selectedProvider?.model ? [selectedProvider.model] : []),
    game.aiSettings.model,
  ].filter(Boolean))), [game.aiSettings.model, selectedProvider])

  useEffect(() => {
    if (!selectedCharacter && game.characters[0]) setSelectedCharacterId(game.characters[0].id)
  }, [game.characters, selectedCharacter])

  useEffect(() => {
    setContextTurnsDraft(String(game.aiSettings.contextTurns ?? 15))
    setMemoryLimitDraft(String(game.memory.recentChapterLimit ?? 5))
    setPortraitTagDrafts({})
  }, [game.id])

  function patchGame(patch: Partial<GameSession>) {
    onChange({ ...game, ...patch, updatedAt: Date.now() })
  }

  function setNsfwEnabled(nsfwEnabled: boolean) {
    patchGame({
      nsfwEnabled,
      gameState: nsfwEnabled ? game.gameState : { ...game.gameState, contentMode: 'normal' },
    })
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
    setContextTurnsDraft(String(contextTurns))
    setMemoryLimitDraft(String(recentChapterLimit))
    if (contextTurns !== game.aiSettings.contextTurns || recentChapterLimit !== game.memory.recentChapterLimit) {
      onChange({
        ...game,
        aiSettings: { ...game.aiSettings, contextTurns },
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
      nsfwDescription: '',
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
        if (!source) throw new Error('请选择要克隆的 NPC')
        const id = createNpcId()
        const clone = structuredClone(source)
        clone.id = id
        clone.role = 'npc'
        clone.portraits = await Promise.all(clone.portraits.map(async (portrait) => ({
          ...portrait,
          uri: await copyPortraitFile(portrait.uri, game.id, id),
        })))
        patchGame({ characters: [...game.characters, clone] })
        setSelectedCharacterId(id)
      } else {
        if (!pickedRoleFile) throw new Error('请选择要导入的角色包')
        const id = createNpcId()
        const imported = await importRolePackage(pickedRoleFile, game.id, id)
        patchGame({ characters: [...game.characters, imported] })
        setSelectedCharacterId(id)
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
      const path = await exportRolePackage(exportCharacter, exportNsfw)
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
        groups: ['normal'],
        uri,
      }], defaultPortraitId: character.defaultPortraitId ?? portraitId, defaultPortraitIds: {
        ...character.defaultPortraitIds,
        normal: character.defaultPortraitIds?.normal ?? character.defaultPortraitId ?? portraitId,
      } })
      setCropTarget(null)
    } catch (error) {
      setPortraitError(error instanceof Error ? error.message : '立绘保存失败')
    }
  }

  async function removePortrait(character: CharacterProfile, portraitId: string) {
    const portrait = character.portraits.find((item) => item.id === portraitId)
    if (portrait) await deletePortraitFile(portrait.uri)
    const portraits = character.portraits.filter((item) => item.id !== portraitId)
    patchCharacter(character.id, {
      portraits,
      defaultPortraitId: character.defaultPortraitId === portraitId ? portraits[0]?.id : character.defaultPortraitId,
      defaultPortraitIds: Object.fromEntries(Object.entries(character.defaultPortraitIds ?? {}).filter(([, id]) => id !== portraitId)),
    })
  }

  function patchPortrait(character: CharacterProfile, portraitId: string, patch: Partial<CharacterPortrait>) {
    patchCharacter(character.id, { portraits: character.portraits.map((portrait) => portrait.id === portraitId ? { ...portrait, ...patch } : portrait) })
  }

  function editPortraitTags(character: CharacterProfile, portrait: CharacterPortrait, value: string) {
    const draftKey = `${character.id}:${portrait.id}`
    const tags = parsePortraitTags(value)
    setPortraitTagDrafts((current) => ({ ...current, [draftKey]: value }))
    patchPortrait(character, portrait.id, { tags, expression: tags[0] ?? '' })
  }

  function finishPortraitTagEdit(character: CharacterProfile, portrait: CharacterPortrait, value: string) {
    const draftKey = `${character.id}:${portrait.id}`
    const tags = parsePortraitTags(value)
    setPortraitTagDrafts((current) => ({ ...current, [draftKey]: formatPortraitTags(tags) }))
    patchPortrait(character, portrait.id, { tags, expression: tags[0] ?? '' })
  }

  function togglePortraitGroup(character: CharacterProfile, portrait: CharacterPortrait, group: PortraitGroup, checked: boolean) {
    const groups: PortraitGroup[] = portrait.groups?.length ? portrait.groups : ['normal']
    const nextGroups = checked ? Array.from(new Set([...groups, group])) : groups.filter((item) => item !== group)
    const defaults = { ...character.defaultPortraitIds }
    if (!checked && defaults[group] === portrait.id) delete defaults[group]
    patchCharacter(character.id, {
      portraits: character.portraits.map((item) => item.id === portrait.id ? { ...item, groups: nextGroups } : item),
      defaultPortraitIds: defaults,
      defaultPortraitId: group === 'normal' && !checked && character.defaultPortraitId === portrait.id ? undefined : character.defaultPortraitId,
    })
  }

  function setGroupDefault(character: CharacterProfile, portrait: CharacterPortrait, group: PortraitGroup) {
    patchCharacter(character.id, {
      defaultPortraitIds: { ...character.defaultPortraitIds, [group]: portrait.id },
      defaultPortraitId: group === 'normal' ? portrait.id : character.defaultPortraitId,
    })
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
          <button className={tab === 'game' ? 'active' : ''} onClick={() => setTab('game')}><BookOpen size={16} />RPG设置</button>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}><Users size={16} />登场人物</button>
        </nav>

        <div className="game-settings-content">
          {tab === 'ai' && <section className="game-tab-panel ai-settings-panel">
            <div className="form-section"><h3>接口与模型</h3>
              <label>API 配置<select value={selectedProvider?.id ?? ''} onChange={(event) => { const provider = providers.find((item) => item.id === event.target.value); if (provider) patchGame({ aiSettings: { ...game.aiSettings, providerId: provider.id, model: provider.models[0] ?? provider.model } }) }}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label>
              <label>模型<select value={game.aiSettings.model} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, model: event.target.value } })}>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
            </div>
            <div className="form-section"><h3>模型参数</h3>
              <ParameterSlider label="温度" min={0} max={2} step={0.05} value={game.aiSettings.temperature} onChange={(temperature) => patchGame({ aiSettings: { ...game.aiSettings, temperature } })} />
              <ParameterSlider label="Top P" min={0} max={1} step={0.05} value={game.aiSettings.topP} onChange={(topP) => patchGame({ aiSettings: { ...game.aiSettings, topP } })} />
              <ParameterSlider label="存在惩罚" min={-2} max={2} step={0.05} value={game.aiSettings.presencePenalty} onChange={(presencePenalty) => patchGame({ aiSettings: { ...game.aiSettings, presencePenalty } })} />
              <ParameterSlider label="频率惩罚" min={-2} max={2} step={0.05} value={game.aiSettings.frequencyPenalty} onChange={(frequencyPenalty) => patchGame({ aiSettings: { ...game.aiSettings, frequencyPenalty } })} />
              <label>最大输出 Token<input type="number" min="128" max="131072" step="128" value={game.aiSettings.maxTokens} onChange={(event) => patchGame({ aiSettings: { ...game.aiSettings, maxTokens: Math.max(128, Number(event.target.value)) } })} /></label>
              <label>对话轮数<input type="number" min="1" max="100" step="1" value={contextTurnsDraft} onChange={(event) => setContextTurnsDraft(event.target.value)} onBlur={() => commitNumericSettings()} /></label>
              <label>主记忆章节数<input type="number" min="1" max="20" step="1" value={memoryLimitDraft} onChange={(event) => setMemoryLimitDraft(event.target.value)} onBlur={() => commitNumericSettings()} /></label>
            </div>
          </section>}

          {tab === 'game' && <section className="game-tab-panel">
            <div className="form-section"><h3>内容模式</h3><label className="nsfw-mode-toggle"><input type="checkbox" checked={game.nsfwEnabled} onChange={(event) => setNsfwEnabled(event.target.checked)} /><span><strong>启用 NSFW 模式</strong><small>关闭后隐藏相关设置与专用立绘，并从系统提示词中移除对应规则；已有数据会继续保留。</small></span></label></div>
            <div className="form-section"><h3>剧情规则与文风</h3><p className="form-section-description">设置剧情组织方式、整体文风、叙事视角、氛围、节奏、篇幅和描写偏好。选项生成与主角控制权由系统规则固定。</p><textarea className="game-prompt-textarea" value={game.storyStylePrompt} onChange={(event) => patchGame({ storyStylePrompt: event.target.value })} placeholder="例如：细腻的第三人称叙事；注重场景氛围、人物神态和情绪变化……" /></div>
            <div className="form-section"><h3>章节切换规则</h3><p className="form-section-description">设置章节结束、过渡和新章节开启时需要遵守的额外规则。内容会在新游戏开始或章节切换时附加到本轮用户指令。</p><textarea className="game-prompt-textarea" value={game.chapterTransitionRules ?? ''} onChange={(event) => patchGame({ chapterTransitionRules: event.target.value })} placeholder="例如：章节结束前收束当前矛盾；新章节应延续既有角色关系和状态……" /><ParameterSlider label="章节开始时选项数" min={4} max={10} step={1} precision={0} value={game.newStoryChoiceCount ?? 4} onChange={(newStoryChoiceCount) => patchGame({ newStoryChoiceCount })} /><div className={`linked-setting-panel ${game.recommendedChapterTurnsEnabled ? '' : 'disabled'}`}><label className="nsfw-mode-toggle"><input type="checkbox" checked={game.recommendedChapterTurnsEnabled ?? false} onChange={(event) => patchGame({ recommendedChapterTurnsEnabled: event.target.checked })} /><span><strong>启用单章节推荐对话数</strong><small>章节对话轮数超过此数值，则会优先推动章节结束</small></span></label><ParameterSlider label="单章节推荐对话数" min={10} max={30} step={1} precision={0} value={game.recommendedChapterTurns ?? 20} disabled={!(game.recommendedChapterTurnsEnabled ?? false)} onChange={(recommendedChapterTurns) => patchGame({ recommendedChapterTurns })} /></div></div>
            <div className="form-section"><h3>状态栏规则</h3><p className="form-section-description">定义角色状态栏需要保存的字段、书写格式和更新条件。留空时不会要求AI输出角色状态，也不会自动更新角色状态栏。</p><textarea className="game-prompt-textarea" value={game.statusRulesPrompt ?? ''} onChange={(event) => patchGame({ statusRulesPrompt: event.target.value })} placeholder="例如：记录服装、身体状态、情绪和临时效果；只保留当前仍然有效的信息……" /></div>
            <div className="form-section"><h3>故事背景设定</h3><p className="form-section-description">设置世界观、时代、地点、势力、社会规则和故事开始前已经成立的背景事实。</p><textarea className="game-prompt-textarea" value={game.worldSettingPrompt} onChange={(event) => patchGame({ worldSettingPrompt: event.target.value })} placeholder="例如：世界结构、主要地区、阵营关系、特殊规则与故事前提……" /></div>
            {game.nsfwEnabled && <div className="form-section"><h3><span className="nsfw-mark">❤</span> 偏好的 NSFW 场景</h3><p className="form-section-description">单独设置成人情节的主题、氛围、节奏和内容偏好。留空时，这一部分不会加入系统提示词。</p><textarea className="game-prompt-textarea" value={game.nsfwScenePrompt} onChange={(event) => patchGame({ nsfwScenePrompt: event.target.value })} placeholder="可留空；仅书写希望在 NSFW 情节中生效的偏好" /></div>}
          </section>}

          {tab === 'characters' && <section className="character-settings-layout">
            <aside className="character-list">
              {game.characters.map((character) => <button className={character.id === selectedCharacter?.id ? 'active' : ''} key={character.id} onClick={() => setSelectedCharacterId(character.id)}><span className="character-color-dot" style={{ background: character.color }} /><span><strong>{character.name || '未命名'}</strong><small>{character.role === 'player' ? '主角' : 'NPC'}</small></span></button>)}
              <button className="add-character-button" onClick={openAddCharacter}><Plus size={15} />添加 NPC</button>
            </aside>
            {selectedCharacter && <div className="character-editor">
              <div className="character-editor-head"><div><span className="eyebrow">{selectedCharacter.role === 'player' ? 'PLAYER CHARACTER' : 'NON-PLAYER CHARACTER'}</span><h3>{selectedCharacter.name || '未命名角色'}</h3></div><div className="character-editor-actions"><button className="secondary-icon" disabled={selectedCharacter.role === 'player'} onClick={() => { setExportCharacter(selectedCharacter); setExportNsfw(game.nsfwEnabled); setRoleNotice('') }} title={selectedCharacter.role === 'player' ? '主角不能导出为 NPC' : '导出 NPC'}><Download size={17} /></button><button className="danger-icon" disabled={selectedCharacter.role === 'player'} onClick={() => removeCharacter(selectedCharacter)} title={selectedCharacter.role === 'player' ? '主角不能删除' : '删除角色'}><Trash2 size={17} /></button></div></div>
              <div className="form-row"><label>姓名<input value={selectedCharacter.name} onChange={(event) => patchCharacter(selectedCharacter.id, { name: event.target.value })} /></label><label>身份<select value={selectedCharacter.role} onChange={(event) => patchCharacter(selectedCharacter.id, { role: event.target.value as CharacterProfile['role'] })}><option value="player">用户扮演的主角</option><option value="npc">NPC</option></select></label></div>
              <div className="form-row"><label>性别<input value={selectedCharacter.gender} onChange={(event) => patchCharacter(selectedCharacter.id, { gender: event.target.value })} placeholder="可自定义" /></label><label>主体颜色<CharacterColorControl key={selectedCharacter.id} value={selectedCharacter.color} onChange={(color) => patchCharacter(selectedCharacter.id, { color })} /></label></div>
              <label>人物设定<span className="field-description">描述人物的基本设定、外观特征、性格、背景、人际关系等</span><textarea className="character-description" value={selectedCharacter.description} onChange={(event) => patchCharacter(selectedCharacter.id, { description: event.target.value })} placeholder="填写人物的基础资料与角色设定" /></label>
              {Boolean(game.statusRulesPrompt?.trim()) && <label>状态栏<span className="field-description">角色的当前状态数据缓存；具体字段与更新方式由内置游戏规则决定</span><textarea className="character-status-editor" value={selectedCharacter.statusBar ?? ''} onChange={(event) => patchCharacter(selectedCharacter.id, { statusBar: event.target.value })} placeholder="留空，后续可由状态栏规则设置和更新" /></label>}
              {game.nsfwEnabled && <label><span className="nsfw-mark">❤</span> NSFW设定<span className="field-description">描述人物NSFW相关的设定，如H经验、XP、特殊敏感带、NSFW场景下特殊反应等</span><textarea className="character-description" value={selectedCharacter.nsfwDescription ?? ''} onChange={(event) => patchCharacter(selectedCharacter.id, { nsfwDescription: event.target.value })} placeholder="可留空；仅在NSFW内容中使用" /></label>}
              <div className="portrait-section-head"><div><h3>立绘与表情</h3><span>{visiblePortraits.length} 张</span></div><label className="secondary-button"><ImagePlus size={15} />添加立绘<input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) setCropTarget({ characterId: selectedCharacter.id, file }); event.target.value = '' }} /></label></div>
              {portraitError && <div className="inline-error">{portraitError}</div>}
              <div className="portrait-settings-list">{visiblePortraits.map((portrait) => {
                const tags = portrait.tags?.length ? portrait.tags : [portrait.expression].filter(Boolean)
                const groups: PortraitGroup[] = portrait.groups?.length ? portrait.groups : ['normal']
                const tagDraftKey = `${selectedCharacter.id}:${portrait.id}`
                const tagDraft = portraitTagDrafts[tagDraftKey] ?? formatPortraitTags(tags)
                return <div className="portrait-settings-row" key={portrait.id}>
                  <img src={portraitSource(portrait.uri)} alt="" />
                  <div className="portrait-metadata"><label>表情标签<input value={tagDraft} onChange={(event) => editPortraitTags(selectedCharacter, portrait, event.target.value)} onBlur={(event) => finishPortraitTagEdit(selectedCharacter, portrait, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} placeholder="严肃，担忧" /></label>{game.nsfwEnabled && <div className="portrait-group-options"><label><input type="checkbox" checked={groups.includes('normal')} onChange={(event) => togglePortraitGroup(selectedCharacter, portrait, 'normal', event.target.checked)} />常规</label><label><input type="checkbox" checked={groups.includes('nsfw')} onChange={(event) => togglePortraitGroup(selectedCharacter, portrait, 'nsfw', event.target.checked)} /><span className="nsfw-mark">❤</span> NSFW</label></div>}<div className="portrait-default-actions"><button className={`default-portrait-button ${selectedCharacter.defaultPortraitIds?.normal === portrait.id || (!selectedCharacter.defaultPortraitIds?.normal && selectedCharacter.defaultPortraitId === portrait.id) ? 'active' : ''}`} disabled={!groups.includes('normal')} onClick={() => setGroupDefault(selectedCharacter, portrait, 'normal')}><Star size={14} />{game.nsfwEnabled ? '常规默认' : '设为默认'}</button>{game.nsfwEnabled && <button className={`default-portrait-button ${selectedCharacter.defaultPortraitIds?.nsfw === portrait.id ? 'active' : ''}`} disabled={!groups.includes('nsfw')} onClick={() => setGroupDefault(selectedCharacter, portrait, 'nsfw')}><Star size={14} /><span className="nsfw-mark">❤</span> NSFW默认</button>}</div></div>
                  <button className="danger-icon" onClick={() => void removePortrait(selectedCharacter, portrait.id)} title="删除立绘"><Trash2 size={16} /></button>
                </div>
              })}</div>
            </div>}
          </section>}
        </div>
        <div className="modal-footer"><span>设置仅对本RPG生效</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setPromptPreviewOpen(true)}><Eye size={16} />查看完整提示词</button><button className="primary-button" onClick={closeDialog}>完成</button></div></div>
      </section>
      {promptPreviewOpen && <div className="prompt-preview-layer" role="dialog" aria-modal="true" aria-label="完整提示词"><button className="backdrop" onClick={() => setPromptPreviewOpen(false)} aria-label="关闭完整提示词" /><section className="modal prompt-preview-modal"><div className="modal-head"><div><span className="eyebrow">COMPILED SYSTEM PROMPT</span><h2>完整提示词</h2></div><button className="icon-button" onClick={() => setPromptPreviewOpen(false)} title="关闭"><X size={20} /></button></div><pre>{fullSystemPrompt}</pre></section></div>}
      {cropTarget && <PortraitCropDialog file={cropTarget.file} onCancel={() => setCropTarget(null)} onConfirm={(file) => addPortrait(cropTarget.characterId, file)} />}
      {addCharacterOpen && <div className="modal-layer role-dialog-layer" role="dialog" aria-modal="true" aria-label="添加NPC"><button className="backdrop" onClick={() => !roleWorking && setAddCharacterOpen(false)} aria-label="取消添加NPC" /><section className="modal role-dialog"><div className="modal-head"><div><span className="eyebrow">ADD CHARACTER</span><h2>添加 NPC</h2></div><button className="icon-button" onClick={() => setAddCharacterOpen(false)} disabled={roleWorking} title="关闭"><X size={19} /></button></div><div className="role-dialog-content"><div className="role-mode-tabs"><button className={addCharacterMode === 'new' ? 'active' : ''} onClick={() => setAddCharacterMode('new')}>新建</button><button className={addCharacterMode === 'clone' ? 'active' : ''} onClick={() => setAddCharacterMode('clone')}>克隆</button><button className={addCharacterMode === 'import' ? 'active' : ''} onClick={() => setAddCharacterMode('import')}>导入</button></div>{addCharacterMode === 'new' && <p className="role-mode-description">建立一个空白 NPC，之后手工填写人物设定并添加立绘。</p>}{addCharacterMode === 'clone' && <><label>来源 RPG<select value={cloneGameId} onChange={(event) => { const nextGame = games.find((item) => item.id === event.target.value); setCloneGameId(event.target.value); setCloneCharacterId(nextGame?.characters.find((character) => character.role === 'npc')?.id ?? '') }}>{games.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>来源 NPC<select value={cloneCharacterId} onChange={(event) => setCloneCharacterId(event.target.value)}><option value="">请选择 NPC</option>{cloneCandidates.map((character) => <option value={character.id} key={character.id}>{character.name || '未命名NPC'}</option>)}</select></label><p className="role-mode-description">完整复制人物设定、状态栏、颜色、NSFW 信息和全部立绘，并生成独立的新 NPC。</p></>}{addCharacterMode === 'import' && <><div className="system-file-picker"><span>角色包</span><label className="secondary-button"><FileUp size={16} />{pickedRoleFile?.name ?? '选择文件'}<input type="file" accept=".role.rpgbox,.rpgbox,application/zip,application/octet-stream" hidden onChange={(event) => { setPickedRoleFile(event.target.files?.[0] ?? null); event.target.value = '' }} /></label>{pickedRoleFile && <button type="button" className="text-button" onClick={() => setPickedRoleFile(null)}>取消选择</button>}</div><p className="directory-note">可从 <strong>{ROLE_PACKAGE_DIRECTORY_LABEL}</strong>、下载目录或其他位置选择 `.role.rpgbox` 文件。</p></>}{roleNotice && <div className="inline-error">{roleNotice}</div>}</div><div className="modal-footer"><span>导入或克隆后可继续编辑</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setAddCharacterOpen(false)} disabled={roleWorking}>取消</button><button className="primary-button" onClick={() => void confirmAddCharacter()} disabled={roleWorking}>{roleWorking ? '处理中' : '确认添加'}</button></div></div></section></div>}
      {exportCharacter && <div className="modal-layer role-dialog-layer" role="dialog" aria-modal="true" aria-label="导出NPC"><button className="backdrop" onClick={() => !roleWorking && setExportCharacter(null)} aria-label="取消导出NPC" /><section className="modal role-dialog"><div className="modal-head"><div><span className="eyebrow">EXPORT CHARACTER</span><h2>导出“{exportCharacter.name || '未命名NPC'}”</h2></div><button className="icon-button" onClick={() => setExportCharacter(null)} disabled={roleWorking} title="关闭"><X size={19} /></button></div><div className="role-dialog-content"><p className="role-mode-description">基础设定、状态栏、颜色、常规立绘及表情标签始终会导出。</p><label className="nsfw-mode-toggle"><input type="checkbox" checked={exportNsfw} onChange={(event) => setExportNsfw(event.target.checked)} /><span><strong><span className="nsfw-mark">❤</span> 包含 NSFW 信息</strong><small>导出 NSFW 设定、NSFW 分组与专用立绘；关闭时这些内容不会写入角色包。</small></span></label><p className="directory-note">文件将保存到 <strong>{ROLE_PACKAGE_DIRECTORY_LABEL}</strong>，扩展名为 `.role.rpgbox`。</p>{roleNotice && <div className="inline-error">{roleNotice}</div>}</div><div className="modal-footer"><span>角色包不包含 RPG 剧情或 AI 配置</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setExportCharacter(null)} disabled={roleWorking}>取消</button><button className="primary-button" onClick={() => void confirmExportCharacter()} disabled={roleWorking}>{roleWorking ? '导出中' : '确认导出'}</button></div></div></section></div>}
    </div>
  )
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function ParameterSlider({ label, value, min, max, step, precision = 2, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step: number; precision?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className={`parameter-slider ${disabled ? 'disabled' : ''}`}><span><span>{label}</span><strong>{value.toFixed(precision)}</strong></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function CharacterColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const hsv = hexToHsv(value)
  const hueColor = hsvToHex({ h: hsv.h, s: 100, v: 100 })
  const brightColor = hsvToHex({ h: hsv.h, s: hsv.s, v: 100 })

  function patchHsv(patch: Partial<HsvColor>) {
    onChange(hsvToHex({ ...hsv, ...patch }))
  }

  return <span className="character-color-control">
    <span className="color-input-row">
      <button type="button" className="color-swatch-button" style={{ backgroundColor: normalizeHexColor(value) }} onClick={() => setOpen((current) => !current)} aria-label="自定义主体颜色" aria-expanded={open} />
      <input value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => onChange(normalizeHexColor(value))} aria-label="主体颜色十六进制值" />
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
