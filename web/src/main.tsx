import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { Acceso } from './app/Acceso.tsx'
import './estilos.css'

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Acceso><App /></Acceso>
  </StrictMode>,
)
