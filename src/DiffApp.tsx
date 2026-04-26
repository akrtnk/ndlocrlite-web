import { useState, useCallback, useRef } from 'react'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { ImageViewer } from './components/viewer/ImageViewer'
import { imageDataToDataUrl } from './utils/imageLoader'
import './DiffApp.css'
import type { ProcessedImage } from './types/ocr'

// -----------------------------------------------
// diff ロジック（diff-tool.html から移植）
// -----------------------------------------------
import * as Diff from 'diff'

interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function generateCharDiffHtml(oldLine: string, newLine: string) {
  const parts: DiffPart[] = Diff.diffChars(oldLine, newLine)
  let left = ''
  let right = ''
  parts.forEach((p) => {
    const v = escapeHtml(p.value)
    if (p.removed) left += `<span class="char-del">${v}</span>`
    else if (p.added) right += `<span class="char-add">${v}</span>`
    else { left += v; right += v }
  })
  return { left, right }
}

function buildDiffTable(text1: string, text2: string): string {
  const diff: DiffPart[] = Diff.diffLines(text1, text2)
  let html = `
    <table class="diff-table">
      <colgroup>
        <col style="width:40px"><col>
        <col style="width:40px"><col>
      </colgroup>
      <thead><tr><th colspan="2">変更前</th><th colspan="2">変更後</th></tr></thead>
      <tbody>`

  let oldN = 1, newN = 1

  for (let i = 0; i < diff.length; i++) {
    const part = diff[i]
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()

    if (!part.added && !part.removed) {
      lines.forEach((line) => {
        const e = escapeHtml(line)
        html += `<tr>
          <td class="line-num">${oldN}</td><td class="code-cell">${e}</td>
          <td class="line-num">${newN}</td><td class="code-cell">${e}</td>
        </tr>`
        oldN++; newN++
      })
    } else if (part.removed && i + 1 < diff.length && diff[i + 1].added) {
      const next = diff[i + 1]
      const oldLines = lines
      const newLines = next.value.split('\n')
      if (newLines[newLines.length - 1] === '') newLines.pop()
      const count = Math.max(oldLines.length, newLines.length)
      for (let j = 0; j < count; j++) {
        const o = oldLines[j], n = newLines[j]
        if (o !== undefined && n !== undefined) {
          const { left, right } = generateCharDiffHtml(o, n)
          html += `<tr>
            <td class="line-num">${oldN}</td><td class="code-cell bg-removed">${left}</td>
            <td class="line-num">${newN}</td><td class="code-cell bg-added">${right}</td>
          </tr>`
          oldN++; newN++
        } else if (o !== undefined) {
          html += `<tr>
            <td class="line-num">${oldN}</td><td class="code-cell bg-removed">${escapeHtml(o)}</td>
            <td class="line-num"></td><td class="code-cell bg-empty"></td>
          </tr>`
          oldN++
        } else if (n !== undefined) {
          html += `<tr>
            <td class="line-num"></td><td class="code-cell bg-empty"></td>
            <td class="line-num">${newN}</td><td class="code-cell bg-added">${escapeHtml(n)}</td>
          </tr>`
          newN++
        }
      }
      i++
    } else if (part.removed) {
      lines.forEach((line) => {
        html += `<tr>
          <td class="line-num">${oldN}</td><td class="code-cell bg-removed">${escapeHtml(line)}</td>
          <td class="line-num"></td><td class="code-cell bg-empty"></td>
        </tr>`
        oldN++
      })
    } else if (part.added) {
      lines.forEach((line) => {
        html += `<tr>
          <td class="line-num"></td><td class="code-cell bg-empty"></td>
          <td class="line-num">${newN}</td><td class="code-cell bg-added">${escapeHtml(line)}</td>
        </tr>`
        newN++
      })
    }
  }
  html += '</tbody></table>'
  return html
}

// -----------------------------------------------
// 1ペイン分のコンポーネント
// -----------------------------------------------
interface PanelState {
  fileName: string
  imageDataUrl: string
  cropDataUrl: string
  ocrText: string
  isOcrLoading: boolean
}

const emptyPanel = (): PanelState => ({
  fileName: '',
  imageDataUrl: '',
  cropDataUrl: '',
  ocrText: '',
  isOcrLoading: false,
})

function cropRegion(srcDataUrl: string, bbox: { x: number; y: number; width: number; height: number }) {
  return new Promise<{ previewDataUrl: string; imageData: ImageData }>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.max(32, Math.round(bbox.width))
      const h = Math.max(32, Math.round(bbox.height))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, w, h)
      resolve({
        previewDataUrl: canvas.toDataURL('image/jpeg', 0.9),
        imageData: ctx.getImageData(0, 0, w, h),
      })
    }
    img.src = srcDataUrl
  })
}

interface OcrPanelProps {
  title: string
  panel: PanelState
  onPanelChange: (p: PanelState) => void
  processRegion: (imageData: ImageData) => Promise<{ fullText: string }>
  processFiles: (files: File[]) => Promise<void>
  processedImages: ProcessedImage[]
}

function OcrPanel({ title, panel, onPanelChange, processRegion, processFiles, processedImages }: OcrPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pageIndex, setPageIndex] = useState(0)

  const processedImageDataUrl = processedImages.length > 0
    ? imageDataToDataUrl(processedImages[pageIndex]?.imageData ?? processedImages[0].imageData)
    : ''

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setPageIndex(0)
    onPanelChange({ ...emptyPanel(), fileName: files[0].name, isOcrLoading: false })
    await processFiles(files)
  }

  const handleRegionSelect = useCallback(async (_blocks: unknown, bbox: { x: number; y: number; width: number; height: number }) => {
    if (!processedImageDataUrl) return
    const { previewDataUrl, imageData } = await cropRegion(processedImageDataUrl, bbox)
    onPanelChange({ ...panel, cropDataUrl: previewDataUrl, isOcrLoading: true, ocrText: '' })
    try {
      const result = await processRegion(imageData)
      onPanelChange({ ...panel, cropDataUrl: previewDataUrl, isOcrLoading: false, ocrText: result.fullText })
    } catch {
      onPanelChange({ ...panel, cropDataUrl: previewDataUrl, isOcrLoading: false, ocrText: '' })
    }
  }, [processedImageDataUrl, panel, onPanelChange, processRegion])

  return (
    <div className="diff-panel">
      <h2>{title}</h2>

      {/* ファイル選択 */}
      <div className="diff-file-area">
        <button className="diff-file-btn" onClick={() => fileInputRef.current?.click()}>
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <span className="diff-file-name">
          {panel.fileName || 'ファイル未選択'}
        </span>
      </div>

      {/* ページ選択 */}
      {processedImages.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, color: '#555' }}>ページ：</label>
          <select
            value={pageIndex}
            onChange={(e) => {
              setPageIndex(Number(e.target.value))
              onPanelChange({ ...panel, cropDataUrl: '', ocrText: '' })
            }}
            style={{ fontSize: 13, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc' }}
          >
            {processedImages.map((img, i) => (
              <option key={i} value={i}>
                {img.pageIndex ? `p.${img.pageIndex}` : `${i + 1}ページ`}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: '#888' }}>{processedImages.length}ページ中</span>
        </div>
      )}
      
      {/* 画像ビューワー */}
      {processedImageDataUrl && (
        <div className="diff-viewer-wrap">
          <ImageViewer
            imageDataUrl={processedImageDataUrl}
            textBlocks={[]}
            selectedBlock={null}
            onBlockSelect={() => {}}
            onRegionSelect={handleRegionSelect}
          />
          <p style={{ fontSize: 12, color: '#888', textAlign: 'center', margin: '4px 0 0' }}>
            マウスでOCRしたい範囲をドラッグしてください
          </p>
        </div>
      )}

      {/* 切り抜き画像プレビュー */}
      {panel.cropDataUrl && (
        <div className="diff-crop-preview">
          <img src={panel.cropDataUrl} alt="選択領域" />
        </div>
      )}

      {/* OCRテキスト */}
      {panel.isOcrLoading ? (
        <div className="diff-ocr-loading">
          <span className="spinner" /> 認識中...
        </div>
      ) : (
        <textarea
          className="diff-ocr-text"
          value={panel.ocrText}
          onChange={(e) => onPanelChange({ ...panel, ocrText: e.target.value })}
          placeholder="OCRテキストがここに表示されます（手動編集も可能）"
        />
      )}
    </div>
  )
}

// -----------------------------------------------
// メインコンポーネント
// -----------------------------------------------
export default function DiffApp({ onBack }: { onBack: () => void }) {
  const workerBefore = useOCRWorker()
  const workerAfter = useOCRWorker()
  const fileProcBefore = useFileProcessor()
  const fileProcAfter = useFileProcessor()

  const [panelBefore, setPanelBefore] = useState<PanelState>(emptyPanel())
  const [panelAfter, setPanelAfter] = useState<PanelState>(emptyPanel())
  const [diffHtml, setDiffHtml] = useState<string | null>(null)
  const [noDiff, setNoDiff] = useState(false)

  const handleCompare = () => {
    const t1 = panelBefore.ocrText
    const t2 = panelAfter.ocrText
    if (!t1 && !t2) return
    if (t1 === t2) {
      setNoDiff(true)
      setDiffHtml(null)
      return
    }
    setNoDiff(false)
    setDiffHtml(buildDiffTable(t1, t2))
  }

  const canCompare = !!panelBefore.ocrText || !!panelAfter.ocrText

  return (
    <div className="diff-app">
      <header className="diff-app-header">
        <button className="diff-back-btn" onClick={onBack}>← 戻る</button>
        <h1>OCR テキスト比較ツール</h1>
      </header>

      <main className="diff-main">
        <div className="diff-panels">
          <OcrPanel
            title="変更前"
            panel={panelBefore}
            onPanelChange={setPanelBefore}
            processRegion={workerBefore.processRegion}
            processFiles={fileProcBefore.processFiles}
            processedImages={fileProcBefore.processedImages}
          />
          <OcrPanel
            title="変更後"
            panel={panelAfter}
            onPanelChange={setPanelAfter}
            processRegion={workerAfter.processRegion}
            processFiles={fileProcAfter.processFiles}
            processedImages={fileProcAfter.processedImages}
          />
        </div>

        <div className="diff-compare-area">
          <button
            className="diff-compare-btn"
            onClick={handleCompare}
            disabled={!canCompare}
          >
            テキストを比較する
          </button>
        </div>

        {noDiff && (
          <div className="diff-result">
            <p className="diff-no-diff">✅ 差分はありません（テキストは同一です）</p>
          </div>
        )}

        {diffHtml && (
          <div className="diff-result">
            <h3>比較結果</h3>
            <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
          </div>
        )}
      </main>
    </div>
  )
}