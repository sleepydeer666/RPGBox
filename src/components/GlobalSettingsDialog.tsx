import { Check, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_PROVIDER } from '../config'
import { loadBundledDefaultPrompt } from '../lib/defaultPrompt'
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
  const [draftProviders, setDraftProviders] = useState(() => props.providers.map((provider) => ({ ...provider, models: [...provider.models] })))
  const [draftActiveProviderId, setDraftActiveProviderId] = useState(props.activeProviderId)
  const [draftGlobalJailbreakPrompt, setDraftGlobalJailbreakPrompt] = useState(props.globalJailbreakPrompt)
  const active = draftProviders.find((provider) => provider.id === draftActiveProviderId) ?? draftProviders[0]
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [manualModel, setManualModel] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')
  const [defaultPromptLoading, setDefaultPromptLoading] = useState(false)
  const [defaultPromptError, setDefaultPromptError] = useState('')
  const activeModels = active.models?.length ? active.models : active.model ? [active.model] : []
  const filteredRemoteModels = (remoteModels ?? []).filter((model) => model.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()))
  const allFilteredModelsAdded = filteredRemoteModels.length > 0 && filteredRemoteModels.every((model) => activeModels.includes(model))

  useEffect(() => {
    setRemoteModels(null)
    setModelSearch('')
    setManualModel('')
    setModelError('')
  }, [active.id])

  function updateActive(patch: Partial<ProviderProfile>) {
    setDraftProviders((providers) => providers.map((provider) => provider.id === active.id ? { ...provider, ...patch } : provider))
  }

  function addProvider() {
    const provider = { ...DEFAULT_PROVIDER, models: [...DEFAULT_PROVIDER.models], id: newId(), name: `备用 API ${draftProviders.length}` }
    setDraftProviders((providers) => [...providers, provider])
    setDraftActiveProviderId(provider.id)
  }

  function removeProvider() {
    if (draftProviders.length === 1) return
    const remaining = draftProviders.filter((provider) => provider.id !== active.id)
    setDraftProviders(remaining)
    setDraftActiveProviderId(remaining[0].id)
  }

  function finish() {
    props.onChangeProviders(draftProviders)
    props.onChangeActive(draftActiveProviderId)
    props.onChangeGlobalJailbreakPrompt(draftGlobalJailbreakPrompt)
    props.onClose()
  }

  async function loadRemoteModels() {
    setModelLoading(true)
    setModelError('')
    try {
      setRemoteModels(await fetchAvailableModels(active))
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
  }

  function removeModel(model: string) {
    const nextModels = activeModels.filter((item) => item !== model)
    updateActive({ models: nextModels, model: active.model === model ? (nextModels[0] ?? '') : active.model })
  }

  function toggleRemoteModel(model: string) {
    if (activeModels.includes(model)) removeModel(model)
    else addModels([model])
  }

  function toggleFilteredRemoteModels() {
    if (allFilteredModelsAdded) {
      const filtered = new Set(filteredRemoteModels)
      const nextModels = activeModels.filter((model) => !filtered.has(model))
      updateActive({ models: nextModels, model: filtered.has(active.model) ? (nextModels[0] ?? '') : active.model })
    } else {
      addModels(filteredRemoteModels)
    }
  }

  async function useDefaultPrompt() {
    if (draftGlobalJailbreakPrompt.trim() && !window.confirm('这将删除现有提示词，是否继续？')) return
    setDefaultPromptLoading(true)
    setDefaultPromptError('')
    try {
      const prompt = await loadBundledDefaultPrompt()
      if (!prompt) {
        setDefaultPromptError('无法读取默认提示词')
        return
      }
      setDraftGlobalJailbreakPrompt(prompt)
    } finally {
      setDefaultPromptLoading(false)
    }
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="backdrop" onClick={finish} aria-label="关闭" />
      <section className="modal settings-modal">
        <div className="modal-head"><div><span className="eyebrow">AI</span><h2>AI配置</h2></div><button className="icon-button" onClick={finish} title="关闭"><X size={20} /></button></div>
        <div className="settings-grid">
          <nav className="provider-nav">
            {draftProviders.map((provider) => <button className={provider.id === active.id ? 'active' : ''} key={provider.id} onClick={() => setDraftActiveProviderId(provider.id)}><span className={provider.apiKey ? 'status-dot online' : 'status-dot'} />{provider.name}</button>)}
            <button className="add-provider" onClick={addProvider}><Plus size={16} />添加 API</button>
          </nav>
          <div className="settings-content">
            <div className="form-section global-prompt-section">
              <div className="form-section-head"><h3>全局破限提示词</h3><button type="button" className="secondary-button compact" onClick={() => void useDefaultPrompt()} disabled={defaultPromptLoading}><RotateCcw size={14} />{defaultPromptLoading ? '读取中' : '使用默认设置'}</button></div>
              <label>提示词<textarea value={draftGlobalJailbreakPrompt} onChange={(event) => setDraftGlobalJailbreakPrompt(event.target.value)} placeholder="对所有RPG生效的全局附加提示词" /></label>
              {defaultPromptError && <div className="inline-error">{defaultPromptError}</div>}
            </div>
            <div className="form-section">
              <div className="form-section-head"><h3>API 配置</h3><button className="danger-icon" onClick={removeProvider} disabled={draftProviders.length === 1} title="删除当前配置"><Trash2 size={17} /></button></div>
              <label>配置名称<input value={active.name} onChange={(event) => updateActive({ name: event.target.value })} /></label>
              <label>Base URL<input value={active.baseUrl} onChange={(event) => updateActive({ baseUrl: event.target.value })} autoCapitalize="none" placeholder="请输入大语言模型API的URL地址" /></label>
              <label>API Key<input type="password" value={active.apiKey} onChange={(event) => updateActive({ apiKey: event.target.value })} autoCapitalize="none" /></label>
            </div>
            <div className="form-section model-section">
              <div className="form-section-head"><div><h3>模型</h3><span className="section-meta">已添加 {activeModels.length} 个</span></div><button className="secondary-button" onClick={() => void loadRemoteModels()} disabled={modelLoading || !active.baseUrl.trim()}><RefreshCw className={modelLoading ? 'spin' : ''} size={15} />从接口获取</button></div>
              {!active.model.trim() && <p className="model-required-warning">尚未指定默认模型</p>}
              {activeModels.length > 0 ? <div className="added-model-list">{activeModels.map((model) => <div className={`added-model-row ${model === active.model ? 'active' : ''}`} key={model}><button className="model-select-button" onClick={() => updateActive({ model })}><span className="model-radio">{model === active.model && <Check size={13} />}</span><span>{model}</span></button><button className="model-remove-button" onClick={() => removeModel(model)} title={`删除 ${model}`}><X size={15} /></button></div>)}</div> : <p className="empty-models">尚未添加模型</p>}
              <div className="manual-model-row"><input value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModels([manualModel]); setManualModel('') } }} placeholder="手动输入模型 ID" autoCapitalize="none" /><button className="icon-button" onClick={() => { addModels([manualModel]); setManualModel('') }} disabled={!manualModel.trim()} title="添加模型"><Plus size={17} /></button></div>
              {modelError && <div className="inline-error">{modelError}</div>}
              {remoteModels && <div className="remote-model-picker"><div className="model-picker-head"><div className="model-search"><Search size={15} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索接口模型" /></div><button className="text-button" onClick={toggleFilteredRemoteModels} disabled={!filteredRemoteModels.length}>{allFilteredModelsAdded ? '取消全选' : '全选'}</button></div><div className="remote-model-list">{filteredRemoteModels.map((model) => { const added = activeModels.includes(model); return <label className={added ? 'remote-model-row added' : 'remote-model-row'} key={model}><input type="checkbox" checked={added} onChange={() => toggleRemoteModel(model)} /><span>{model}</span>{added && <small>已添加</small>}</label> })}</div><div className="model-picker-footer"><span>接口返回 {remoteModels.length} 个模型，勾选后立即添加</span></div></div>}
            </div>
          </div>
        </div>
        <div className="modal-footer"><span>这里只管理接口与可用模型</span><button className="primary-button" onClick={finish}>完成</button></div>
      </section>
    </div>
  )
}
