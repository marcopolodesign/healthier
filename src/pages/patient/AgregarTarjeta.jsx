/**
 * AgregarTarjeta — pantalla dedicada, a pantalla completa, para cargar una
 * tarjeta nueva.
 *
 * Existe porque la app mobile NO puede tener un formulario nativo de tarjeta:
 * el número completo nunca puede pasar por código nuestro (ver
 * `mobile/src/services/CardTokenService.ts`, que sólo tokeniza el CVV de una
 * tarjeta YA guardada). El Brick de Mercado Pago corre en un browser, así que
 * la app embebe ESTA ruta en un WebView ya logueado
 * (`mobile/app/tarjetas/agregar.tsx` + Edge Function `webview-session`) y los
 * datos sensibles viajan directo a MP desde sus propios iframes.
 *
 * Antes de esto, "Añadir tarjeta" en la app abría Safari en `/paciente/perfil`
 * y las tres pantallas de pago decían "por ahora se agregan desde el sitio
 * web": un paciente que llegaba a pagar sin tarjeta guardada no tenía forma de
 * terminar, ni en la app ni volviendo.
 *
 * Es la MISMA ruta para los dos usos:
 * - Dentro del WebView: al guardar avisa por `postMessage` y la app cierra la
 *   pantalla sola. El encabezado propio se oculta (`?embed=1`) porque el
 *   contenedor nativo ya trae el suyo.
 * - En el browser: se comporta como cualquier página del sitio, con su header
 *   y un botón para volver al perfil.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, LockSimple } from '@phosphor-icons/react'
import MPCardHolder from '../../components/payment/MPCardHolder'
import { mpService } from '../../services/mpService'

/**
 * Le avisa al contenedor nativo que la tarjeta quedó guardada.
 *
 * `window.ReactNativeWebView` sólo existe dentro del WebView de la app; en un
 * browser normal esto no hace nada y la pantalla sigue su curso mostrando la
 * confirmación. Se manda JSON (y no un string suelto) para que el día que haya
 * un segundo evento no haya que adivinar cuál es cuál del lado nativo.
 */
function avisarAlaApp(payload) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(payload))
  } catch {
    // Un postMessage que falla no puede romper el guardado, que ya pasó.
  }
}

export default function AgregarTarjeta({ profile }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const embebido = params.get('embed') === '1'

  const [mpPublicKey, setMpPublicKey] = useState(null)
  const [configResuelta, setConfigResuelta] = useState(false)
  const [guardada, setGuardada] = useState(null) // { lastFour, cardBrand }

  useEffect(() => {
    mpService.getPaymentPlatformConfig()
      .then(({ data }) => setMpPublicKey(data?.publicKey ?? null))
      .catch(() => setMpPublicKey(null))
      .finally(() => setConfigResuelta(true))
  }, [])

  const handleSuccess = tarjeta => {
    setGuardada(tarjeta ?? {})
    avisarAlaApp({
      type: 'card-saved',
      lastFour: tarjeta?.lastFour ?? null,
      cardBrand: tarjeta?.cardBrand ?? null,
    })
  }

  const volver = () => {
    if (embebido) {
      // En la app el "volver" lo ejecuta el contenedor nativo: acá sólo se
      // avisa. El header propio está oculto, así que esto llega únicamente
      // desde el botón de la pantalla de confirmación.
      avisarAlaApp({ type: 'close' })
      return
    }
    navigate('/paciente/perfil')
  }

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {!embebido && (
        <header className="flex items-center justify-between px-5 py-4 border-b border-border-default bg-bg-secondary">
          <button
            onClick={volver}
            className="w-10 h-10 rounded-full border border-border-default bg-white shadow-sm flex items-center justify-center hover:bg-bg-primary"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <p className="font-semibold text-[15px] text-text-primary">Añadir tarjeta</p>
          <div className="w-10" />
        </header>
      )}

      <main className="flex-1 w-full max-w-md mx-auto px-5 py-6">
        {guardada ? (
          <div className="bg-bg-secondary rounded-2xl border border-border-default shadow-sm p-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle size={48} weight="fill" className="text-brand" />
            <p className="text-text-primary font-semibold text-lg">Tarjeta guardada</p>
            <p className="text-text-secondary text-sm">
              {guardada.cardBrand ? `${String(guardada.cardBrand).toUpperCase()} ` : ''}
              terminada en{' '}
              <span className="font-mono font-semibold text-text-primary">
                {guardada.lastFour ?? '????'}
              </span>
            </p>
            <button
              onClick={volver}
              className="mt-3 px-8 py-3 rounded-full bg-brand text-white font-semibold text-[15px]"
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            <div className="bg-bg-secondary rounded-2xl border border-border-default shadow-sm p-6">
              {!configResuelta ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-12 bg-bg-primary rounded-xl" />
                  <div className="h-12 bg-bg-primary rounded-xl" />
                  <div className="h-12 bg-brand/20 rounded-full" />
                </div>
              ) : mpPublicKey ? (
                <MPCardHolder
                  publicKey={mpPublicKey}
                  mode="save"
                  payerEmail={profile?.email ?? ''}
                  submitLabel="Guardar tarjeta"
                  onSuccess={handleSuccess}
                  onError={() => { /* el Brick ya muestra el motivo adentro */ }}
                />
              ) : (
                <p className="text-sm text-text-secondary text-center py-6">
                  Guardar tarjetas no está disponible en este momento. Probá de nuevo más tarde.
                </p>
              )}
            </div>

            <p className="flex items-start gap-2 text-[12px] text-text-tertiary mt-4 px-1">
              <LockSimple size={14} weight="fill" className="mt-[2px] shrink-0" />
              <span>
                Los datos de tu tarjeta se procesan directamente con Mercado Pago. Healthier
                solo guarda la marca y los últimos 4 dígitos.
              </span>
            </p>
          </>
        )}
      </main>
    </div>
  )
}
