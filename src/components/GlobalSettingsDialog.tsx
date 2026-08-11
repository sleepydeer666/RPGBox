import { Check, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_PROVIDER } from '../config'
import { fetchAvailableModels } from '../services/openai'
import type { ProviderProfile } from '../types'

interface Props {
  providers: ProviderProfile[]
  activeProviderId: string
  globalJailbreakPrompt: string
  onClose: () => void
  onChangeProviders: (providers: ProviderProfile[]) => void
  onChangeActive: (id: string) => void
  onChangeGlobalJailbreakPrompt: (value: string) => void
}

const newId = () => `provider-${Date.now()}-${Math.random().toString(16).slice(2)}`

export default function GlobalSettingsDialog(props: Props) {
  const active = props.providers.find((provider) => provider.id === props.activeProviderId) ?? props.providers[0]
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null)
  const [selectedRemoteModels, setSelectedRemoteModels] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')
  const [manualModel, setManualModel] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')
  const activeModels = active.models?.length ? active.models : active.model ? [active.model] : []
  const filteredRemoteModels = (remoteModels ?? []).filter((model) => model.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()))

  useEffect(() => {
    setRemoteModels(null)
    setSelectedRemoteModels([])
    setModelSearch('')
    setManualModel('')
    setModelError('')
  }, [active.id])

  function updateActive(patch: Partial<ProviderProfile>) {
    props.onChangeProviders(props.providers.map((provider) => provider.id === active.id ? { ...provider, ...patch } : provider))
  }

  function addProvider() {
    const provider = { ...DEFAULT_PROVIDER, models: [...DEFAULT_PROVIDER.models], id: newId(), name: `备用 API ${props.providers.length}` }
    props.onChangeProviders([...props.providers, provider])
    props.onChangeActive(provider.id)
  }

  function removeProvider() {
    if (props.providers.length === 1) return
    const remaining = props.providers.filter((provider) => provider.id !== active.id)
    props.onChangeProviders(remaining)
    props.onChangeActive(remaining[0].id)
  }

  async function loadRemoteModels() {
    setModelLoading(true)
    setModelError('')
    try {
      setRemoteModels(await fetchAvailableModels(active))
      setSelectedRemoteModels([])
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '获取模型失败')
      setRemoteModels(null)
    } finally {
      setModelLoading(false)
    }
  }

  function addModels(models: string[]) {
    const additions = models.map((model) => model.trim()).filter(Boolean)
    if (!additions.length) return
    const nextModels = Array.from(new Set([...activeModels, ...additions]))
    updateActive({ models: nextModels, model: active.model || nextModels[0] })
    setSelectedRemoteModels([])
  }

  function removeModel(model: string) {
    const nextModels = activeModels.filter((item) => item !== model)
    updateActive({ models: nextModels, model: active.model === model ? (nextModels[0] ?? '') : active.model })
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="backdrop" onClick={props.onClose} aria-label="关闭" />
      <section className="modal settings-modal">
        <div className="modal-head"><div><span className="eyebrow">GLOBAL</span><h2>全局设置</h2></div><button className="icon-button" onClick={props.onClose} title="关闭"><X size={20} /></button></div>
        <div className="settings-grid">
          <nav className="provider-nav">
            {props.providers.map((provider) => <button className={provider.id === active.id ? 'active' : ''} key={provider.id} onClick={() => props.onChangeActive(provider.id)}><span className={provider.apiKey ? 'status-dot online' : 'status-dot'} />{provider.name}</button>)}
            <button className="add-provider" onClick={addProvider}><Plus size={16} />添加 API</button>
          </nav>
          <div className="settings-content">
            <div className="form-section global-prompt-section">
              <h3>全局破限提示词</h3>
              <label>提示词<textarea value={props.globalJailbreakPrompt} onChange={(event) => props.onChangeGlobalJailbreakPrompt(event.target.value)} placeholder="对所有RPG生效的全局附加提示词" /></label>
            </div>
            <div className="form-section">
              <div className="form-section-head"><h3>API 配置</h3><button className="danger-icon" onClick={removeProvider} disabled={props.providers.length === 1} title="删除当前配置"><Trash2 size={17} /></button></div>
              <label>配置名称<input value={active.name} onChange={(event) => updateActive({ name: event.target.value })} /></label>
              <label>Base URL<input value={active.baseUrl} onChange={(event) => updateActive({ baseUrl: event.target.value })} autoCapitalize="none" /></label>
              <label>API Key<input type="password" value={active.apiKey} onChange={(event) => updateActive({ apiKey: event.target.value })} autoCapitalize="none" /></label>
            </div>
            <div className="form-section model-section">
              <div className="form-section-head"><div><h3>模型</h3><span className="section-meta">已添加 {activeModels.length} 个</span></div><button className="secondary-button" onClick={() => void loadRemoteModels()} disabled={modelLoading || !active.baseUrl.trim()}><RefreshCw className={modelLoading ? 'spin' : ''} size={15} />从接口获取</button></div>
              {activeModels.length > 0 ? <div className="added-model-list">{activeModels.map((model) => <div className={`added-model-row ${model === active.model ? 'active' : ''}`} key={model}><button className="model-select-button" onClick={() => updateActive({ model })}><span className="model-radio">{model === active.model && <Check size={13} />}</span><span>{model}</span></button><button className="model-remove-button" onClick={() => removeModel(model)} title={`删除 ${model}`}><X size={15} /></button></div>)}</div> : <p className="empty-models">尚未添加模型</p>}
              <div className="manual-model-row"><input value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModels([manualModel]); setManualModel('') } }} placeholder="手动输入模型 ID" autoCapitalize="none" /><button className="icon-button" onClick={() => { addModels([manualModel]); setManualModel('') }} disabled={!manualModel.trim()} title="添加模型"><Plus size={17} /></button></div>
              {modelError && <div className="inline-error">{modelError}</div>}
              {remoteModels && <div className="remote-model-picker"><div className="model-picker-head"><div className="model-search"><Search size={15} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索接口模型" /></div><button className="text-button" onClick={() => setSelectedRemoteModels(filteredRemoteModels.filter((model) => !activeModels.includes(model)))}>全选</button></div><div className="remote-model-list">{filteredRemoteModels.map((model) => { const added = activeModels.includes(model); return <label className={added ? 'remote-model-row added' : 'remote-model-row'} key={model}><input type="checkbox" checked={added || selectedRemoteModels.includes(model)} disabled={added} onChange={() => setSelectedRemoteModels((current) => current.includes(model) ? current.filter((item) => item !== model) : [...current, model])} /><span>{model}</span>{added && <small>已添加</small>}</label> })}</div><div className="model-picker-footer"><span>接口返回 {remoteModels.length} 个模型</span><button className="primary-button" onClick={() => addModels(selectedRemoteModels)} disabled={!selectedRemoteModels.length}>添加所选{selectedRemoteModels.length ? ` (${selectedRemoteModels.length})` : ''}</button></div></div>}
            </div>
          </div>
        </div>
        <div className="modal-footer"><span>这里只管理接口与可用模型</span><button className="primary-button" onClick={props.onClose}>完成</button></div>
      </section>
    </div>
  )
}
