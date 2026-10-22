import { useEffect, useState } from 'react'
import { Key, SealCheck, PaperPlaneTilt, PhoneSlash, CircleNotch, Warning } from '@phosphor-icons/react'
import PatientSheet from '../patient/PatientSheet'
import { pasoDeLaHoja } from '../../lib/codigoAlCortar'

/**
 * La hoja que aparece al cortar la videoconsulta sin el código de cierre
 * (Mateo, 2026-10-22: "Sino cortás y no se lo pediste — es peligroso").
 *
 * No trae lógica propia del código: verificar, pedir y los intentos son los de
 * la pestaña "Cerrar Consulta" (`VideoCall.jsx`, migración 099) y llegan por
 * props. El paso que se muestra lo decide `pasoDeLaHoja` (lib/codigoAlCortar).
 *
 * Diseño revisado por Felipe: "Pedir código" primero; el input se verifica solo
 * al cuarto dígito; "Cortar sin código" es un texto sin rojo, con confirmación
 * — el rojo queda para la acción que corta de verdad. Cerrar la hoja (fondo,
 * Esc) = seguir en la llamada.
 *
 * `motivo`: 'colgar' (botón rojo / Finalizar), 'salir' (la X de la app) o
 * 'volver' (el "Volver" de la web) — los dos últimos salen de la sala sin
 * finalizar la consulta.
 */
const REPEDIR_MS = 20_000

export default function CodigoAlCortarSheet({
  open, motivo = 'colgar', nombrePaciente, pacienteConectado,
  codeVerifiedAt, codeInput, onCodeInputChange, onVerify, verifying, verifyError, attemptsLeft,
  onSolicitar, solicitando, solicitado,
  onSeguir, onCortar, onCortarSinCodigo,
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [puedeRepedir, setPuedeRepedir] = useState(false)

  // Cada apertura arranca en "pedir".
  useEffect(() => { if (open) setConfirmando(false) }, [open])

  // Si en 20 s el código no llegó, "Volver a pedir": sin eso el profesional se
  // queda mirando un spinner sin salida.
  useEffect(() => {
    setPuedeRepedir(false)
    if (!solicitado || codeVerifiedAt) return
    const t = setTimeout(() => setPuedeRepedir(true), REPEDIR_MS)
    return () => clearTimeout(t)
  }, [solicitado, codeVerifiedAt])

  const paso = pasoDeLaHoja({
    codigoVerificadoEn: codeVerifiedAt, confirmando, intentosRestantes: attemptsLeft, solicitado,
  })
  const nombre = (nombrePaciente || '').trim().split(/\s+/)[0] || 'el paciente'
  // 'salir' (X de la app) y 'volver' (Volver de la web) sacan de la sala sin
  // finalizar la consulta; 'colgar' la corta.
  const saliendo = motivo !== 'colgar'
  const textoCortar = saliendo ? 'Salir de la sala' : 'Cortar la llamada'
  const textoSinCodigo = saliendo ? 'Salir sin código' : 'Cortar sin código'

  function escribir(valor) {
    const limpio = valor.replace(/\D/g, '').slice(0, 4)
    onCodeInputChange(limpio)
    // Se verifica solo al cuarto dígito (no hay botón "Verificar").
    if (limpio.length === 4 && !verifying) onVerify(limpio)
  }

  return (
    <PatientSheet open={open} onClose={onSeguir} maxWidth="max-w-md">
      <div
        className="px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]"
        data-testid="codigo-al-cortar"
        data-paso={paso}
      >
        {/* Header fijo: cambia el contenido, no el alto. */}
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
            paso === 'verificado' ? 'bg-emerald-100' : paso === 'confirmar' ? 'bg-amber-100' : 'bg-brand/10'
          }`}>
            {paso === 'verificado'
              ? <SealCheck className="h-6 w-6 text-emerald-600" weight="fill" />
              : paso === 'confirmar'
                ? <Warning className="h-6 w-6 text-amber-700" />
                : <Key className="h-6 w-6 text-brand" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-text-primary">
              {paso === 'verificado'
                ? 'Código verificado'
                : paso === 'confirmar'
                  ? `¿${saliendo ? 'Salir' : 'Cortar'} sin el código?`
                  : `Antes de ${saliendo ? 'salir' : 'cortar'}, pedile el código`}
            </h3>
            <p className="text-[15px] text-text-secondary leading-snug mt-0.5">
              {paso === 'verificado'
                ? 'Ya podés cerrar la consulta sin volver a pedirlo.'
                : paso === 'confirmar'
                  ? 'Para cerrar la consulta vas a tener que dejar un motivo escrito.'
                  : `Así queda registrado que la consulta se hizo. ${nombre === 'el paciente' ? 'El paciente' : nombre} lo ve en su pantalla.`}
            </p>
          </div>
        </div>

        {paso === 'verificado' && (
          <>
            <p className="text-center font-mono text-3xl tracking-[0.5em] text-emerald-600 py-2" aria-label="Código">
              {codeInput || '····'}
            </p>
            <button type="button" onClick={onCortar} className="btn-danger w-full min-h-14 mt-4 flex items-center justify-center gap-2 text-base">
              <PhoneSlash className="h-5 w-5" weight="fill" /> {textoCortar}
            </button>
          </>
        )}

        {paso === 'confirmar' && (
          <div className="space-y-2">
            <button type="button" onClick={onCortarSinCodigo} className="btn-danger w-full min-h-14 text-base">
              Sí, {saliendo ? 'salir' : 'cortar'} sin código
            </button>
            <button type="button" onClick={() => setConfirmando(false)} className="btn-secondary w-full min-h-14 text-base">
              Volver a pedir el código
            </button>
          </div>
        )}

        {(paso === 'pedir' || paso === 'esperando' || paso === 'agotado') && (
          <>
            {paso === 'agotado' ? (
              <p className="text-sm text-amber-700 mb-3">
                Se agotaron los intentos. Podés {saliendo ? 'salir' : 'cortar'} y dejar el motivo al cerrar la consulta.
              </p>
            ) : pacienteConectado ? (
              <>
                <button
                  type="button"
                  onClick={onSolicitar}
                  disabled={solicitando || paso === 'esperando'}
                  className="btn-primary w-full min-h-14 flex items-center justify-center gap-2 text-base disabled:opacity-70"
                >
                  {paso === 'esperando'
                    ? <><CircleNotch className="h-5 w-5 animate-spin" /> Esperando a {nombre}…</>
                    : <><PaperPlaneTilt className="h-5 w-5" /> {solicitando ? 'Pidiendo…' : `Pedir código a ${nombre}`}</>}
                </button>
                {paso === 'esperando' && puedeRepedir && (
                  <button type="button" onClick={onSolicitar} className="w-full min-h-12 text-sm text-brand underline underline-offset-4">
                    Volver a pedir
                  </button>
                )}
                <div className="flex items-center gap-3 my-3">
                  <span className="h-px flex-1 bg-border-default" />
                  <span className="text-sm text-text-tertiary">o escribilo si te lo dice</span>
                  <span className="h-px flex-1 bg-border-default" />
                </div>
              </>
            ) : (
              <p className="text-sm text-text-secondary mb-3">
                {nombre === 'el paciente' ? 'El paciente' : nombre} ya no está en la llamada. Si te dijo el código, escribilo.
              </p>
            )}

            {paso !== 'agotado' && (
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={codeInput}
                onChange={e => escribir(e.target.value)}
                placeholder="0000"
                aria-label="Código de cierre"
                className="form-input w-full h-14 text-center text-2xl font-mono tracking-[0.5em]"
              />
            )}
            {verifying && <p className="text-sm text-text-secondary mt-2">Verificando…</p>}
            {verifyError && <p className="text-sm text-red-600 mt-2">{verifyError}</p>}

            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className={paso === 'agotado'
                ? 'btn-danger w-full min-h-14 mt-4 text-base'
                : 'w-full min-h-12 mt-3 text-sm text-text-secondary underline underline-offset-4'}
            >
              {textoSinCodigo}
            </button>
          </>
        )}
      </div>
    </PatientSheet>
  )
}
