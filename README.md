# NDLOCR-Lite Web

**ブラウザで動く日本語OCRツール**

本ツールは、国立国会図書館（NDL）が開発・公開している **[NDLOCR-Lite](https://github.com/ndl-lab/ndlocr-lite)**（NDL Lab）を元にして、WebブラウザのみでOCR処理が完結するよう移植・再実装したものです。レイアウト検出モデル（DEIMv2）は NDLOCR-Lite のものを利用しており、文字認識モデル（PARSeq）は独自に再学習した改良版（入力高さ 24px、tegaki3データ追加）を使用しています。

**サイト**: https://ndlocr-liteweb.netlify.app/
**元リポジトリ**: https://github.com/ndl-lab/ndlocr-lite（国立国会図書館）

## 特徴

- **ブラウザ完結** — 画像・OCR結果を外部サーバーに送信しません。すべての処理がブラウザ内で完結します。
- **高精度レイアウト認識** — DEIMv2 モデルによりテキスト行の矩形領域を自動検出します。
- **カスケード文字認識** — 行の文字数に応じて3種類の PARSeq モデルを使い分け、精度を最適化します。
- **PDF対応** — 複数ページのPDFを一括処理できます。
- **バッチ処理** — 複数の画像ファイルやフォルダをまとめて処理できます。
- **結果のキャッシュ** — IndexedDB にモデルと処理結果（最新100件）を保存し、再利用できます。
- **領域選択** — マウスドラッグで任意の矩形領域を選択し、テキストを確認できます。
- **日英対応** — 日本語・英語のUI切替ができます。

## 使い方

1. **https://ndlocr-liteweb.netlify.app/** をブラウザで開く
2. 初回起動時にONNXモデル（計約146MB）を自動ダウンロード・IndexedDBにキャッシュ
3. 画像（JPG/PNG）またはPDFをドラッグ&ドロップするか、クリックして選択
4. OCR処理が完了するとテキストが表示される
5. 「コピー」「ダウンロード」ボタンでテキストを出力

### 対応ファイル形式

| 形式 | 説明 |
|------|------|
| JPEG/PNG | 一般的な画像ファイル |
| PDF | 複数ページ対応（各ページを 2倍スケールでレンダリング） |

## 技術情報

### 使用モデル

| モデル | ファイル | サイズ | 用途 |
|--------|---------|--------|------|
| DEIMv2 | `deim-s-1024x1024.onnx` | 38MB | レイアウト検出（テキスト行の矩形認識）※ndlocr-lite より |
| PARSeq-30 | `parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx` | — | 文字認識（≤30文字行、入力サイズ 24×256） |
| PARSeq-50 | `parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx` | — | 文字認識（≤50文字行、入力サイズ 24×384） |
| PARSeq-100 | `parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx` | — | 文字認識（≤100文字行、入力サイズ 24×768） |

DEIMv2 は行ごとに文字数カテゴリ（1/2/3）を予測し、それに応じて最適な PARSeq モデルを選択するカスケード方式で処理します。PARSeq モデルは ndlocr-lite ベースの tiny 構成を入力高さ 24px・tegaki3 データ追加で再学習した改良版です（202604）。

### 技術スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | Vite + React 19 + TypeScript |
| OCRランタイム | onnxruntime-web 1.20.0（WASM CPU バックエンド） |
| PDF処理 | pdfjs-dist 4.9.0 |
| OCR処理 | Web Worker（UIをブロックしない非同期処理） |
| モデルキャッシュ | IndexedDB |
| デプロイ | Netlify（COOP/COEP ヘッダー対応） |

### OCR処理フロー

```
入力ファイル（JPG/PNG/PDF）
  ↓ imageLoader / pdfLoader → ImageData
  ↓ Web Worker
  1. DEIMv2レイアウト検出
     → テキスト行の矩形 + 文字数カテゴリ を取得
  2. カスケード文字認識（PARSeq × 3モデル）
     → charCountCategory=3 → PARSeq-30
     → charCountCategory=2 → PARSeq-50
     → その他          → PARSeq-100
  3. 読み順ソート（縦書き右→左）
  ↓ メインスレッド
  結果表示 + IndexedDB保存
```

## ローカル開発

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build
```

> **Note**: COOP/COEP ヘッダーが必要なため、`npm run dev` で起動した開発サーバー（`localhost:5173`）で動作確認してください。単純なファイル開き（`file://`）では動作しません。

## 注意事項

- 初回起動時に約 **146MB** のONNXモデルをダウンロードします（2回目以降はキャッシュから読み込み）
- 処理時間はハードウェア性能に依存します（GPU加速なしのCPU推論のため、1枚あたり数十秒かかる場合があります）
- 対応ブラウザ: WebAssembly・IndexedDB・Web Worker に対応した最新ブラウザ（Chrome/Firefox/Safari/Edge 推奨）

## 帰属・クレジット

本ツールは **[NDLOCR-Lite](https://github.com/ndl-lab/ndlocr-lite)**（国立国会図書館 NDL Lab）の派生物です。レイアウト検出モデル（DEIMv2）・文字セット・推論アルゴリズムは NDLOCR-Lite に帰属します。文字認識モデル（PARSeq）は NDLOCR-Lite のアーキテクチャをベースに独自再学習した改良版です。

- **NDLOCR-Lite**: [ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)（国立国会図書館）
- DEIMv2: [ShihuaHuang95/DEIM](https://github.com/ShihuaHuang95/DEIM)
- PARSeq: [baudm/parseq](https://github.com/baudm/parseq)
- 文字セット（NDLmoji.yaml）: 国立国会図書館

## 作成者

橋本雄太（国立歴史民俗博物館 / 国立国会図書館 非常勤調査員）

- GitHub: [yuta1984/ndlocrlite-web](https://github.com/yuta1984/ndlocrlite-web)
