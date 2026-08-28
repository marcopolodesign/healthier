import { Component } from 'react'
import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react'
import { Sentry } from '../lib/sentry'

// Root error boundary — regla de Mateo: nunca una pantalla blanca sin
// explicación, siempre mostrar el error real. Tiene que ser un componente de
// clase: es la única forma que tiene React de implementar
// getDerivedStateFromError / componentDidCatch.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary capturó un error:', error, info?.componentStack)
    Sentry.captureException(error, { contexts: { react: { componentStack: info?.componentStack } } })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
        <div className="card max-w-lg w-full text-center">
          <WarningCircle className="h-12 w-12 text-danger mx-auto mb-4" weight="duotone" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-2">Algo salió mal</h1>
          <p className="text-text-secondary text-sm mb-4">
            La app encontró un error inesperado. Recargá la página — si el problema sigue, contanos el mensaje de abajo.
          </p>
          <div className="bg-bg-secondary border border-border-default rounded-lg p-3 mb-6 text-left max-h-40 overflow-auto">
            <code className="text-xs font-mono text-danger select-all break-all whitespace-pre-wrap">
              {error?.message || String(error)}
            </code>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary px-6 py-2.5 inline-flex items-center justify-center gap-2"
          >
            <ArrowClockwise className="h-4 w-4" />
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
