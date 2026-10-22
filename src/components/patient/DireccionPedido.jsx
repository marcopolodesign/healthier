import { useEffect, useState } from 'react'
import { CircleNotch, MapPin, Warning } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import AddressAutocomplete from '../common/AddressAutocomplete'
import { etiquetaFuente, LARGO_MAX } from '../../lib/direccionEmergencia'

/**
 * Nominatim devuelve "7766, Avenida del Libertador, Núñez, Buenos Aires,
 * Comuna 13, …, Argentina". Para el despacho alcanza con calle, número y barrio.
 */
function acortar(displayName) {
  const partes = String(displayName ?? '').split(',').map(p => p.trim()).filter(Boolean)
  // La altura viene sola ("2040") y la calle después; antes puede haber el
  // nombre de un lugar ("El Refugio, 2040, Avenida Cabildo, Belgrano, …").
  const i = partes.findIndex(p => /^\d+[a-z]?$/i.test(p))
  if (i >= 0 && partes[i + 1]) return [`${partes[i + 1]} ${partes[i]}`, partes[i + 2]].filter(Boolean).join(', ')
  return partes.slice(0, 3).join(', ')
}

/**
 * "La ambulancia va a" — la dirección del S.O.S. que el paciente confirma o
 * corrige antes de pedir (Mateo, 2026-10-22; diseño revisado por Felipe).
 * Nunca bloquea el pedido: sin dirección se avisa y se sigue.
 */
export function DireccionPedidoCard({ valor, buscando, conGps, onCambiar }) {
  const vacia = !buscando && !valor?.direccion?.trim()
  const detalle = [valor?.piso?.trim(), valor?.referencias?.trim()].filter(Boolean).join(' · ')
  const origen = etiquetaFuente(valor, buscando, conGps)

  if (vacia) {
    return (
      <div className="mb-5 rounded-[24px] bg-danger/5 border border-danger/30 p-5 space-y-3" data-testid="sos-direccion-vacia">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-gray-900">
          <MapPin className="w-5 h-5 text-danger shrink-0" weight="fill" /> Escribí la dirección para la ambulancia
        </p>
        <button type="button" onClick={onCambiar} className="w-full py-3 rounded-full bg-danger text-white font-semibold text-[15px]">
          Escribir dirección
        </button>
      </div>
    )
  }

  return (
    <div className="mb-5 bg-white rounded-[24px] border border-gray-100 shadow-sm p-5 space-y-1" data-testid="sos-direccion">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-gray-500">La ambulancia va a</span>
        <button
          type="button"
          onClick={onCambiar}
          className="min-h-11 min-w-11 text-[15px] font-semibold text-brand"
          data-testid="sos-direccion-cambiar"
        >
          {/* Habilitado aun buscando: con el GPS lento, el paciente la escribe. */}
          {buscando ? 'Escribirla' : 'Cambiar'}
        </button>
      </div>
      {buscando ? (
        <p className="flex items-center gap-2 text-[13px] text-gray-500">
          <CircleNotch className="w-4 h-4 animate-spin" /> {origen}
        </p>
      ) : (
        <>
          <p className="text-[17px] font-semibold text-gray-900 leading-snug">{valor.direccion}</p>
          {origen && <p className="text-[13px] text-gray-500">{origen}</p>}
          {detalle ? (
            <p className="text-[15px] text-gray-800 pt-1">{detalle}</p>
          ) : (
            <button type="button" onClick={onCambiar} className="min-h-11 text-[15px] font-semibold text-brand">
              Agregá piso y referencias
            </button>
          )}
          {valor?.sinUbicar && (
            <div className="mt-2 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5">
              <Warning className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" weight="fill" />
              <p className="text-[13px] text-gray-800">No la encontramos en el mapa. El despacho la recibe escrita igual.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** "¿A dónde va la ambulancia?" — elegir una guardada o escribirla. */
export function DireccionPedidoHoja({ open, valor, guardadas, onClose, onConfirmar }) {
  const [direccion, setDireccion] = useState({ address: '', latitude: null, longitude: null })
  const [piso, setPiso] = useState('')
  const [referencias, setReferencias] = useState('')
  const [elegida, setElegida] = useState(null)

  // Cada apertura arranca con lo que muestra la card.
  useEffect(() => {
    if (!open) return
    setDireccion({ address: valor?.direccion ?? '', latitude: null, longitude: null })
    setPiso(valor?.piso ?? '')
    setReferencias(valor?.referencias ?? '')
    setElegida(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (g) => {
    setElegida(g)
    setDireccion({ address: g.direccion, latitude: g.lat ?? null, longitude: g.lng ?? null })
    setPiso(g.pisoDepto ?? '')
    setReferencias(g.referencias ?? '')
  }

  const texto = direccion.address.trim()
  const puede = texto.length >= 4

  const confirmar = () => {
    if (!puede) return
    const base = { piso: piso.trim(), referencias: referencias.trim() }
    if (elegida && elegida.direccion === texto) {
      onConfirmar({
        ...base, direccion: texto, fuente: 'guardada', etiqueta: elegida.etiqueta ?? null,
        punto: elegida.lat != null && elegida.lng != null ? { lat: elegida.lat, lng: elegida.lng } : null,
      })
      return
    }
    // Sin tocar la calle (sólo piso/referencias), se queda el origen y el punto que tenía.
    if (valor && valor.direccion.trim() === texto && valor.fuente !== 'ninguna') {
      onConfirmar({ ...valor, ...base, direccion: texto })
      return
    }
    // Elegida de las sugerencias: ya trae su punto.
    const punto = direccion.latitude != null && direccion.longitude != null ? { lat: direccion.latitude, lng: direccion.longitude } : null
    onConfirmar({ ...base, direccion: (punto ? acortar(texto) : texto).slice(0, LARGO_MAX.direccion), fuente: 'escrita', punto })
  }

  return (
    <PatientSheet open={open} onClose={onClose}>
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <h2 className="text-[20px] font-semibold text-text-primary">¿A dónde va la ambulancia?</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
        {guardadas.length > 0 && (
          <div className="space-y-2">
            {guardadas.map((g, i) => (
              <button
                key={`${g.direccion}-${i}`}
                type="button"
                onClick={() => elegir(g)}
                className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors ${
                  elegida === g ? 'bg-brand text-white border-brand' : 'bg-bg-secondary border-border-subtle'
                }`}
              >
                <span className="block text-[15px] font-semibold">{g.etiqueta || 'Guardada'}</span>
                <span className={`block text-[13px] truncate ${elegida === g ? 'text-white' : 'text-text-secondary'}`}>{g.direccion}</span>
              </button>
            ))}
          </div>
        )}

        <AddressAutocomplete
          value={direccion}
          onChange={(v) => { setDireccion({ ...v, address: v.address.slice(0, LARGO_MAX.direccion) }); setElegida(null) }}
          label="Dirección"
          placeholder="Calle y número"
        />

        <div>
          <label className="form-label">Piso / depto</label>
          <input
            type="text"
            value={piso}
            maxLength={LARGO_MAX.piso}
            onChange={e => setPiso(e.target.value)}
            placeholder="Ej.: 4 B"
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label">Referencias para encontrarte</label>
          <textarea
            value={referencias}
            maxLength={LARGO_MAX.referencias}
            onChange={e => setReferencias(e.target.value)}
            placeholder="Ej.: timbre 3, portón azul, entre Gorriti y Honduras"
            className="form-textarea"
            rows={3}
          />
        </div>
      </div>
      <div className="flex-shrink-0 px-5 pt-3 pb-6 border-t border-border-subtle">
        <button
          type="button"
          onClick={confirmar}
          disabled={!puede}
          data-testid="sos-usar-direccion"
          className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Usar esta dirección
        </button>
      </div>
    </PatientSheet>
  )
}
