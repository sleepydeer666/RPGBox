import { BookOpen, Check, Download, FileArchive, FileUp, FolderOpen, ImagePlus, Palette, Pipette, Plus, Star, Trash2, UserRound, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { hexToHsv, hsvToHex, normalizeHexColor, type HsvColor } from '../lib/color'
import type { PortraitGroup } from '../types'
import {
  applyMissingDefaults,
  buildRolePackage,
  buildRpgPackage,
  createId,
  downloadPackage,
  groupsForExpression,
  importBatchPortraits,
  readRpgPackage,
  readRolePackage,
  safeFileName,
  type CharacterDraft,
  type PortraitDraft,
  type RpgDraftSettings,
} from './package'

type Workspace = 'rpg' | 'role'
type RpgSection = 'basic' | 'rules' | 'opening' | 'characters'

const DEFAULT_CHARACTER: CharacterDraft = {
  id: createId('npc'),
  role: 'npc',
  name: '',
  gender: '',
  description: '',
  nsfwDescription: '',
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
  nsfwEnabled: false,
  newStoryChoiceCount: 4,
  storyStylePrompt: '',
  chapterTransitionRules: '',
  recommendedChapterTurnsEnabled: false,
  recommendedChapterTurns: 20,
  statusRulesPrompt: '',
  nsfwScenePrompt: '',
  worldSettingPrompt: '',
  openingMessage: '',
  location: '未知之地',
  time: '序章',
  chapterTitle: '',
}

export default function BuilderApp() {
  const [workspace, setWorkspace] = useState<Workspace>('rpg')
  const [rpgSection, setRpgSection] = useState<RpgSection>('basic')
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
      const imported = await Promise.all(files.map(readRolePackage))
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
        setRpgSection('basic')
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
          <NavButton active={rpgSection === 'basic'} icon={<FileArchive size={17} />} label="基本信息" onClick={() => setRpgSection('basic')} />
          <NavButton active={rpgSection === 'rules'} icon={<BookOpen size={17} />} label="剧情设置" onClick={() => setRpgSection('rules')} />
          <NavButton active={rpgSection === 'opening'} icon={<ImagePlus size={17} />} label="开场设置" onClick={() => setRpgSection('opening')} />
          <NavButton active={rpgSection === 'characters'} icon={<Users size={17} />} label="参与人物" badge={participants.length + 1} onClick={() => setRpgSection('characters')} />
        </aside>
        <section className="editor-scroll">
          {rpgSection === 'basic' && <EditorPage title="基本信息" eyebrow="RPG PACKAGE">
            <Field label="RPG 名称" required><input value={rpg.title} onChange={(event) => setRpg({ ...rpg, title: event.target.value })} placeholder="未命名 RPG" /></Field>
            <Toggle checked={rpg.nsfwEnabled} onChange={(nsfwEnabled) => setRpg({ ...rpg, nsfwEnabled })} label="启用 NSFW 内容" />
          </EditorPage>}
          {rpgSection === 'rules' && <EditorPage title="剧情设置" eyebrow="STORY RULES">
            <Field label="剧情规则与文风"><textarea value={rpg.storyStylePrompt} onChange={(event) => setRpg({ ...rpg, storyStylePrompt: event.target.value })} /></Field>
            <Field label="章节切换规则"><textarea value={rpg.chapterTransitionRules} onChange={(event) => setRpg({ ...rpg, chapterTransitionRules: event.target.value })} /></Field>
            <div className="form-grid"><Field label="章节开始时选项数"><input type="number" min="4" max="10" value={rpg.newStoryChoiceCount} onChange={(event) => setRpg({ ...rpg, newStoryChoiceCount: Number(event.target.value) })} /></Field><Field label="单章节推荐对话数"><input type="number" min="10" max="30" disabled={!rpg.recommendedChapterTurnsEnabled} value={rpg.recommendedChapterTurns} onChange={(event) => setRpg({ ...rpg, recommendedChapterTurns: Number(event.target.value) })} /></Field></div>
            <Toggle checked={rpg.recommendedChapterTurnsEnabled} onChange={(recommendedChapterTurnsEnabled) => setRpg({ ...rpg, recommendedChapterTurnsEnabled })} label="启用单章节推荐对话数" />
            <Field label="状态栏规则"><textarea value={rpg.statusRulesPrompt} onChange={(event) => setRpg({ ...rpg, statusRulesPrompt: event.target.value })} /></Field>
            <Field label="故事背景设定"><textarea value={rpg.worldSettingPrompt} onChange={(event) => setRpg({ ...rpg, worldSettingPrompt: event.target.value })} /></Field>
            {rpg.nsfwEnabled && <Field label="NSFW 场景偏好"><textarea value={rpg.nsfwScenePrompt} onChange={(event) => setRpg({ ...rpg, nsfwScenePrompt: event.target.value })} /></Field>}
          </EditorPage>}
          {rpgSection === 'opening' && <EditorPage title="开场设置" eyebrow="OPENING STATE">
            <div className="form-grid"><Field label="初始地点"><input value={rpg.location} onChange={(event) => setRpg({ ...rpg, location: event.target.value })} /></Field><Field label="初始时间"><input value={rpg.time} onChange={(event) => setRpg({ ...rpg, time: event.target.value })} /></Field></div>
            <Field label="初始章节名"><input value={rpg.chapterTitle} onChange={(event) => setRpg({ ...rpg, chapterTitle: event.target.value })} /></Field>
            <Field label="开场内容"><textarea className="opening-textarea" value={rpg.openingMessage} onChange={(event) => setRpg({ ...rpg, openingMessage: event.target.value })} placeholder="可使用 RPGBox 的 [状态]、[旁白]、角色（表情）及 [选项A] 格式" /></Field>
          </EditorPage>}
          {rpgSection === 'characters' && <EditorPage title="参与人物" eyebrow="CAST">
            <div className="cast-toolbar"><div className="cast-tabs"><button className={selectedParticipantId === 'player' ? 'active' : ''} onClick={() => setSelectedParticipantId('player')}><span style={{ background: player.color }} />{player.name || '主角'}<small>主角</small></button>{participants.map((character) => <button className={selectedParticipantId === character.id ? 'active' : ''} onClick={() => setSelectedParticipantId(character.id)} key={character.id}><span style={{ background: character.color }} />{character.name || '未命名'}<small>NPC</small></button>)}</div><label className="secondary-button"><FileUp size={16} />导入人物包<input hidden type="file" multiple accept=".role.rpgbox" onChange={(event) => void importParticipants(event)} /></label></div>
            {selectedParticipant && <CharacterFields character={selectedParticipant} nsfwEnabled={rpg.nsfwEnabled} compact onChange={(next) => selectedParticipantId === 'player' ? setPlayer(next) : setParticipants((current) => current.map((item) => item.id === next.id ? next : item))} onDelete={selectedParticipantId === 'player' ? undefined : () => { setParticipants((current) => current.filter((item) => item.id !== selectedParticipantId)); setSelectedParticipantId('player') }} />}
          </EditorPage>}
        </section>
      </div> : <section className="role-workspace editor-scroll"><EditorPage title="人物包" eyebrow="CHARACTER PACKAGE">
        <CharacterFields character={role} nsfwEnabled onChange={setRole} onBatch={() => setBatchPromptOpen(true)} />
      </EditorPage></section>}

      {notice && <div className={`builder-toast ${notice.tone}`} role="status"><span>{notice.tone === 'success' ? <Check size={16} /> : <X size={16} />}</span>{notice.text}<button onClick={() => setNotice(null)} title="关闭"><X size={15} /></button></div>}

      {batchPromptOpen && <div className="builder-modal-layer" role="dialog" aria-modal="true" aria-labelledby="batch-title"><button className="modal-backdrop" aria-label="关闭" onClick={() => setBatchPromptOpen(false)} /><section className="builder-modal"><div className="modal-icon"><FolderOpen size={22} /></div><h2 id="batch-title">批量导入立绘</h2><div className="naming-example"><code>{role.name || '姓名'}_表情.png</code></div><p>仅导入姓名与当前角色完全一致的 PNG 图片，例如“{role.name || '姓名'}_正常.png”。推荐尺寸为 800 × 1200。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setBatchPromptOpen(false)}>取消</button><button className="primary-button" disabled={!role.name.trim()} onClick={() => { setBatchPromptOpen(false); directoryInputRef.current?.click() }}><FolderOpen size={16} />选择目录</button></div></section></div>}
      <input ref={directoryInputRef} className="hidden-input" type="file" multiple accept="image/*" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={importDirectory} />
    </main>
  )
}

function CharacterFields({ character, nsfwEnabled, compact = false, onChange, onDelete, onBatch }: { character: CharacterDraft; nsfwEnabled: boolean; compact?: boolean; onChange: (character: CharacterDraft) => void; onDelete?: () => void; onBatch?: () => void }) {
  const [colorError, setColorError] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [colorPickerStream, setColorPickerStream] = useState<MediaStream | null>(null)
  const screenPickerSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
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
      return { id: createId('portrait'), expression, tags: [expression], groups: groupsForExpression(expression), file, extension: file.name.match(/\.([^.]+)$/u)?.[1]?.toLowerCase() ?? 'png', previewUrl: URL.createObjectURL(file) }
    })
    onChange(applyMissingDefaults({ ...character, portraits: [...character.portraits, ...additions] }))
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
  function makeDefault(portrait: PortraitDraft, group: PortraitGroup) { patch({ defaultPortraitId: group === 'normal' ? portrait.id : character.defaultPortraitId, defaultPortraitIds: { ...character.defaultPortraitIds, [group]: portrait.id } }) }

  return <div className={`character-form ${compact ? 'compact' : ''}`}>
    <div className="character-heading"><div className="character-avatar" style={{ borderColor: character.color }}>{character.name.trim().charAt(0) || '?'}</div><div><strong>{character.name || '未命名人物'}</strong><span>{character.role === 'player' ? 'PLAYER' : 'NON-PLAYER CHARACTER'}</span></div>{onDelete && <button className="icon-danger" title="移除人物" onClick={onDelete}><Trash2 size={17} /></button>}</div>
    <div className="form-grid"><Field label="姓名" required><input value={character.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="性别"><input value={character.gender} onChange={(event) => patch({ gender: event.target.value })} /></Field></div>
    <Field label="主体颜色"><div className="color-control"><div className="color-field"><button type="button" className={`color-preview ${paletteOpen ? 'active' : ''}`} style={{ backgroundColor: normalizeHexColor(character.color, '#d3ab61') }} onClick={() => setPaletteOpen((current) => !current)} aria-label="打开调色盘" aria-expanded={paletteOpen} title="打开调色盘"><Palette size={16} /></button><button type="button" className="screen-eyedropper-button" disabled={!screenPickerSupported} onClick={() => void pickScreenColor()} aria-label="从其他窗口取色" title={screenPickerSupported ? '从其他窗口取色' : '当前浏览器不支持窗口取色'}><Pipette size={17} /></button><input value={character.color} onChange={(event) => patch({ color: event.target.value })} onBlur={() => patch({ color: normalizeHexColor(character.color, '#d3ab61') })} aria-label="主体颜色十六进制值" /></div>{paletteOpen && <BuilderColorPalette value={character.color} onChange={(color) => patch({ color })} />}{colorError && <span className="color-error">{colorError}</span>}</div></Field>
    <Field label="人物设定"><textarea value={character.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
    <Field label="状态栏"><textarea className="short-textarea" value={character.statusBar ?? ''} onChange={(event) => patch({ statusBar: event.target.value })} /></Field>
    {nsfwEnabled && <Field label="NSFW 设定"><textarea value={character.nsfwDescription ?? ''} onChange={(event) => patch({ nsfwDescription: event.target.value })} /></Field>}
    {!compact && <div className="portrait-block"><div className="portrait-head"><div><h3>立绘与表情</h3><span>{character.portraits.length} 张</span></div><div>{onBatch && <button className="secondary-button" onClick={onBatch}><FolderOpen size={16} />批量导入</button>}<label className="secondary-button"><ImagePlus size={16} />添加立绘<input hidden type="file" multiple accept="image/*" onChange={addPortrait} /></label></div></div>
      {!character.portraits.length ? <div className="empty-portraits"><ImagePlus size={28} /><span>尚未添加立绘</span></div> : <div className="portrait-grid">{character.portraits.map((portrait) => { const groups = portrait.groups ?? ['normal']; return <article className="portrait-card" key={portrait.id}><div className="portrait-preview"><img src={portrait.previewUrl} alt={portrait.expression} /><button onClick={() => removePortrait(portrait.id)} title="删除立绘"><Trash2 size={15} /></button></div><div className="portrait-fields"><Field label="表情标签"><input value={(portrait.tags ?? [portrait.expression]).join('，')} onChange={(event) => { const tags = event.target.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean); patchPortrait(portrait.id, { tags, expression: tags[0] ?? '' }) }} /></Field><div className="group-row"><label><input type="checkbox" checked={groups.includes('normal')} onChange={() => toggleGroup(portrait, 'normal')} />普通</label><label><input type="checkbox" checked={groups.includes('nsfw')} onChange={() => toggleGroup(portrait, 'nsfw')} />NSFW</label></div><div className="default-row"><button className={(character.defaultPortraitIds?.normal ?? character.defaultPortraitId) === portrait.id ? 'active' : ''} disabled={!groups.includes('normal')} onClick={() => makeDefault(portrait, 'normal')}><Star size={13} />普通默认</button><button className={character.defaultPortraitIds?.nsfw === portrait.id ? 'active' : ''} disabled={!groups.includes('nsfw')} onClick={() => makeDefault(portrait, 'nsfw')}><Star size={13} />NSFW 默认</button></div></div></article> })}</div>}
    </div>}
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
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <label className="builder-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /><strong>{label}</strong></label> }
function NavButton({ active, icon, label, badge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span>{badge !== undefined && <small>{badge}</small>}</button> }
function toMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
