import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DiffApp from './DiffApp.tsx'

function Root() {
  const [mode, setMode] = useState<'home' | 'ocr' | 'diff'>('home')

  if (mode === 'ocr') return <App />
  if (mode === 'diff') return <DiffApp onBack={() => setMode('home')} />

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f4f4f9',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '20px',
      fontFamily: 'Helvetica Neue, Arial, sans-serif',
    }}>
      <h1 style={{ fontSize: '24px', color: '#1a1a2e', marginBottom: '8px' }}>
        NDLOCR-Lite Web
      </h1>
      <p style={{ color: '#666', marginBottom: '16px' }}>
        使いたいツールを選んでください
      </p>
      <button
        onClick={() => setMode('ocr')}
        style={{
          padding: '16px 48px',
          fontSize: '16px',
          fontWeight: 'bold',
          background: '#1a1a2e',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          width: '280px',
        }}
      >
        📄 OCR ツール
      </button>
      <button
        onClick={() => setMode('diff')}
        style={{
          padding: '16px 48px',
          fontSize: '16px',
          fontWeight: 'bold',
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          width: '280px',
        }}
      >
        🔍 テキスト比較ツール
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)