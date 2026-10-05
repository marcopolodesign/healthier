import { useState, useEffect } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import AddressAutocomplete from '../common/AddressAutocomplete'

const ETIQUETAS = ['Casa', 'Trabajo', 'Otra']

/** Alta de una dirección nueva en `patient_addresses`. Ver `AddressPickerSheet`. */
export default function AddressFormSheet({ open, onClose, onSave, saving }) {
  const [etiqueta, setEtiqueta] = useState('Casa')
  const [direccion, setDireccion] = useState({ address: '', latitude: null, longitude: null })
  const [pisoDepto, setPisoDepto] = useState('')
  const [referencias, setReferencias] = useState('')

  // Cada apertura arranca en blanco — es siempre "agregar", nunca "editar".
  useEffect(() => {
    if (!open) return
    setEtiqueta('Casa')
    setDireccion({ address: '', latitude: null, longitude: null })
    setPisoDepto('')
    setReferencias('')
  }, [open])

  const puedeGuardar = direccion.address.trim().length > 3 && !saving

  const guardar = () => {
    if (!puedeGuardar) return
    onSave({
      etiqueta,
      direccion: direccion.address.trim(),
      pisoDepto: pisoDepto.trim() || null,
      referencias: referencias.trim() || null,
      lat: direccion.latitude,
      lng: direccion.longitude,
    })
  }

  return (
    <PatientSheet open={open} onClose={onClose}>
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <h2 className="text-[20px] font-semibold text-text-primary">Nueva dirección</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
        <div className="flex gap-2">
          {ETIQUETAS.map(op => (
            <button
              key={op}
              type="button"
              onClick={() => setEtiqueta(op)}
              className={`flex-1 py-2.5 rounded-full border text-[13px] font-semibold transition-colors ${
                etiqueta === op ? 'bg-brand text-white border-brand' : 'bg-bg-secondary text-text-secondary border-border-subtle'
              }`}
            >
              {op}
            </button>
          ))}
        </div>

        <AddressAutocomplete value={direccion} onChange={setDireccion} label="Dirección" required />

        <div>
          <label className="form-label">Piso / depto (opcional)</label>
          <input
            type="text"
            value={pisoDepto}
            onChange={e => setPisoDepto(e.target.value)}
            placeholder="Ej: 4to B"
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">Referencias (opcional)</label>
          <input
            type="text"
            value={referencias}
            onChange={e => setReferencias(e.target.value)}
            placeholder="Ej: Portón negro, timbre 2"
            className="form-input"
          />
        </div>
      </div>

      <div className="flex-shrink-0 px-5 pt-3 pb-6 border-t border-border-subtle">
        <button
          type="button"
          onClick={guardar}
          disabled={!puedeGuardar}
          className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
        >
          {saving && <CircleNotch className="w-4 h-4 animate-spin" />}
          Guardar dirección
        </button>
      </div>
    </PatientSheet>
  )
}
