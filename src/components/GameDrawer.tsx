import { ArrowDown, ArrowUp, BookCopy, BookOpen, Check, Download, FileUp, Info, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import packageJson from '../../package.json'
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
  onCreate: (title: string, importSource: RpgboxImportSource | null, nsfwEnabled: boolean) => Promise<void>
  onUpdateMetadata: (id: string, title: string, nsfwEnabled: boolean) => void
  onDelete: (id: string) => Promise<void>
  onClone: (id: string) => Promise<void>
  onExport: (id: string, options: RpgExportOptions) => Promise<string>
  onOpenSettings: () => void
}

export default function GameDrawer(props: GameDrawerProps) {
  const [editingId, setEditingId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftNsfwEnabled, setDraftNsfwEnabled] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createNsfwEnabled, setCreateNsfwEnabled] = useState(false)
  const [pickedImportFile, setPickedImportFile] = useState<File | null>(null)
  const [exportGame, setExportGame] = useState<GameSession | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState<RpgExportOptions>({ settings: true, characters: true, nsfw: true })
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (pickedImportFile && !createTitle.trim()) setCreateTitle(pickedImportFile.name.replace(/\.rpgbox$/iu, ''))
  }, [pickedImportFile])

  function startEditing(game: GameSession) {
    setEditingId(game.id)
    setDraftTitle(game.title)
    setDraftNsfwEnabled(game.nsfwEnabled)
  }

  function saveEditing() {
    if (!editingId) return
    props.onUpdateMetadata(editingId, draftTitle, draftNsfwEnabled)
    setEditingId('')
  }

  function openCreateDialog() {
    setCreateTitle('')
    setCreateNsfwEnabled(false)
    setPickedImportFile(null)
    setCreateOpen(true)
  }

  async function confirmCreate() {
    const importSource = pickedImportFile
    const importName = pickedImportFile?.name
    const summary = importName ? `并从 ${importName} 导入所选内容` : '并建立一个空白 RPG'
    if (!window.confirm(`确认新建 RPG ${summary}？`)) return
    setWorking(true)
    setActionError('')
    try {
      await props.onCreate(createTitle, importSource, createNsfwEnabled)
      setCreateOpen(false)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
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
    if (!exportGame || (!exportOptions.settings && !exportOptions.characters && !exportOptions.nsfw)) return
    if (!window.confirm(`确认按当前选项导出“${exportGame.title}”？文件将保存到 ${RPGBOX_DIRECTORY_LABEL}。`)) return
    setWorking(true)
    setActionError('')
    try {
      const path = await props.onExport(exportGame.id, exportOptions)
      setNotice(`已导出：${path}`)
      setExportGame(null)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <aside className={`game-drawer ${props.open ? 'open' : ''}`} aria-label="RPG目录">
        <div className="drawer-head">
          <div><span className="eyebrow">RPG LIBRARY</span><h2>RPG目录</h2></div>
          <button className="icon-button" onClick={props.onClose} title="关闭RPG目录"><X size={19} /></button>
        </div>
        <button className="new-game-button" onClick={openCreateDialog}><Plus size={17} />新建RPG</button>
        <div className={`drawer-notice ${actionError ? 'error' : ''}`}>{actionError || notice}</div>
        <nav className="game-list">
          {props.games.map((game) => editingId === game.id ? (
            <div className="game-list-editor" key={game.id}>
              <label>名称<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus /></label>
              <label className="nsfw-mode-toggle"><input type="checkbox" checked={draftNsfwEnabled} onChange={(event) => setDraftNsfwEnabled(event.target.checked)} /><span><strong>启用 NSFW 模式</strong><small>关闭时隐藏相关设置和立绘，但保留已有数据</small></span></label>
              <div><button className="text-button" onClick={() => setEditingId('')}>取消</button><button className="primary-button compact" onClick={saveEditing}><Check size={15} />保存</button></div>
            </div>
          ) : (
            <div className={`game-list-item ${game.id === props.activeGameId ? 'active' : ''}`} key={game.id}>
              <button className="game-list-select" onClick={() => props.onSelect(game.id)}>
                <BookOpen size={18} />
                <span className="game-list-copy"><span className="game-title-line"><strong>{game.title}</strong>{game.nsfwEnabled && <span className="game-nsfw-status">❤ NSFW启用</span>}</span><GameCharacterSummary game={game} /></span>
              </button>
              <div className="game-list-order" aria-label="调整 RPG 顺序">
                <button onClick={() => props.onReorder(game.id, 'up')} title="上移 RPG" aria-label={`上移“${game.title}”`} disabled={working || props.games.indexOf(game) === 0}><ArrowUp size={16} /></button>
                <button onClick={() => props.onReorder(game.id, 'down')} title="下移 RPG" aria-label={`下移“${game.title}”`} disabled={working || props.games.indexOf(game) === props.games.length - 1}><ArrowDown size={16} /></button>
              </div>
              <div className="game-list-actions">
                <button onClick={() => startEditing(game)} title="编辑名称和内容模式" disabled={working}><Pencil size={15} /><span>编辑</span></button>
                <button onClick={() => void cloneGame(game)} title="克隆 RPG" disabled={working}><BookCopy size={15} /><span>克隆</span></button>
                <button onClick={() => { setExportGame(game); setExportOptions({ settings: true, characters: true, nsfw: game.nsfwEnabled }); setActionError('') }} title="导出 RPGBox 文件" disabled={working}><Download size={15} /><span>导出</span></button>
                <button className="danger" onClick={() => void deleteGame(game)} title="删除 RPG" disabled={working}><Trash2 size={15} /><span>删除</span></button>
              </div>
            </div>
          ))}
        </nav>
        <div className="drawer-footer-actions">
          <button onClick={props.onOpenSettings}><Settings size={19} /><span>全局设置</span></button>
          <button onClick={() => setAboutOpen(true)}><Info size={19} /><span>关于</span></button>
        </div>
      </aside>
      {props.open && <button className="drawer-backdrop" onClick={props.onClose} aria-label="关闭RPG目录" />}
      {createOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="新建RPG"><button className="backdrop" onClick={() => !working && setCreateOpen(false)} aria-label="取消新建" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">NEW RPG</span><h2>新建RPG</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content"><label>RPG 名称<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder={`留空使用“新RPG ${props.games.length + 1}”`} /></label><label className="nsfw-mode-toggle"><input type="checkbox" checked={createNsfwEnabled} onChange={(event) => setCreateNsfwEnabled(event.target.checked)} /><span><strong>启用 NSFW 模式</strong><small>新建 RPG 默认关闭，之后可以随时修改</small></span></label><div className="system-file-picker"><span>导入 RPGBox 文件</span><label className="secondary-button"><FileUp size={16} />{pickedImportFile?.name ?? '选择文件'}<input type="file" accept=".rpgbox,application/zip,application/octet-stream" hidden onChange={(event) => { setPickedImportFile(event.target.files?.[0] ?? null); event.target.value = '' }} /></label>{pickedImportFile && <button type="button" className="text-button" onClick={() => setPickedImportFile(null)}>取消选择</button>}</div><p className="directory-note">可从 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>、下载目录或其他位置选择 `.rpgbox` 文件；不选择文件则建立空白 RPG。</p>{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>{pickedImportFile ? `已选择 ${pickedImportFile.name}` : '未选择文件，将建立空白 RPG'}</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmCreate()} disabled={working}>{working ? '处理中' : '确认新建'}</button></div></div></section></div>}
      {exportGame && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="导出RPG"><button className="backdrop" onClick={() => !working && setExportGame(null)} aria-label="取消导出" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">EXPORT RPGBOX</span><h2>导出“{exportGame.title}”</h2></div><button className="icon-button" onClick={() => setExportGame(null)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content export-option-list"><label><input type="checkbox" checked={exportOptions.settings} onChange={(event) => setExportOptions((current) => ({ ...current, settings: event.target.checked }))} /><span><strong>RPG 设置</strong><small>提示词、剧情记录、状态、章节与记忆，不包含AI配置</small></span></label><label><input type="checkbox" checked={exportOptions.characters} onChange={(event) => setExportOptions((current) => ({ ...current, characters: event.target.checked }))} /><span><strong>角色</strong><small>基础人物资料、颜色、状态栏及常规立绘资源</small></span></label>{exportGame.nsfwEnabled && <label><input type="checkbox" checked={exportOptions.nsfw} onChange={(event) => setExportOptions((current) => ({ ...current, nsfw: event.target.checked }))} /><span><strong><span className="nsfw-mark">❤</span> NSFW 内容</strong><small>偏好的NSFW场景与角色NSFW设定；同时导出角色时包含对应立绘分组</small></span></label>}<p className="directory-note">文件将保存到 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>，扩展名为 `.rpgbox`。AI接口、密钥、模型及参数不会导出。</p>{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>包内包含 rpg.xml 和所选立绘资源</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setExportGame(null)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmExport()} disabled={working || (!exportOptions.settings && !exportOptions.characters && !exportOptions.nsfw)}>{working ? '导出中' : '确认导出'}</button></div></div></section></div>}
      {aboutOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-labelledby="about-title"><button className="backdrop" onClick={() => setAboutOpen(false)} aria-label="关闭关于" /><section className="modal about-modal"><div className="modal-head"><div><span className="eyebrow">ABOUT RPGBOX</span><h2 id="about-title">关于</h2></div><button className="icon-button" onClick={() => setAboutOpen(false)} title="关闭"><X size={19} /></button></div><div className="about-content"><div><span>当前版本</span><strong>v{packageJson.version}</strong></div><div><span>GitHub 仓库</span><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">{REPOSITORY_URL}</a></div></div><div className="modal-footer"><span>RPGBox</span><button className="primary-button" onClick={() => setAboutOpen(false)}>完成</button></div></section></div>}
    </>
  )
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
