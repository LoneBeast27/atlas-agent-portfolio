import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { StdbProvider } from './api/stdb'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StdbProvider>
      <App />
    </StdbProvider>
  </StrictMode>,
)
