import { BookOpen, Check, Download, FileArchive, FileUp, FolderOpen, ImagePlus, Palette, Pipette, Plus, Star, Trash2, UserRound, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { hexToHsv, hsvToHex, normalizeHexColor, type HsvColor } from '../lib/color'
import { createNarrativeMode, DEFAULT_NARRATIVE_MODES, normalizeNarrativeModes, uniqueNarrativeModeName } from '../lib/narrativeModes'
import type { NarrativeMode, PortraitGroup } from '../types'
import {
  applyMissingDefaults,
  bindRoleToNarrativeModes,
  buildRolePackage,
  buildRpgPackage,
  createId,
  downloadPackage,
  groupsForExpression,
  importBatchPortraits,
  removeDraftNarrativeMode,
  readRpgPackage,
  readRolePackage,
  safeFileName,
  type CharacterDraft,
  type PortraitDraft,
  type RpgDraftSettings,
} from './package'

type Workspace = 'rpg' | 'role'
type RpgSection = 'rules' | 'preferences' | 'characters'

const DEFAULT_CHARACTER: CharacterDraft = {
  id: createId('npc'),
  role: 'npc',
  name: '',
  gender: '',
  description: '',
  modeDescriptions: {},
  statusBar: '',
  color: '#d3ab61',
  portraits: [],
  defaultPortraitIds: {},
}

const DEFAULT_PLAYER: CharacterDraft = {
  ...DEFAULT_CHARACTER,
  id: 'player',
  role: 'player',
  name: '主角',
  gender: '',
  description: '由用户扮演。AI不得替主角决定关键行动、想法或台词。',
  color: '#65b7a5',
}

const DEFAULT_RPG: RpgDraftSettings = {
  title: '',
  narrativeModes: DEFAULT_NARRATIVE_MODES.map((mode) => ({ ...mode })),
  newStoryChoiceCount: 4,
  storyStylePrompt: '',
  modeStoryStylePrompts: {},
  chapterTransitionRules: '',
  narrativeModeRulesPrompt: '',
  recommendedChapterTurnsEnabled: false,
  recommendedChapterTurns: 20,
  statusRulesPrompt: '',
  clearStatusBarAfterChapter: true,
  nsfwScenePrompt: '',
  worldSettingPrompt: '',
  openingMessage: '',
  location: '未知之地',
  time: '序章',
  chapterTitle: '',
}

export default function BuilderApp() {
  const [workspace, setWorkspace] = useState<Workspace>('rpg')
  const [rpgSection, setRpgSection] = useState<RpgSection>('rules')
  const [styleModeId, setStyleModeId] = useState('global')
  const [rpg, setRpg] = useState(DEFAULT_RPG)
  const [player, setPlayer] = useState(DEFAULT_PLAYER)
  const [participants, setParticipants] = useState<CharacterDraft[]>([])
  const [role, setRole] = useState<CharacterDraft>({ ...DEFAULT_CHARACTER, id: createId('npc') })
  const [selectedParticipantId, setSelectedParticipantId] = useState('player')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [working, setWorking] = useState(false)
  const [batchPromptOpen, setBatchPromptOpen] = useState(false)
  const directoryInputRef = useRef<HTMLInputElement>(null)

  const selectedParticipant = selectedParticipantId === 'player'
    ? player
    : participants.find((character) => character.id === selectedParticipantId)

  function flash(text: string, tone: 'success' | 'error' = 'success') {
    setNotice({ text, tone })
  }

  async function importParticipants(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setWorking(true)
    try {
      const imported = (await Promise.all(files.map(readRolePackage))).map((character) => bindRoleToNarrativeModes(character, rpg.narrativeModes))
      setParticipants((current) => [...current, ...imported])
      setSelectedParticipantId(imported.at(-1)?.id ?? 'player')
      flash(`已加入 ${imported.length} 个人物包`)
    } catch (error) {
      flash(toMessage(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  async function exportRpg() {
    setWorking(true)
    try {
      const blob = await buildRpgPackage(rpg, player, participants)
      downloadPackage(blob, `${safeFileName(rpg.title)}.rpgbox`)
      flash('RPG 剧本包已生成')
    } catch (error) {
      flash(toMessage(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  async function exportRole() {
    setWorking(true)
    try {
      const blob = await buildRolePackage(role)
      downloadPackage(blob, `${safeFileName(role.name)}.role.rpgbox`)
      flash('人物包已生成')
    } catch (error) {
      flash(toMessage(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  async function importEditablePackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setWorking(true)
    try {
      if (workspace === 'role') {
        const imported = await readRolePackage(file)
        setRole(imported)
        flash(`已导入人物包：${imported.name || file.name}`)
      } else {
        const imported = await readRpgPackage(file)
        const importedPlayer = imported.characters.find((character) => character.role === 'player')
        const importedParticipants = imported.characters.filter((character) => character !== importedPlayer).map((character) => ({ ...character, role: 'npc' as const }))
        const normalizedPlayer = importedPlayer ? { ...importedPlayer, id: 'player', role: 'player' as const } : { ...DEFAULT_PLAYER }
        const importedSettings = Object.fromEntries(Object.entries(imported.settings).filter(([, value]) => value !== undefined)) as Partial<RpgDraftSettings>
        setRpg({ ...DEFAULT_RPG, ...importedSettings })
        setPlayer(normalizedPlayer)
        setParticipants(importedParticipants)
        setSelectedParticipantId('player')
        setRpgSection('rules')
        setStyleModeId('global')
        flash(`已导入 RPG 剧本包：${imported.settings.title || file.name}`)
      }
    } catch (error) {
      flash(toMessage(error), 'error')
    } finally {
      setWorking(false)
    }
  }

  function importDirectory(event: ChangeEvent<HTMLInputElement>) {
    const result = importBatchPortraits(Array.from(event.target.files ?? []), role.name)
    event.target.value = ''
    setRole((current) => applyMissingDefaults({ ...current, portraits: [...current.portraits, ...result.portraits] }))
    flash(`批量导入完成：成功 ${result.imported} 张，格式失败 ${result.failed} 张`, result.imported ? 'success' : 'error')
  }

  function addMode() {
    setRpg((current) => ({ ...current, narrativeModes: [...normalizeNarrativeModes(current.narrativeModes), createNarrativeMode(current.narrativeModes)] }))
  }

  function patchMode(modeId: string, patchValue: Partial<NarrativeMode>) {
    setRpg((current) => ({ ...current, narrativeModes: normalizeNarrativeModes(current.narrativeModes).map((mode) => mode.id === modeId ? { ...mode, ...patchValue } : mode) }))
  }

  function finishModeName(mode: NarrativeMode, value: string) {
    patchMode(mode.id, { name: uniqueNarrativeModeName(rpg.narrativeModes, mode.id, value) })
  }

  function deleteMode(modeId: string) {
    const mode = rpg.narrativeModes.find((item) => item.id === modeId)
    if (!mode || rpg.narrativeModes.length <= 1 || !window.confirm(`删除叙事模式“${mode.name}”？该模式专属内容将迁移到相邻模式。`)) return
    const result = removeDraftNarrativeMode(rpg, [player, ...participants], modeId)
    setRpg(result.settings)
    setPlayer({ ...result.characters[0], role: 'player' })
    setParticipants(result.characters.slice(1).map((character) => ({ ...character, role: 'npc' })))
  }

  return (
    <main className="builder-shell">
      <header className="builder-header">
        <div className="builder-brand"><FileArchive size={22} /><div><strong>RPGBox 制作器</strong><span>PACKAGE STUDIO</span></div></div>
        <div className="workspace-switch" role="tablist" aria-label="包类型">
          <button className={workspace === 'rpg' ? 'active' : ''} onClick={() => setWorkspace('rpg')}><BookOpen size={16} />RPG 剧本包</button>
          <button className={workspace === 'role' ? 'active' : ''} onClick={() => setWorkspace('role')}><UserRound size={16} />人物包</button>
        </div>
        <div className="header-actions"><label className={`header-import-button ${working ? 'disabled' : ''}`}><FileUp size={17} />导入并编辑<input hidden type="file" disabled={working} accept={workspace === 'rpg' ? '.rpgbox' : '.role.rpgbox'} onChange={(event) => void importEditablePackage(event)} /></label><button className="export-button" disabled={working} onClick={() => void (workspace === 'rpg' ? exportRpg() : exportRole())}><Download size={17} />{working ? '处理中…' : workspace === 'rpg' ? '生成 .rpgbox' : '生成 .role.rpgbox'}</button></div>
      </header>

      {workspace === 'rpg' ? <div className="builder-workspace">
        <aside className="section-nav">
          <NavButton active={rpgSection === 'rules'} icon={<BookOpen size={17} />} label="RPG规则" badge={rpg.narrativeModes.length} onClick={() => setRpgSection('rules')} />
          <NavButton active={rpgSection === 'preferences'} icon={<FileArchive size={17} />} label="设定与偏好" onClick={() => setRpgSection('preferences')} />
          <NavButton active={rpgSection === 'characters'} icon={<Users size={17} />} label="登场人物" badge={participants.length + 1} onClick={() => setRpgSection('characters')} />
        </aside>
        <section className="editor-scroll">
          {rpgSection === 'rules' && <EditorPage title="RPG规则" eyebrow="RPG RULES">
            <Field label="章节切换规则"><textarea value={rpg.chapterTransitionRules} onChange={(event) => setRpg({ ...rpg, chapterTransitionRules: event.target.value })} /></Field>
            <Field label="叙事模式切换规则"><textarea value={rpg.narrativeModeRulesPrompt} onChange={(event) => setRpg({ ...rpg, narrativeModeRulesPrompt: event.target.value })} /></Field>
            <div className="form-grid"><Field label="章节开始时选项数"><input type="number" min="4" max="10" value={rpg.newStoryChoiceCount} onChange={(event) => setRpg({ ...rpg, newStoryChoiceCount: Number(event.target.value) })} /></Field><Field label="单章节推荐对话数"><input type="number" min="10" max="30" disabled={!rpg.recommendedChapterTurnsEnabled} value={rpg.recommendedChapterTurns} onChange={(event) => setRpg({ ...rpg, recommendedChapterTurns: Number(event.target.value) })} /></Field></div>
            <Toggle checked={rpg.recommendedChapterTurnsEnabled} onChange={(recommendedChapterTurnsEnabled) => setRpg({ ...rpg, recommendedChapterTurnsEnabled })} label="启用单章节推荐对话数" />
            <Field label="状态栏规则"><textarea value={rpg.statusRulesPrompt} onChange={(event) => setRpg({ ...rpg, statusRulesPrompt: event.target.value })} /></Field>
            <Toggle checked={Boolean(rpg.clearStatusBarAfterChapter)} onChange={(clearStatusBarAfterChapter) => setRpg({ ...rpg, clearStatusBarAfterChapter })} label="章节结束后自动清空状态栏" description="取消勾选，章节结束后保留状态栏" />
            <section className="builder-subsection"><div className="builder-section-heading"><div><h2>叙事模式</h2><p>首个模式是新游戏和未指定状态的默认模式。模式名称会用于导入人物包时进行精确匹配。</p></div><button className="secondary-button" onClick={addMode}><Plus size={15} />新增模式</button></div>
            <div className="builder-mode-list">{normalizeNarrativeModes(rpg.narrativeModes).map((mode, index) => <section className="builder-mode-item" key={mode.id}>
              <div className="builder-mode-row"><span className="builder-mode-index">{index + 1}</span><Field label="模式名称"><input defaultValue={mode.name} onBlur={(event) => finishModeName(mode, event.target.value)} /></Field><Field label="标识颜色"><input type="color" value={mode.color} onChange={(event) => patchMode(mode.id, { color: event.target.value })} /></Field><button className="icon-danger" disabled={rpg.narrativeModes.length <= 1} onClick={() => deleteMode(mode.id)} title="删除模式"><Trash2 size={16} /></button></div>
            </section>)}</div>
            </section>
          </EditorPage>}
          {rpgSection === 'preferences' && <EditorPage title="设定与偏好" eyebrow="SETTING & PREFERENCES">
            <Field label="RPG 名称" required><input value={rpg.title} onChange={(event) => setRpg({ ...rpg, title: event.target.value })} placeholder="未命名 RPG" /></Field>
            <Field label="故事背景设定"><textarea value={rpg.worldSettingPrompt} onChange={(event) => setRpg({ ...rpg, worldSettingPrompt: event.target.value })} /></Field>
            <Field label="NSFW 场景偏好"><textarea value={rpg.nsfwScenePrompt} onChange={(event) => setRpg({ ...rpg, nsfwScenePrompt: event.target.value })} /></Field>
            <section className="builder-subsection"><div className="builder-section-heading"><div><h2>叙事文风</h2><p>全局文风会与当前叙事模式的专属文风共同生效。</p></div></div><div className="builder-mode-tabs" role="tablist" aria-label="叙事文风模式"><button className={styleModeId === 'global' ? 'active' : ''} onClick={() => setStyleModeId('global')}>全局</button>{normalizeNarrativeModes(rpg.narrativeModes).map((mode) => <button className={styleModeId === mode.id ? 'active' : ''} key={mode.id} onClick={() => setStyleModeId(mode.id)}><span style={{ background: mode.color }} />{mode.name}</button>)}</div>{styleModeId === 'global' ? <Field label="全局剧情规则与文风"><textarea value={rpg.storyStylePrompt} onChange={(event) => setRpg({ ...rpg, storyStylePrompt: event.target.value })} /></Field> : <Field label={`${rpg.narrativeModes.find((mode) => mode.id === styleModeId)?.name ?? '当前模式'}专属文风提示词`}><textarea value={rpg.modeStoryStylePrompts?.[styleModeId] ?? ''} onChange={(event) => setRpg({ ...rpg, modeStoryStylePrompts: { ...rpg.modeStoryStylePrompts, [styleModeId]: event.target.value } })} placeholder="可留空；仅在当前模式下与全局文风共同生效" /></Field>}</section>
            <section className="builder-subsection"><div className="builder-section-heading"><div><h2>初始状态</h2><p>这些内容用于新游戏开始时的地点、时间、章节和第一条消息。</p></div></div><div className="form-grid"><Field label="初始地点"><input value={rpg.location} onChange={(event) => setRpg({ ...rpg, location: event.target.value })} /></Field><Field label="初始时间"><input value={rpg.time} onChange={(event) => setRpg({ ...rpg, time: event.target.value })} /></Field></div><Field label="初始章节名"><input value={rpg.chapterTitle} onChange={(event) => setRpg({ ...rpg, chapterTitle: event.target.value })} /></Field><Field label="开场内容"><textarea className="opening-textarea" value={rpg.openingMessage} onChange={(event) => setRpg({ ...rpg, openingMessage: event.target.value })} placeholder="可使用 RPGBox 的 [状态]、[旁白]、角色（表情）及 [选项A] 格式" /></Field></section>
          </EditorPage>}
          {rpgSection === 'characters' && <EditorPage title="登场人物" eyebrow="CAST">
            <div className="cast-toolbar"><div className="cast-tabs"><button className={selectedParticipantId === 'player' ? 'active' : ''} onClick={() => setSelectedParticipantId('player')}><span style={{ background: player.color }} />{player.name || '主角'}<small>主角</small></button>{participants.map((character) => <button className={selectedParticipantId === character.id ? 'active' : ''} onClick={() => setSelectedParticipantId(character.id)} key={character.id}><span style={{ background: character.color }} />{character.name || '未命名'}<small>NPC</small></button>)}</div><label className="secondary-button"><FileUp size={16} />导入人物包<input hidden type="file" multiple accept=".role.rpgbox" onChange={(event) => void importParticipants(event)} /></label></div>
            {selectedParticipant && <CharacterFields character={selectedParticipant} compact narrativeModes={rpg.narrativeModes} onChange={(next) => selectedParticipantId === 'player' ? setPlayer(next) : setParticipants((current) => current.map((item) => item.id === next.id ? next : item))} onDelete={selectedParticipantId === 'player' ? undefined : () => { setParticipants((current) => current.filter((item) => item.id !== selectedParticipantId)); setSelectedParticipantId('player') }} />}
          </EditorPage>}
        </section>
      </div> : <section className="role-workspace editor-scroll"><EditorPage title="人物包" eyebrow="CHARACTER PACKAGE">
        <CharacterFields character={role} onChange={setRole} onBatch={() => setBatchPromptOpen(true)} />
      </EditorPage></section>}

      {notice && <div className={`builder-toast ${notice.tone}`} role="status"><span>{notice.tone === 'success' ? <Check size={16} /> : <X size={16} />}</span>{notice.text}<button onClick={() => setNotice(null)} title="关闭"><X size={15} /></button></div>}

      {batchPromptOpen && <div className="builder-modal-layer" role="dialog" aria-modal="true" aria-labelledby="batch-title"><button className="modal-backdrop" aria-label="关闭" onClick={() => setBatchPromptOpen(false)} /><section className="builder-modal"><div className="modal-icon"><FolderOpen size={22} /></div><h2 id="batch-title">批量导入立绘</h2><div className="naming-example"><code>{role.name || '姓名'}_表情.png</code></div><p>仅导入姓名与当前角色完全一致的 PNG 图片，例如“{role.name || '姓名'}_正常.png”。推荐尺寸为 800 × 1200。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setBatchPromptOpen(false)}>取消</button><button className="primary-button" disabled={!role.name.trim()} onClick={() => { setBatchPromptOpen(false); directoryInputRef.current?.click() }}><FolderOpen size={16} />选择目录</button></div></section></div>}
      <input ref={directoryInputRef} className="hidden-input" type="file" multiple accept="image/*" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={importDirectory} />
    </main>
  )
}

function CharacterFields({ character, compact = false, narrativeModes, onChange, onDelete, onBatch }: { character: CharacterDraft; compact?: boolean; narrativeModes?: NarrativeMode[]; onChange: (character: CharacterDraft) => void; onDelete?: () => void; onBatch?: () => void }) {
  const [colorError, setColorError] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [colorPickerStream, setColorPickerStream] = useState<MediaStream | null>(null)
  const modes = narrativeModes ? normalizeNarrativeModes(narrativeModes) : []
  const [selectedModeId, setSelectedModeId] = useState(modes[0]?.id ?? '')
  const selectedMode = modes.find((mode) => mode.id === selectedModeId) ?? modes[0]
  const screenPickerSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
  useEffect(() => {
    if (modes.length && !modes.some((mode) => mode.id === selectedModeId)) setSelectedModeId(modes[0].id)
  }, [modes, selectedModeId])
  function patch(patchValue: Partial<CharacterDraft>) { onChange({ ...character, ...patchValue }) }
  async function pickScreenColor() {
    setColorError('')
    if (!screenPickerSupported) {
      setColorError('当前浏览器不支持窗口取色，请使用最新版 Chrome、Edge 或手动输入颜色。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      setColorPickerStream(stream)
    } catch (error) {
      if (!(error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError'))) setColorError('窗口取色失败，请重试或手动输入颜色。')
    }
  }
  function closeColorPicker() {
    colorPickerStream?.getTracks().forEach((track) => track.stop())
    setColorPickerStream(null)
  }
  function addPortrait(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    const additions: PortraitDraft[] = files.map((file, index) => {
      const expression = file.name.replace(/\.[^.]+$/u, '').split('_').at(-1)?.trim() || `表情${character.portraits.length + index + 1}`
      return { id: createId('portrait'), expression, tags: [expression], groups: selectedMode ? groupsForExpression(expression, selectedMode.id) : undefined, file, extension: file.name.match(/\.([^.]+)$/u)?.[1]?.toLowerCase() ?? 'png', previewUrl: URL.createObjectURL(file) }
    })
    const next = { ...character, portraits: [...character.portraits, ...additions] }
    onChange(selectedMode ? applyMissingDefaults(next, modes) : { ...next, defaultPortraitId: next.defaultPortraitId ?? additions[0]?.id })
  }
  function patchPortrait(id: string, value: Partial<PortraitDraft>) { patch({ portraits: character.portraits.map((portrait) => portrait.id === id ? { ...portrait, ...value } : portrait) }) }
  function removePortrait(id: string) {
    const portraits = character.portraits.filter((portrait) => portrait.id !== id)
    patch({ portraits, defaultPortraitId: character.defaultPortraitId === id ? undefined : character.defaultPortraitId, defaultPortraitIds: Object.fromEntries(Object.entries(character.defaultPortraitIds ?? {}).filter(([, value]) => value !== id)) })
  }
  function toggleGroup(portrait: PortraitDraft, group: PortraitGroup) {
    const groups = portrait.groups ?? ['normal']
    const next = groups.includes(group) ? groups.filter((item) => item !== group) : [...groups, group]
    const defaults = { ...character.defaultPortraitIds }
    if (!next.includes(group) && defaults[group] === portrait.id) delete defaults[group]
    patch({ portraits: character.portraits.map((item) => item.id === portrait.id ? { ...item, groups: next } : item), defaultPortraitIds: defaults })
  }
  function makeDefault(portrait: PortraitDraft, group: PortraitGroup) { patch({ defaultPortraitId: group === modes[0]?.id ? portrait.id : character.defaultPortraitId, defaultPortraitIds: { ...character.defaultPortraitIds, [group]: portrait.id } }) }

  return <div className={`character-form ${compact ? 'compact' : ''}`}>
    <div className="character-heading"><div className="character-avatar" style={{ borderColor: character.color }}>{character.name.trim().charAt(0) || '?'}</div><div><strong>{character.name || '未命名人物'}</strong><span>{character.role === 'player' ? 'PLAYER' : 'NON-PLAYER CHARACTER'}</span></div>{onDelete && <button className="icon-danger" title="移除人物" onClick={onDelete}><Trash2 size={17} /></button>}</div>
    <div className="form-grid"><Field label="姓名" required><input value={character.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="性别"><input value={character.gender} onChange={(event) => patch({ gender: event.target.value })} /></Field></div>
    <Field label="主体颜色"><div className="color-control"><div className="color-field"><button type="button" className={`color-preview ${paletteOpen ? 'active' : ''}`} style={{ backgroundColor: normalizeHexColor(character.color, '#d3ab61') }} onClick={() => setPaletteOpen((current) => !current)} aria-label="打开调色盘" aria-expanded={paletteOpen} title="打开调色盘"><Palette size={16} /></button><button type="button" className="screen-eyedropper-button" disabled={!screenPickerSupported} onClick={() => void pickScreenColor()} aria-label="从其他窗口取色" title={screenPickerSupported ? '从其他窗口取色' : '当前浏览器不支持窗口取色'}><Pipette size={17} /></button><input value={character.color} onChange={(event) => patch({ color: event.target.value })} onBlur={() => patch({ color: normalizeHexColor(character.color, '#d3ab61') })} aria-label="主体颜色十六进制值" /></div>{paletteOpen && <BuilderColorPalette value={character.color} onChange={(color) => patch({ color })} />}{colorError && <span className="color-error">{colorError}</span>}</div></Field>
    <Field label="人物设定"><textarea value={character.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
    <Field label="状态栏"><textarea className="short-textarea" value={character.statusBar ?? ''} onChange={(event) => patch({ statusBar: event.target.value })} /></Field>
    {selectedMode && <section className="builder-character-modes"><div className="builder-mode-tabs" role="tablist" aria-label="人物叙事模式">{modes.map((mode) => <button className={mode.id === selectedMode.id ? 'active' : ''} key={mode.id} onClick={() => setSelectedModeId(mode.id)}><span style={{ background: mode.color }} />{mode.name}</button>)}</div><Field label={`${selectedMode.name}特殊设定`}><textarea value={character.modeDescriptions?.[selectedMode.id] ?? ''} onChange={(event) => patch({ modeDescriptions: { ...character.modeDescriptions, [selectedMode.id]: event.target.value } })} placeholder="可留空；仅在当前叙事模式下生效" /></Field></section>}
    <div className="portrait-block"><div className="portrait-head"><div><h3>立绘与表情</h3><span>{character.portraits.length} 张</span></div><div>{onBatch && <button className="secondary-button" onClick={onBatch}><FolderOpen size={16} />批量导入</button>}<label className="secondary-button"><ImagePlus size={16} />添加立绘<input hidden type="file" multiple accept="image/*" onChange={addPortrait} /></label></div></div>
      {!character.portraits.length ? <div className="empty-portraits"><ImagePlus size={28} /><span>尚未添加立绘</span></div> : <div className="portrait-grid">{character.portraits.map((portrait) => { const groups = portrait.groups ?? (modes[0] ? [modes[0].id] : []); const active = selectedMode ? groups.includes(selectedMode.id) : true; const isDefault = selectedMode ? (character.defaultPortraitIds?.[selectedMode.id] ?? (selectedMode.id === modes[0].id ? character.defaultPortraitId : undefined)) === portrait.id : character.defaultPortraitId === portrait.id; return <article className={`portrait-card ${selectedMode && !active ? 'inactive' : ''}`} key={portrait.id}><div className="portrait-preview"><img src={portrait.previewUrl} alt={portrait.expression} /><button onClick={() => removePortrait(portrait.id)} title="删除立绘"><Trash2 size={15} /></button></div><div className="portrait-fields"><Field label="表情标签"><input value={(portrait.tags ?? [portrait.expression]).join('，')} onChange={(event) => { const tags = event.target.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean); patchPortrait(portrait.id, { tags, expression: tags[0] ?? '' }) }} /></Field>{selectedMode ? <><div className="group-row"><label><input type="checkbox" checked={active} onChange={() => toggleGroup(portrait, selectedMode.id)} />在“{selectedMode.name}”模式启用</label></div><div className="default-row"><button className={isDefault ? 'active' : ''} disabled={!active} onClick={() => makeDefault(portrait, selectedMode.id)}><Star size={13} />{isDefault ? '默认立绘' : '设为默认'}</button></div></> : <div className="default-row"><button className={isDefault ? 'active' : ''} onClick={() => patch({ defaultPortraitId: portrait.id })}><Star size={13} />{isDefault ? '通用默认立绘' : '设为通用默认'}</button></div>}</div></article> })}</div>}
    </div>
    {colorPickerStream && <ScreenColorPicker stream={colorPickerStream} onSelect={(color) => { patch({ color }); closeColorPicker() }} onClose={closeColorPicker} />}
  </div>
}

function BuilderColorPalette({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hsv = hexToHsv(normalizeHexColor(value, '#d3ab61'))
  const hueColor = hsvToHex({ h: hsv.h, s: 100, v: 100 })
  const brightColor = hsvToHex({ h: hsv.h, s: hsv.s, v: 100 })

  function patchHsv(patch: Partial<HsvColor>) {
    onChange(hsvToHex({ ...hsv, ...patch }))
  }

  return <div className="builder-color-palette" aria-label="主体颜色调色盘">
    <ColorSlider label="色相" value={hsv.h} max={359} suffix="°" background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" onChange={(h) => patchHsv({ h })} />
    <ColorSlider label="饱和度" value={hsv.s} max={100} suffix="%" background={`linear-gradient(90deg, #fff, ${hueColor})`} onChange={(s) => patchHsv({ s })} />
    <ColorSlider label="明度" value={hsv.v} max={100} suffix="%" background={`linear-gradient(90deg, #000, ${brightColor})`} onChange={(v) => patchHsv({ v })} />
  </div>
}

function ColorSlider({ label, value, max, suffix, background, onChange }: { label: string; value: number; max: number; suffix: string; background: string; onChange: (value: number) => void }) {
  return <label className="builder-color-slider"><span>{label}</span><input type="range" min="0" max={max} step="1" value={value} style={{ background }} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} /><strong>{value}{suffix}</strong></label>
}

function ScreenColorPicker({ stream, onSelect, onClose }: { stream: MediaStream; onSelect: (color: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    void video.play()
    const track = stream.getVideoTracks()[0]
    const closeWhenSharingEnds = () => onClose()
    track?.addEventListener('ended', closeWhenSharingEnds)
    return () => track?.removeEventListener('ended', closeWhenSharingEnds)
  }, [stream, onClose])

  function sampleColor(event: React.MouseEvent<HTMLVideoElement>) {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const bounds = video.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(video, 0, 0)
    const x = Math.min(video.videoWidth - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * video.videoWidth)))
    const y = Math.min(video.videoHeight - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * video.videoHeight)))
    const [red, green, blue] = context.getImageData(x, y, 1, 1).data
    onSelect(`#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`)
  }

  return <div className="screen-picker-layer" role="dialog" aria-modal="true" aria-label="窗口取色"><section className="screen-picker-dialog"><header><div><span>WINDOW COLOR PICKER</span><h2>点击画面选取颜色</h2></div><button type="button" onClick={onClose} title="取消取色"><X size={19} /></button></header><video ref={videoRef} muted playsInline onClick={sampleColor} /><footer><Pipette size={15} />点击目标像素后自动返回人物编辑</footer></section></div>
}

function EditorPage({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) { return <div className="editor-page"><div className="page-title"><span>{eyebrow}</span><h1>{title}</h1></div><div className="form-stack">{children}</div></div> }
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) { return <label className="builder-field"><span>{label}{required && <i>*</i>}</span>{children}</label> }
function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) { return <label className="builder-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /><span className="builder-toggle-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span></label> }
function NavButton({ active, icon, label, badge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span>{badge !== undefined && <small>{badge}</small>}</button> }
function toMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
