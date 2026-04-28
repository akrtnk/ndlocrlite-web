import { useState, useCallback, useRef } from 'react'
import * as Diff from 'diff'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { ImageViewer } from './components/viewer/ImageViewer'
import { imageDataToDataUrl } from './utils/imageLoader'
import type { ProcessedImage } from './types/ocr'
import './DiffApp.css'

// -----------------------------------------------
// diff ロジック
// -----------------------------------------------
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
// 内容一致チェック ロジック
// -----------------------------------------------
interface MatchResult {
  matched: string[]
  unmatched: string[]
  matchRate: number
}

function checkContainment(beforeText: string, afterText: string): MatchResult {
  // 句点で文に分割・空文字除去・正規化
  const normalize = (s: string) => s.replace(/\s+/g, '').replace(/　/g, '')
  const sentences = beforeText
    .split(/[。！？\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 2)

  const normalizedAfter = normalize(afterText)

  const matched: string[] = []
  const unmatched: string[] = []

  sentences.forEach(sentence => {
    const normalizedSentence = normalize(sentence)
    if (normalizedAfter.includes(normalizedSentence)) {
      matched.push(sentence)
    } else {
      unmatched.push(sentence)
    }
  })

  const matchRate = sentences.length > 0
    ? Math.round((matched.length / sentences.length) * 100)
    : 0

  return { matched, unmatched, matchRate }
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
  processImage: (image: ProcessedImage, fileIndex: number, totalFiles: number) => Promise<{ fullText: string }>
  processFiles: (files: File[]) => Promise<void>
  processedImages: ProcessedImage[]
}

function OcrPanel({ title, panel, onPanelChange, processRegion, processImage, processFiles, processedImages }: OcrPanelProps) {
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

  const handlePasteZone = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        setPageIndex(0)
        onPanelChange({ ...emptyPanel(), fileName: 'クリップボード', isOcrLoading: false })
        await processFiles(files)
      }
    }, [processFiles, onPanelChange])

  const handleFullOcr = useCallback(async () => {
    if (!processedImages[pageIndex]) return
    onPanelChange({ ...panel, isOcrLoading: true, ocrText: '', cropDataUrl: '' })
    try {
      const result = await processImage(processedImages[pageIndex], 0, 1)
      onPanelChange({ ...panel, isOcrLoading: false, ocrText: result.fullText, cropDataUrl: '' })
    } catch {
      onPanelChange({ ...panel, isOcrLoading: false, ocrText: '' })
    }
  }, [processedImages, pageIndex, panel, onPanelChange, processImage])

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

      {/* ファイル選択・クリップボード */}
            <div
              className="diff-paste-zone"
              onPaste={handlePasteZone}
              tabIndex={0}
            >
              <p className="diff-paste-hint">このエリアを選択して、Cmd+Vで貼り付け、またはボタンから選択</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="diff-file-btn" onClick={() => fileInputRef.current?.click()}>
                  ファイルを選択
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
            <span className="diff-file-name">
              {panel.fileName || 'ファイル未選択'}
            </span>

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
          <button
            className="diff-file-btn"
            style={{ width: '100%', marginBottom: 4, background: '#28a745' }}
            onClick={handleFullOcr}
            disabled={panel.isOcrLoading}
          >
            全体をOCR
          </button>
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
type ResultMode = 'diff' | 'containment' | null

export default function DiffApp({ onBack }: { onBack: () => void }) {
  const workerBefore = useOCRWorker()
  const workerAfter = useOCRWorker()
  const fileProcBefore = useFileProcessor()
  const fileProcAfter = useFileProcessor()

  const [panelBefore, setPanelBefore] = useState<PanelState>(emptyPanel())
  const [panelAfter, setPanelAfter] = useState<PanelState>(emptyPanel())
  const [resultMode, setResultMode] = useState<ResultMode>(null)
  const [diffHtml, setDiffHtml] = useState<string | null>(null)
  const [noDiff, setNoDiff] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)

  const handleCompare = () => {
    const t1 = panelBefore.ocrText
    const t2 = panelAfter.ocrText
    if (!t1 && !t2) return
    setMatchResult(null)
    if (t1 === t2) {
      setNoDiff(true)
      setDiffHtml(null)
      setResultMode('diff')
      return
    }
    setNoDiff(false)
    setDiffHtml(buildDiffTable(t1, t2))
    setResultMode('diff')
  }

  const handleContainment = () => {
    const t1 = panelBefore.ocrText
    const t2 = panelAfter.ocrText
    if (!t1 || !t2) return
    setDiffHtml(null)
    setNoDiff(false)
    setMatchResult(checkContainment(t1, t2))
    setResultMode('containment')
  }

  const canCompare = !!panelBefore.ocrText || !!panelAfter.ocrText
  const canContainment = !!panelBefore.ocrText && !!panelAfter.ocrText

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
            processImage={workerBefore.processImage}
            processFiles={fileProcBefore.processFiles}
            processedImages={fileProcBefore.processedImages}
          />
          <OcrPanel
            title="変更後"
            panel={panelAfter}
            onPanelChange={setPanelAfter}
            processRegion={workerAfter.processRegion}
            processImage={workerAfter.processImage}
            processFiles={fileProcAfter.processFiles}
            processedImages={fileProcAfter.processedImages}
          />
        </div>

        {/* ボタンエリア */}
        <div className="diff-compare-area">
          <button
            className="diff-compare-btn"
            onClick={handleCompare}
            disabled={!canCompare}
          >
            テキストを比較する
          </button>
          <button
            className="diff-compare-btn"
            style={{ background: '#28a745' }}
            onClick={handleContainment}
            disabled={!canContainment}
          >
            内容一致を確認する
          </button>
        </div>

        {/* diff結果 */}
        {resultMode === 'diff' && noDiff && (
          <div className="diff-result">
            <p className="diff-no-diff">✅ 差分はありません（テキストは同一です）</p>
          </div>
        )}
        {resultMode === 'diff' && diffHtml && (
          <div className="diff-result">
            <h3>比較結果</h3>
            <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
          </div>
        )}

        {/* 内容一致結果 */}
        {resultMode === 'containment' && matchResult && (
          <div className="diff-result">
            <h3>内容一致確認結果</h3>
            <div className="match-rate-bar-wrap">
              <div className="match-rate-label">
                変更前テキストの一致率：<strong>{matchResult.matchRate}%</strong>
                （{matchResult.matched.length}件一致 / 全{matchResult.matched.length + matchResult.unmatched.length}文）
              </div>
              <div className="match-rate-bar">
                <div
                  className="match-rate-fill"
                  style={{ width: `${matchResult.matchRate}%` }}
                />
              </div>
            </div>

            {matchResult.unmatched.length > 0 && (
              <div className="match-section">
                <h4 className="match-section-title unmatched-title">
                  ❌ 変更後に見当たらない内容（{matchResult.unmatched.length}件）
                </h4>
                <ul className="match-list">
                  {matchResult.unmatched.map((s, i) => (
                    <li key={i} className="match-item unmatched">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {matchResult.matched.length > 0 && (
              <div className="match-section">
                <h4 className="match-section-title matched-title">
                  ✅ 一致している内容（{matchResult.matched.length}件）
                </h4>
                <ul className="match-list">
                  {matchResult.matched.map((s, i) => (
                    <li key={i} className="match-item matched">{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}