import { BookCopy, BookOpen, Check, Download, Pencil, Plus, RefreshCw, Settings, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { listRpgboxFiles, RPGBOX_DIRECTORY_LABEL, type RpgExportOptions } from '../lib/rpgPackage'
import type { GameSession } from '../types'

interface GameDrawerProps {
  open: boolean
  games: GameSession[]
  activeGameId: string
  onClose: () => void
  onSelect: (id: string) => void
  onCreate: (title: string, importFile: string, nsfwEnabled: boolean) => Promise<void>
  onUpdateMetadata: (id: string, title: string, note: string, nsfwEnabled: boolean) => void
  onDelete: (id: string) => Promise<void>
  onClone: (id: string) => Promise<void>
  onExport: (id: string, options: RpgExportOptions) => Promise<string>
  onOpenSettings: () => void
}

export default function GameDrawer(props: GameDrawerProps) {
  const [editingId, setEditingId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [draftNsfwEnabled, setDraftNsfwEnabled] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createNsfwEnabled, setCreateNsfwEnabled] = useState(false)
  const [importFile, setImportFile] = useState('')
  const [importFiles, setImportFiles] = useState<string[]>([])
  const [exportGame, setExportGame] = useState<GameSession | null>(null)
  const [exportOptions, setExportOptions] = useState<RpgExportOptions>({ settings: true, characters: true, nsfw: true })
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  function startEditing(game: GameSession) {
    setEditingId(game.id)
    setDraftTitle(game.title)
    setDraftNote(game.note)
    setDraftNsfwEnabled(game.nsfwEnabled)
  }

  function saveEditing() {
    if (!editingId) return
    props.onUpdateMetadata(editingId, draftTitle, draftNote, draftNsfwEnabled)
    setEditingId('')
  }

  async function refreshImportFiles() {
    setActionError('')
    try {
      setImportFiles(await listRpgboxFiles())
    } catch (error) {
      setActionError(toMessage(error))
    }
  }

  function openCreateDialog() {
    setCreateTitle('')
    setCreateNsfwEnabled(false)
    setImportFile('')
    setCreateOpen(true)
    void refreshImportFiles()
  }

  async function confirmCreate() {
    const summary = importFile ? `并从 ${importFile} 导入所选内容` : '并建立一个空白 RPG'
    if (!window.confirm(`确认新建 RPG ${summary}？`)) return
    setWorking(true)
    setActionError('')
    try {
      await props.onCreate(createTitle, importFile, createNsfwEnabled)
      setCreateOpen(false)
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function deleteGame(game: GameSession) {
    const lastHint = props.games.length === 1 ? ' 删除后会自动建立一个空白 RPG。' : ''
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
              <label>备注<textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} rows={2} placeholder="添加简短备注" /></label>
              <label className="nsfw-mode-toggle"><input type="checkbox" checked={draftNsfwEnabled} onChange={(event) => setDraftNsfwEnabled(event.target.checked)} /><span><strong>启用 NSFW 模式</strong><small>关闭时隐藏相关设置和立绘，但保留已有数据</small></span></label>
              <div><button className="text-button" onClick={() => setEditingId('')}>取消</button><button className="primary-button compact" onClick={saveEditing}><Check size={15} />保存</button></div>
            </div>
          ) : (
            <div className={`game-list-item ${game.id === props.activeGameId ? 'active' : ''}`} key={game.id}>
              <button className="game-list-select" onClick={() => props.onSelect(game.id)}>
                <BookOpen size={18} />
                <span><strong>{game.title}</strong><small>{game.note || '暂无备注'}</small></span>
              </button>
              <div className="game-list-actions">
                <button onClick={() => startEditing(game)} title="编辑名称和备注" disabled={working}><Pencil size={15} /><span>编辑</span></button>
                <button onClick={() => void cloneGame(game)} title="克隆 RPG" disabled={working}><BookCopy size={15} /><span>克隆</span></button>
                <button onClick={() => { setExportGame(game); setExportOptions({ settings: true, characters: true, nsfw: game.nsfwEnabled }); setActionError('') }} title="导出 RPGBox 文件" disabled={working}><Download size={15} /><span>导出</span></button>
                <button className="danger" onClick={() => void deleteGame(game)} title="删除 RPG" disabled={working}><Trash2 size={15} /><span>删除</span></button>
              </div>
            </div>
          ))}
        </nav>
        <button className="drawer-settings-button" onClick={props.onOpenSettings}><Settings size={19} /><span>全局设置</span></button>
      </aside>
      {props.open && <button className="drawer-backdrop" onClick={props.onClose} aria-label="关闭RPG目录" />}
      {createOpen && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="新建RPG"><button className="backdrop" onClick={() => !working && setCreateOpen(false)} aria-label="取消新建" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">NEW RPG</span><h2>新建RPG</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content"><label>RPG 名称<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder={`留空使用“新RPG ${props.games.length + 1}”`} /></label><label className="nsfw-mode-toggle"><input type="checkbox" checked={createNsfwEnabled} onChange={(event) => setCreateNsfwEnabled(event.target.checked)} /><span><strong>启用 NSFW 模式</strong><small>新建 RPG 默认关闭，之后可以随时修改</small></span></label><label>导入 RPGBox 文件<div className="import-file-row"><select value={importFile} onChange={(event) => setImportFile(event.target.value)}><option value="">不导入，建立空白 RPG</option>{importFiles.map((file) => <option value={file} key={file}>{file}</option>)}</select><button className="secondary-button" onClick={() => void refreshImportFiles()} title="重新扫描目录"><RefreshCw size={15} /></button></div></label><p className="directory-note">请将 `.rpgbox` 文件放入 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>。导入列表只扫描此目录，不会读取其他位置。</p>{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>{importFiles.length} 个可导入文件</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmCreate()} disabled={working}>{working ? '处理中' : '确认新建'}</button></div></div></section></div>}
      {exportGame && <div className="modal-layer drawer-dialog-layer" role="dialog" aria-modal="true" aria-label="导出RPG"><button className="backdrop" onClick={() => !working && setExportGame(null)} aria-label="取消导出" /><section className="modal drawer-dialog"><div className="modal-head"><div><span className="eyebrow">EXPORT RPGBOX</span><h2>导出“{exportGame.title}”</h2></div><button className="icon-button" onClick={() => setExportGame(null)} disabled={working} title="关闭"><X size={19} /></button></div><div className="drawer-dialog-content export-option-list"><label><input type="checkbox" checked={exportOptions.settings} onChange={(event) => setExportOptions((current) => ({ ...current, settings: event.target.checked }))} /><span><strong>RPG 设置</strong><small>提示词、剧情记录、状态、章节与记忆，不包含AI配置</small></span></label><label><input type="checkbox" checked={exportOptions.characters} onChange={(event) => setExportOptions((current) => ({ ...current, characters: event.target.checked }))} /><span><strong>角色</strong><small>基础人物资料、颜色、状态栏及常规立绘资源</small></span></label>{exportGame.nsfwEnabled && <label><input type="checkbox" checked={exportOptions.nsfw} onChange={(event) => setExportOptions((current) => ({ ...current, nsfw: event.target.checked }))} /><span><strong><span className="nsfw-mark">❤</span> NSFW 内容</strong><small>偏好的NSFW场景与角色NSFW设定；同时导出角色时包含对应立绘分组</small></span></label>}<p className="directory-note">文件将保存到 <strong>{RPGBOX_DIRECTORY_LABEL}</strong>，扩展名为 `.rpgbox`。AI接口、密钥、模型及参数不会导出。</p>{actionError && <div className="inline-error">{actionError}</div>}</div><div className="modal-footer"><span>包内包含 rpg.xml 和所选立绘资源</span><div className="modal-footer-actions"><button className="secondary-button" onClick={() => setExportGame(null)} disabled={working}>取消</button><button className="primary-button" onClick={() => void confirmExport()} disabled={working || (!exportOptions.settings && !exportOptions.characters && !exportOptions.nsfw)}>{working ? '导出中' : '确认导出'}</button></div></div></section></div>}
    </>
  )
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
