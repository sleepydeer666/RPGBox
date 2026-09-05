import { Download, ImagePlus, SlidersHorizontal, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { applyChromaKey, imageDataLikeToImageData, rgbaToImageDataLike, type ChromaKeyResult, type ImageDataLike } from './lib/chromaKey'
import './chroma-key.css'

type ScreenChoice = 'auto' | 'green' | 'blue' | 'red' | 'manual'

async function fileToImageData(file: File): Promise<{ name: string; image: ImageDataLike; previewUrl: string }> {
  const previewUrl = URL.createObjectURL(file)
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建画布上下文')
  context.drawImage(bitmap, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { name: file.name, image: rgbaToImageDataLike(imageData), previewUrl }
}

function ChromaKeyApp() {
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<ImageDataLike | null>(null)
  const [result, setResult] = useState<ChromaKeyResult | null>(null)
  const [screen, setScreen] = useState<ScreenChoice>('auto')
  const [manualColor, setManualColor] = useState('#00ff00')
  const [cornerSize, setCornerSize] = useState(1)
  const [cornerThreshold, setCornerThreshold] = useState(20)
  const [tolerance, setTolerance] = useState(20)
  const [edgeGrayDistance, setEdgeGrayDistance] = useState(44)
  const [edgeGrayRadius, setEdgeGrayRadius] = useState(2)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)

  const screenColor = useMemo<[number, number, number] | undefined>(() => {
    if (screen !== 'manual') return undefined
    const text = manualColor.trim().replace(/^#/, '')
    if (text.length !== 6) return undefined
    return [
      Number.parseInt(text.slice(0, 2), 16),
      Number.parseInt(text.slice(2, 4), 16),
      Number.parseInt(text.slice(4, 6), 16),
    ]
  }, [manualColor, screen])
  const preferredScreen = screen === 'manual' ? 'auto' : screen

  useEffect(() => {
    if (!sourceImage) {
      setResult(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = applyChromaKey(sourceImage, {
        preferredScreen,
        screenColor,
        cornerSize,
        cornerThreshold,
        tolerance,
        edgeGrayDistance,
        edgeGrayRadius,
        gamma: 1.15,
        despill: 0.28,
      })
      setResult(next)
      const canvas = resultCanvasRef.current
      if (canvas) {
        canvas.width = next.width
        canvas.height = next.height
        const context = canvas.getContext('2d')
        if (context) context.putImageData(imageDataLikeToImageData(next), 0, 0)
      }
    } catch (caught) {
      setResult(null)
      setError(caught instanceof Error ? caught.message : '处理失败')
    } finally {
      setBusy(false)
    }
  }, [cornerSize, cornerThreshold, edgeGrayDistance, edgeGrayRadius, manualColor, preferredScreen, resultCanvasRef, screenColor, sourceImage, tolerance])

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    try {
      const loaded = await fileToImageData(file)
      setSourceName(loaded.name)
      setSourceUrl(loaded.previewUrl)
      setSourceImage(loaded.image)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取图片失败')
      setSourceImage(null)
      setResult(null)
    }
  }

  async function downloadResult() {
    const canvas = resultCanvasRef.current
    if (!canvas) return
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = sourceName ? sourceName.replace(/\.[^.]+$/, '') + '_transparent.png' : 'chroma_key.png'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  }, [sourceUrl])

  return (
    <div className="chroma-key-app">
      <header className="chroma-key-head">
        <div>
          <p className="chroma-key-kicker">CHROMA KEY LAB</p>
          <h1>透明化抠图</h1>
        </div>
        <p className="chroma-key-subtitle">四角采样 + 容差抠图。适合 SDXL 这类带绿色偏色背景的立绘。</p>
      </header>

      <main className="chroma-key-shell">
        <section className="control-panel">
          <label className="file-picker">
            <Upload size={16} />
            <span>{sourceName || '导入图片'}</span>
            <input type="file" accept="image/*" onChange={onPickFile} />
          </label>

          <div className="control-group">
            <div className="control-label"><SlidersHorizontal size={16} />背景模式</div>
            <div className="segmented-control">
              {(['auto', 'green', 'blue', 'red', 'manual'] as const).map((item) => (
                <button type="button" className={screen === item ? 'active' : ''} key={item} onClick={() => setScreen(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          {screen === 'manual' && (
            <div className="control-group">
              <label className="control-label" htmlFor="manual-color">手动颜色</label>
              <input id="manual-color" type="color" value={manualColor} onChange={(event) => setManualColor(event.target.value)} />
            </div>
          )}

          <div className="control-group">
            <label className="control-label" htmlFor="corner-size">角点采样</label>
            <input id="corner-size" type="range" min={1} max={16} value={cornerSize} onChange={(event) => setCornerSize(Number(event.target.value))} />
            <div className="control-value">{cornerSize}px</div>
          </div>

          <div className="control-group">
            <label className="control-label" htmlFor="corner-threshold">角点容差</label>
            <input id="corner-threshold" type="range" min={0} max={60} value={cornerThreshold} onChange={(event) => setCornerThreshold(Number(event.target.value))} />
            <div className="control-value">{cornerThreshold}</div>
          </div>

          <div className="control-group">
            <label className="control-label" htmlFor="tolerance">抠图容差</label>
            <input id="tolerance" type="range" min={0} max={200} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} />
            <div className="control-value">{tolerance}</div>
          </div>

          <div className="control-group">
            <label className="control-label" htmlFor="edge-gray-distance">边缘灰化</label>
            <input
              id="edge-gray-distance"
              type="range"
              min={Math.max(1, tolerance + 1)}
              max={180}
              value={Math.max(edgeGrayDistance, tolerance + 1)}
              onChange={(event) => setEdgeGrayDistance(Number(event.target.value))}
            />
            <div className="control-value">{Math.max(edgeGrayDistance, tolerance + 1)}</div>
          </div>

          <div className="control-group">
            <label className="control-label" htmlFor="edge-gray-radius">灰化半径</label>
            <input
              id="edge-gray-radius"
              type="range"
              min={0}
              max={8}
              value={edgeGrayRadius}
              onChange={(event) => setEdgeGrayRadius(Number(event.target.value))}
            />
            <div className="control-value">{edgeGrayRadius}px</div>
          </div>

          <button type="button" className="download-button" onClick={downloadResult} disabled={!result || busy}>
            <Download size={16} />
            导出 PNG
          </button>

          {error && <p className="error-text">{error}</p>}
          {result && (
            <dl className="result-meta">
              <div><dt>识别方式</dt><dd>{result.method}</dd></div>
              <div><dt>背景色</dt><dd>#{result.keyColor.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}</dd></div>
              <div><dt>透明像素</dt><dd>{result.transparentPixels}</dd></div>
            </dl>
          )}
        </section>

        <section className="preview-panel">
          <div className="preview-block">
            <div className="preview-title">原图</div>
            <div className="preview-frame">
              {sourceUrl ? <img src={sourceUrl} alt="原图预览" /> : <div className="preview-placeholder"><ImagePlus size={28} /><span>等待导入</span></div>}
            </div>
          </div>
          <div className="preview-block">
            <div className="preview-title">抠图结果</div>
            <div className="preview-frame checkerboard">
              {busy && <div className="preview-placeholder"><span>处理中…</span></div>}
              <canvas ref={resultCanvasRef} />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default ChromaKeyApp
