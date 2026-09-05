import { Check, Crop, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  file: File
  onCancel: () => void
  onConfirm: (file: File) => Promise<void>
}

interface Size {
  width: number
  height: number
}

export default function PortraitCropDialog({ file, onCancel, onConfirm }: Props) {
  const sourceUrl = useMemo(() => URL.createObjectURL(file), [file])
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [naturalSize, setNaturalSize] = useState<Size>({ width: 0, height: 0 })
  const [frameSize, setFrameSize] = useState<Size>({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)

  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl])

  useEffect(() => {
    if (!frameRef.current) return
    const observer = new ResizeObserver(([entry]) => setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [])

  const layout = getImageLayout(naturalSize, frameSize, zoom)
  const safeOffset = clampOffset(offset, layout, frameSize)

  function updateOffset(next: { x: number; y: number }) {
    setOffset(clampOffset(next, layout, frameSize))
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const next = { x: safeOffset.x + event.clientX - dragRef.current.x, y: safeOffset.y + event.clientY - dragRef.current.y }
    dragRef.current = { x: event.clientX, y: event.clientY }
    updateOffset(next)
  }

  async function confirmCrop() {
    const image = imageRef.current
    if (!image || !naturalSize.width || !frameSize.width || saving) return
    setSaving(true)
    try {
      const scale = layout.width / naturalSize.width
      const imageLeft = (frameSize.width - layout.width) / 2 + safeOffset.x
      const imageTop = (frameSize.height - layout.height) / 2 + safeOffset.y
      const sourceX = -imageLeft / scale
      const sourceY = -imageTop / scale
      const sourceWidth = frameSize.width / scale
      const sourceHeight = frameSize.height / scale
      const outputSize = getPortraitOutputSize(sourceWidth, sourceHeight)
      const canvas = document.createElement('canvas')
      canvas.width = outputSize.width
      canvas.height = outputSize.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建图片裁剪画布')
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('立绘裁剪失败')), 'image/png'))
      await onConfirm(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-portrait.png`, { type: 'image/png' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="crop-layer" role="dialog" aria-modal="true" aria-label="裁剪立绘">
      <button className="backdrop" onClick={onCancel} aria-label="取消裁剪" />
      <section className="modal crop-modal">
        <div className="modal-head"><div><span className="eyebrow">PORTRAIT CROP</span><h2>裁剪立绘</h2></div><button className="icon-button" onClick={onCancel} title="取消"><X size={20} /></button></div>
        <div className="crop-content">
          <div className="crop-frame" ref={frameRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
            <img
              ref={imageRef}
              src={sourceUrl}
              alt="待裁剪立绘"
              draggable={false}
              onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              style={{ width: layout.width, height: layout.height, transform: `translate(calc(-50% + ${safeOffset.x}px), calc(-50% + ${safeOffset.y}px))` }}
            />
            <div className="crop-grid" />
          </div>
          <div className="crop-controls">
            <Crop size={17} />
            <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(event) => { const nextZoom = Number(event.target.value); setZoom(nextZoom); setOffset((current) => clampOffset(current, getImageLayout(naturalSize, frameSize, nextZoom), frameSize)) }} aria-label="缩放图片" />
            <button className="icon-button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }} title="重置取景"><RotateCcw size={17} /></button>
          </div>
        </div>
        <div className="modal-footer"><span>拖动图片调整取景 · 最大输出 800×1200 PNG</span><div className="modal-footer-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" onClick={() => void confirmCrop()} disabled={!naturalSize.width || saving}><Check size={16} />{saving ? '保存中' : '确认裁剪'}</button></div></div>
      </section>
    </div>
  )
}

export function getImageLayout(image: Size, frame: Size, zoom: number): Size {
  if (!image.width || !frame.width) return { width: 0, height: 0 }
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * zoom
  return { width: image.width * scale, height: image.height * scale }
}

export function clampOffset(offset: { x: number; y: number }, image: Size, frame: Size) {
  const maxX = Math.max(0, (image.width - frame.width) / 2)
  const maxY = Math.max(0, (image.height - frame.height) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)) || 0,
    y: Math.max(-maxY, Math.min(maxY, offset.y)) || 0,
  }
}

export function getPortraitOutputSize(width: number, height: number): Size {
  if (!width || !height) return { width: 0, height: 0 }
  const scale = Math.min(1, 800 / width, 1200 / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
