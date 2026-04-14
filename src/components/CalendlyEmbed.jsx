import { useEffect, useRef } from 'react'

export default function CalendlyEmbed({ url, prefill = {}, height = 700 }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!url || !containerRef.current) return

    // Load Calendly script if not present
    if (!document.querySelector('script[src*="calendly"]')) {
      const script = document.createElement('script')
      script.src = 'https://assets.calendly.com/assets/external/widget.js'
      script.async = true
      document.body.appendChild(script)
    }

    // Clear and inject the embed div
    containerRef.current.innerHTML = ''
    const div = document.createElement('div')
    div.className = 'calendly-inline-widget'
    div.style.minWidth = '320px'
    div.style.height = `${height}px`
    div.dataset.url = url

    if (prefill.name) div.dataset.url += `?name=${encodeURIComponent(prefill.name)}`
    if (prefill.email) div.dataset.url += `${prefill.name ? '&' : '?'}email=${encodeURIComponent(prefill.email)}`

    containerRef.current.appendChild(div)

    // Re-init if script already loaded
    if (window.Calendly) {
      window.Calendly.initInlineWidgets()
    }
  }, [url, prefill.name, prefill.email, height])

  if (!url) {
    return (
      <div className="flex items-center justify-center h-64 border-2 border-dashed border-border-default rounded-lg">
        <p className="text-text-secondary text-sm">No hay URL de Calendly configurada.</p>
      </div>
    )
  }

  return <div ref={containerRef} />
}
