import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

if (window.rpgboxDesktop?.platform === 'desktop') {
  document.documentElement.classList.add('desktop-runtime')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
