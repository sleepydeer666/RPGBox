import { ArchiveRestore, ArrowDown, ArrowUp, BookCopy, BookOpen, Check, Compass, Download, FileUp, Info, Moon, Pencil, Plus, Settings, Sun, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import packageJson from '../../package.json'
import type { BundledRpgPreset } from '../lib/bundledRpg'
import { RPGBOX_DIRECTORY_LABEL, type RpgboxImportSource, type RpgExportOptions } from '../lib/rpgPackage'
import type { GameSession } from '../types'

const REPOSITORY_URL = 'https://github.com/sleepydeer666/RPGBox'
const MARQUEE_CHARACTERS_PER_SECOND = 2 / 3
const MARQUEE_ENDPOINT_PAUSE_MS = 1000

export interface GameDrawerProps {
  open: boolean
  games: GameSession[]
  activeGameId: string
  onClose: () => void
  onSelect: (id: string) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
  onCreate: (title: string, importSource: RpgboxImportSource | null, onPortraitProgress?: (completed: number, total: number) => void) => Promise<void>
  onUpdateMetadata: (id: string, title: string) => void
  onDelete: (id: string) => Promise<void>
  onClone: (id: string) => Promise<void>
  onExport: (id: string, options: RpgExportOptions, onPortraitProgress?: (completed: number, total: number) => void) => Promise<string>
  bundledRpgPresets: BundledRpgPreset[]
  bundledRpgImportKeys: string[]
  onImportBundledRpg: (key: string, onPortraitProgress?: (completed: number, total: number) => void) => Promise<void>
  onOpenSettings: () => void
  onStartOnboarding: () => void
  lightMode: boolean
  onToggleLightMode: () => void
}

export default function GameDrawer(props: GameDrawerProps) {
  const [editingId, setEditingId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [pickedImportFile, setPickedImportFile] = useState<File | null>(null)
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number } | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const [selectedPresetKey, setSelectedPresetKey] = useState('')
  const [presetProgress, setPresetProgress] = useState<{ completed: number; total: number } | null>(null)
  const [exportGame, setExportGame] = useState<GameSession | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState<RpgExportOptions>({ settings: true, characters: true })
  const [exportProgress, setExportProgress] = useState<{ completed: number; total: number } | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (pickedImportFile && !createTitle.trim()) setCreateTitle(pickedImportFile.name.replace(/\.rpgbox$/iu, ''))
  }, [pickedImportFile])

  function startEditing(game: GameSession) {
    setEditingId(game.id)
    setDraftTitle(game.title)
  }

  function saveEditing() {
    if (!editingId) return
    props.onUpdateMetadata(editingId, draftTitle)
    setEditingId('')
  }

  function openCreateDialog() {
    setCreateTitle('')
    setPickedImportFile(null)
    setImportProgress(null)
    setCreateOpen(true)
  }

  function openPresetDialog() {
    setSelectedPresetKey(props.bundledRpgPresets[0]?.key ?? '')
    setPresetProgress(null)
    setActionError('')
    setPresetOpen(true)
  }

  async function confirmCreate() {
    const importSource = pickedImportFile
    const importName = pickedImportFile?.name
    const summary = importName ? `并从 ${importName} 导入所选内容` : '并建立一个空白 RPG'
    if (!window.confirm(`确认新建 RPG ${summary}？`)) return
    setWorking(true)
    setActionError('')
    setImportProgress(importSource ? { completed: 0, total: 0 } : null)
    try {
      await props.onCreate(createTitle, importSource, (completed, total) => setImportProgress({ completed, total }))
      setCreateOpen(false)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
      setImportProgress(null)
    }
  }

  async function confirmPresetImport() {
    const preset = props.bundledRpgPresets.find((item) => item.key === selectedPresetKey)
    if (!preset) return
    const alreadyImported = props.bundledRpgImportKeys.includes(preset.key)
    const prompt = alreadyImported
      ? `“${preset.title}”已经导入过。确认重新导入一个独立副本？`
      : `确认导入预设“${preset.title}”？`
    if (!window.confirm(prompt)) return
    setWorking(true)
    setActionError('')
    setPresetProgress({ completed: 0, total: preset.portraitCount })
    try {
      await props.onImportBundledRpg(preset.key, (completed, total) => setPresetProgress({ completed, total }))
      setNotice(`已导入预设：${preset.title}`)
      setPresetOpen(false)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
      setPresetProgress(null)
    }
  }

  async function deleteGame(game: GameSession) {
    const lastHint = props.games.length === 1 ? ' 删除后 RPG 列表将为空。' : ''
    if (!window.confirm(`确认删除“${game.title}”？该 RPG 的剧情、记忆、角色和立绘都会被永久删除。${lastHint}`)) return
    setWorking(true)
    setActionError('')
    try {
      await props.onDelete(game.id)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function cloneGame(game: GameSession) {
    if (!window.confirm(`确认克隆“${game.title}”？剧情、记忆、提示词、角色和立绘都会复制一份。`)) return
    setWorking(true)
    setActionError('')
    try {
      await props.onClone(game.id)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function confirmExport() {
    if (!exportGame || (!exportOptions.settings && !exportOptions.characters)) return
    if (!window.confirm(`确认按当前选项导出“${exportGame.title}”？文件将保存到 ${RPGBOX_DIRECTORY_LABEL}。`)) return
    setWorking(true)
    setActionError('')
    const portraitTotal = exportOptions.characters
      ? exportGame.characters.reduce((total, character) => total + character.portraits.length, 0)
      : 0
    setExportProgress(portraitTotal > 0 ? { completed: 0, total: portraitTotal } : null)
    try {
      const path = await props.onExport(exportGame.id, exportOptions, (completed, total) => setExportProgress({ completed, total }))
      setNotice(`已导出：${path}`)
      setExportGame(null)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
      setExportProgress(null)
    }
  }

  return (
    <>
      <aside className={`game-drawer ${props.open ? 'open' : ''}`} aria-label="RPG目录">
        <div className="drawer-head">
          <div><span className="eyebrow">RPG LIBRARY</span><h2>RPG目录</h2></div>
          <div className="drawer-head-actions"><button className="theme-toggle-button" onClick={props.onToggleLightMode} title={props.lightMode ? '切换为夜间模式' : '切换为白天模式'} aria-label={props.lightMode ? '切换为夜间模式' : '切换为白天模式'}>{props.lightMode ? <Moon size={18} /> : <Sun size={18} />}</button><button className="icon-button" onClick={props.onClose} title="关闭RPG目录"><X size={19} /></button></div>
        </div>
        <button className="new-game-button" onClick={openCreateDialog}><Plus size={17} />新建RPG</button>
        <div className={`drawer-notice ${actionError ? 'error' : ''}`}>{actionError || notice}</div>
        <nav className="game-list">
          {props.games.map((game) => editingId === game.id ? (
            <div className="game-list-editor" key={game.id}>
              <label>名称<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus /></label>
              <div><button className="text-button" onClick={() => setEditingId('')}>取消</button><button className="primary-button compact" onClick={saveEditing}><Check size={15} />保存</button></div>
            </div>
          ) : (
            <div className={`game-list-item ${game.id === props.activeGameId ? 'active' : ''}`} key={game.id}>
              <button className="game-list-select" onClick={() => props.onSelect(game.id)}>
                <BookOpen size={18} />
                <span className="game-list-copy"><span className="game-title-line"><strong>{game.title}</strong></span><GameCharacterSummary game={game} /></span>
              </button>
              <div className="game-list-order" aria-label="调整 RPG 顺序">
                <button onClick={() => props.onReorder(game.id, 'up')} title="上移 RPG" aria-label={`上移“${game.title}”`} disabled={working || props.games.indexOf(game) === 0}><ArrowUp size={16} /></button>
                <button onClick={() => props.onReorder(game.id, 'down')} title="下移 RPG" aria-label={`下移“${game.title}”`} disabled={working || props.games.indexOf(game) === props.games.length - 1}><ArrowDown size={16} /></button>
              </div>
              <div className="game-list-actions">
                <button onClick={() => startEditing(game)} title="编辑名称" disabled={working}><Pencil size={15} /><span>编辑</span></button>
                <button onClick={() => void cloneGame(game)} title="克隆 RPG" disabled={working}><BookCopy size={15} /><span>克隆</span></button>
                <button onClick={() => { setExportGame(game); setExportOptions({ settings: true, characters: true }); setActionError('') }} title="导出 RPGBox 文件" disabled={working}><Download size={15} /><span>导出</span></button>
                <button className="danger" onClick={() => void deleteGame(game)} title="删除 RPG" disabled={working}><Trash2 size={15} /><span>删除</span></button>
              </div>
            </div>
          ))}
        </nav>
        <div className="drawer-footer-actions">
          <button onClick={props.onOpenSettings}><Settings size={19} /><span>AI配置</span></button>
          <button onClick={openPresetDialog}><ArchiveRestore size={19} /><span>导入预设</span></button>
          <button onClick={props.onStartOnboarding} disabled={!props.games.length} title={props.games.length ? '打开新手导航' : '请先创建或导入 RPG'}><Compass size={19} /><span>新手导航</span></button>
          <button onClick={() => setAboutOpen(true)}><Info size={19} /><span>关于</span></button>
        </div>
      </aside>
      {props.open && <button className="drawer-backdrop" onClick={props.onClose} aria-label="关闭RPG目录" />}
      {createOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="新建RPG"><button className="backdrop" onClick={() => !working && setCreateOpen(false)} aria-label="取消新建" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">NEW RPG</span><h2>新建RPG</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content"><label>RPG 名称<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder={`留空使用“新RPG ${props.games.length + 1}”`} /></label><div className="system-file-picker"><span>导入 RPGBox 文件</span><label className="secondary-button"><FileUp size={16} />{pickedImportFile?.name ?? '选择文件'}<input type="file" accept=".rpgbox,application/zip,application/octet-stream" hidden onChange={(event) => { setPickedImportFile(event.target.files?.[0] ?? null); event.target.value = '' }} /></label>{pickedImportFile && <button type="button" className="text-button" onClick={() => setPickedImportFile(null)}>取消选择</button>}</div><p className="directory-note">可从 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>、下载目录或其他位置选择 `.rpgbox` 文件；不选择文件则建立空白 RPG。</p>{working && pickedImportFile && importProgress && <PortraitImportProgress progress={importProgress} label="正在解压立绘" />}{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>{pickedImportFile ? `已选择 ${pickedImportFile.name}` : '未选择文件，将建立空白 RPG'}</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmCreate()} disabled={working}>{working ? '导入中' : '确认新建'}</button></div></div></section></div>}
      {presetOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="导入预设RPG"><button className="backdrop" onClick={() => !working && setPresetOpen(false)} aria-label="取消导入预设" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">IMPORT PRESET</span><h2>导入预设 RPG</h2></div><button className="icon-button" onClick={() => setPresetOpen(false)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content">{props.bundledRpgPresets.length ? <div className="preset-rpg-list" role="radiogroup" aria-label="选择预设 RPG">{props.bundledRpgPresets.map((preset) => <label className={`preset-rpg-option ${selectedPresetKey === preset.key ? 'selected' : ''}`} key={preset.key}><input type="radio" name="bundled-rpg" value={preset.key} checked={selectedPresetKey === preset.key} onChange={() => setSelectedPresetKey(preset.key)} disabled={working} /><span><strong>{preset.title}</strong><small>{preset.portraitCount} 张立绘{preset.hasNsfw ? ' · 包含 NSFW 设置' : ''}</small></span>{props.bundledRpgImportKeys.includes(preset.key) && <em>已导入</em>}</label>)}</div> : <div className="preset-rpg-empty">当前安装包没有可用的预设 RPG</div>}{working && presetProgress && <PortraitImportProgress progress={presetProgress} label="正在导入预设立绘" />}{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>导入后会创建独立 RPG，不覆盖已有内容</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setPresetOpen(false)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmPresetImport()} disabled={working || !selectedPresetKey}>{working ? '导入中' : '确认导入'}</button></div></div></section></div>}
      {exportGame && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="导出RPG"><button className="backdrop" onClick={() => !working && setExportGame(null)} aria-label="取消导出" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">EXPORT RPGBOX</span><h2>导出“{exportGame.title}”</h2></div><button className="icon-button" onClick={() => setExportGame(null)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content export-option-list"><label><input type="checkbox" checked={exportOptions.settings} onChange={(event) => setExportOptions((current) => ({ ...current, settings: event.target.checked }))} /><span><strong>RPG 设置</strong><small>提示词、剧情记录、状态、章节、记忆及场景偏好，不包含AI配置</small></span></label><label><input type="checkbox" checked={exportOptions.characters} onChange={(event) => setExportOptions((current) => ({ ...current, characters: event.target.checked }))} /><span><strong>角色</strong><small>完整人物资料、颜色、状态栏及全部叙事模式立绘资源</small></span></label><p className="directory-note">文件将保存到 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>，扩展名为 `.rpgbox`。AI接口、密钥、模型及参数不会导出。</p>{working && exportProgress && <PortraitImportProgress progress={exportProgress} label="正在打包立绘" />}{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>包内包含 rpg.xml 和所选立绘资源</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setExportGame(null)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmExport()} disabled={working || (!exportOptions.settings && !exportOptions.characters)}>{working ? '导出中' : '确认导出'}</button></div></div></section></div>}
      {aboutOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-labelledby="about-title"><button className="backdrop" onClick={() => setAboutOpen(false)} aria-label="关闭关于" /><section className="modal about-modal"><div className="modal-head"><div><span className="eyebrow">ABOUT RPGBOX</span><h2 id="about-title">关于</h2></div><button className="icon-button" onClick={() => setAboutOpen(false)} title="关闭"><X size={19} /></button></div><div className="about-content"><div><span>当前版本</span><strong>v{packageJson.version}</strong></div><div><span>GitHub 仓库</span><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">{REPOSITORY_URL}</a></div></div><div className="modal-footer"><span>RPGBox</span><button className="primary-button" onClick={() => setAboutOpen(false)}>完成</button></div></section></div>}
    </>
  )
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function PortraitImportProgress({ progress, label }: { progress: { completed: number; total: number }; label: string }) {
  const percent = progress.total ? Math.round(progress.completed / progress.total * 100) : 0
  return <div className="portrait-import-status" aria-live="polite"><div><span>{label}</span><strong>{progress.total ? `${progress.completed} / ${progress.total}` : '正在读取包内容'}</strong></div><div className="library-import-progress" aria-label={`立绘处理进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div></div>
}

function GameCharacterSummary({ game }: { game: GameSession }) {
  const viewportRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const characters = [
    ...game.characters.filter((character) => character.role === 'player'),
    ...game.characters.filter((character) => character.role !== 'player'),
  ]
  const characterLabels = characters.map((character) => `${character.name.trim() || '未命名角色'}${character.role === 'player' ? '（你）' : ''}`)
  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const measure = () => {
      const distance = Math.max(0, content.scrollWidth - viewport.clientWidth)
      animationRef.current?.cancel()
      animationRef.current = null
      if (distance === 0) return
      const characterWidth = Number.parseFloat(window.getComputedStyle(content).fontSize) || 12
      const movementDuration = distance / characterWidth / MARQUEE_CHARACTERS_PER_SECOND * 1000
      const totalDuration = movementDuration + MARQUEE_ENDPOINT_PAUSE_MS * 2
      animationRef.current = content.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: MARQUEE_ENDPOINT_PAUSE_MS / totalDuration },
        { transform: `translateX(-${distance}px)`, offset: (MARQUEE_ENDPOINT_PAUSE_MS + movementDuration) / totalDuration },
        { transform: `translateX(-${distance}px)`, offset: 1 },
      ], { duration: totalDuration, iterations: Infinity, easing: 'linear' })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(content)
    return () => {
      observer.disconnect()
      animationRef.current?.cancel()
      animationRef.current = null
    }
  }, [game.characters])
  return (
    <small className="game-character-summary">
      <span className="game-character-summary-label">出场人物：</span>
      <span ref={viewportRef} className="game-character-summary-viewport">
        <span ref={contentRef} className="game-character-summary-track">{characters.map((character, index) => <span key={character.id}>{index > 0 ? '，' : ''}<span style={{ color: character.color }}>{characterLabels[index]}</span></span>)}</span>
      </span>
    </small>
  )
}
