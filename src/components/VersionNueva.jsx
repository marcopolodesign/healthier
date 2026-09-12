import { useEffect, useState } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'

/**
 * Avisa cuando la pestaña está corriendo un build viejo.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El 2026-09-12 se arregló el envío del legajo de profesionales, se deployó, y
 * **al profesional le volvió a fallar tres horas después**: su teléfono seguía
 * ejecutando el JS anterior. Los logs lo mostraron sin lugar a dudas — las tres
 * subidas salieron en paralelo, que es exactamente lo que el arreglo había
 * dejado de hacer.
 *
 * Es una SPA: mientras la pestaña no se recargue, el código nuevo no entra por
 * más que el deploy esté hecho. Y el síntoma de "estoy sobre un bundle viejo"
 * es **idéntico** al de "el arreglo no sirvió", así que sin esto cada deploy
 * puede generar un reporte de un bug que ya no existe.
 *
 * ── Cómo lo detecta ─────────────────────────────────────────────────────────
 * Pide el `index.html` sin caché y compara el `assets/index-*.js` que declara
 * contra el que esta pestaña tiene cargado. Vite le pone un hash de contenido,
 * así que cambia si y sólo si cambió el código. No hace falta endpoint nuevo ni
 * número de versión que alguien tenga que acordarse de subir.
 *
 * Chequea al volver a la pestaña y cada 30 minutos. Nunca recarga solo: alguien
 * puede estar en medio de un formulario —justamente el caso que originó esto—,
 * y perderle lo escrito por avisarle de una versión nueva sería peor que el
 * problema.
 */
const CADA = 30 * 60 * 1000

function bundleDeLaPestana() {
  const s = [...document.querySelectorAll('script[src]')]
    .map(x => x.getAttribute('src') || '')
    .find(x => /\/assets\/index-.*\.js$/.test(x))
  return s ? s.split('/').pop() : null
}

async function bundlePublicado() {
  try {
    const html = await fetch('/', { cache: 'no-store' }).then(r => (r.ok ? r.text() : null))
    if (!html) return null
    const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)
    return m ? m[1] : null
  } catch {
    // Sin conexión no se sabe nada, y no saber no es motivo para molestar.
    return null
  }
}

export default function VersionNueva() {
  const [hayNueva, setHayNueva] = useState(false)

  useEffect(() => {
    const mio = bundleDeLaPestana()
    // En `npm run dev` no hay bundle con hash: no hay nada que comparar.
    if (!mio) return

    let vivo = true
    const mirar = async () => {
      if (!vivo || document.hidden) return
      const publicado = await bundlePublicado()
      if (vivo && publicado && publicado !== mio) setHayNueva(true)
    }

    mirar()
    const t = setInterval(mirar, CADA)
    document.addEventListener('visibilitychange', mirar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', mirar)
    }
  }, [])

  if (!hayNueva) return null

  return (
    // `bottom-24` abajo de `lg`: ahí vive el menú inferior (paciente y
    // profesional), y un aviso encima de "Agenda" y "Pacientes" tapa justo lo
    // que la persona iba a tocar.
    <div className="fixed bottom-24 lg:bottom-4 left-1/2 -translate-x-1/2 z-[200] px-3 w-full max-w-md">
      <div className="flex items-center gap-3 rounded-2xl bg-text-primary text-white shadow-lg px-4 py-3">
        <ArrowsClockwise className="h-5 w-5 shrink-0" />
        <p className="flex-1 text-sm leading-snug">
          Hay una versión nueva de Healthier.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 transition-colors px-3 py-1.5 text-sm font-semibold"
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
