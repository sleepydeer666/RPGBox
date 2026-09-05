import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChromaKeyApp from './chroma-key-main'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChromaKeyApp />
  </StrictMode>,
)
