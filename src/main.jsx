import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initSentry } from './lib/sentry'
import { Analytics } from '@vercel/analytics/react'
import { sinDatosEnUrl } from './lib/analiticaVercel'

initSentry()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      {/* Visitas por página (Vercel Web Analytics, sin cookies): de acá sale el
          embudo reservar → pago → turno confirmado. */}
      <Analytics beforeSend={sinDatosEnUrl} />
    </ErrorBoundary>
  </StrictMode>,
)
