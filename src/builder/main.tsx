import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import BuilderApp from './BuilderApp'
import './builder.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuilderApp />
  </StrictMode>,
)
