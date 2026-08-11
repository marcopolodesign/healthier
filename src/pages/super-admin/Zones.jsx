import { useState, useEffect, useRef } from 'react'
import { MapPin, Plus, Trash, Users } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import BulkActionBar from '../../components/super-admin/BulkActionBar'
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog'

export default function SuperAdminZones() {
  const [zones, setZones] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('zones')
  const [newZoneName, setNewZoneName] = useState('')
  const [adding, setAdding] = useState(false)
  const pricingSaveTimers = useRef({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [{ data: z }, { data: w }] = await Promise.all([
        supabase.from('zones').select('*').order('name'),
        supabase.from('waitlist').select('*').order('created_at', { ascending: false }),
      ])
      setZones(z ?? [])
      setWaitlist(w ?? [])
    } catch {
      toast.error('Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  const toggleZone = async (zone) => {
    const { error } = await supabase.from('zones').update({ active: !zone.active }).eq('id', zone.id)
    if (error) { toast.error('Error al actualizar'); return }
    setZones(prev => prev.map(z => z.id === zone.id ? { ...z, active: !z.active } : z))
    toast.success(`${zone.name} ${!zone.active ? 'activada' : 'desactivada'}`)
  }

  const addZone = async (e) => {
    e.preventDefault()
    if (!newZoneName.trim()) return
    setAdding(true)
    const { error } = await supabase.from('zones').insert({ name: newZoneName.trim(), active: true })
    if (error) {
      toast.error(error.message.includes('unique') ? 'Esta zona ya existe' : 'Error al agregar')
    } else {
      toast.success(`${newZoneName.trim()} agregada`)
      setNewZoneName('')
      load()
    }
    setAdding(false)
  }

  const zonesSelection = useBulkSelection(zones.map(z => z.id))
  const [confirmZonesOpen, setConfirmZonesOpen] = useState(false)
  const [deletingZones, setDeletingZones] = useState(false)

  const deleteSelectedZones = async (ids) => {
    setDeletingZones(true)
    const { error } = await supabase.from('zones').delete().in('id', ids)
    if (error) {
      toast.error(error.message || 'Error al eliminar')
    } else {
      setZones(prev => prev.filter(z => !ids.includes(z.id)))
      zonesSelection.clear()
      setConfirmZonesOpen(false)
      toast.success(`${ids.length} zona${ids.length === 1 ? '' : 's'} eliminada${ids.length === 1 ? '' : 's'}`)
    }
    setDeletingZones(false)
  }

  const waitlistSelection = useBulkSelection(waitlist.map(w => w.id))
  const [confirmWaitlistOpen, setConfirmWaitlistOpen] = useState(false)
  const [deletingWaitlist, setDeletingWaitlist] = useState(false)

  const deleteSelectedWaitlist = async (ids) => {
    setDeletingWaitlist(true)
    const { error } = await supabase.from('waitlist').delete().in('id', ids)
    if (error) {
      toast.error(error.message || 'Error al eliminar')
    } else {
      setWaitlist(prev => prev.filter(w => !ids.includes(w.id)))
      waitlistSelection.clear()
      setConfirmWaitlistOpen(false)
      toast.success(`${ids.length} entrada${ids.length === 1 ? '' : 's'} eliminada${ids.length === 1 ? '' : 's'}`)
    }
    setDeletingWaitlist(false)
  }

  // Debounced auto-save (600ms after the last edit to THIS zone's pricing),
  // triggered from the state updater itself rather than onBlur — an onBlur-only
  // approach is fragile here: moving focus between the Mín/Máx/Recomendado
  // inputs of the same row blurs the previous field before the next one's own
  // edit has landed in state, so that blur persists a stale/partial snapshot
  // and the last field's value never gets saved. Reading the freshly-computed
  // zone straight out of the updater sidesteps that race entirely.
  const editZonePricingField = (zoneId, field, rawValue) => {
    const value = rawValue === '' ? null : Number(rawValue)
    setZones(prev => {
      const next = prev.map(z => z.id === zoneId ? { ...z, [field]: value } : z)
      const updatedZone = next.find(z => z.id === zoneId)
      clearTimeout(pricingSaveTimers.current[zoneId])
      pricingSaveTimers.current[zoneId] = setTimeout(() => persistZonePricing(updatedZone), 600)
      return next
    })
  }

  const persistZonePricing = async (zone) => {
    const { error } = await supabase.from('zones').update({
      suggested_price_min:         zone.suggested_price_min,
      suggested_price_max:         zone.suggested_price_max,
      suggested_price_recommended: zone.suggested_price_recommended,
    }).eq('id', zone.id)
    if (error) toast.error('Error al guardar el precio sugerido')
  }

  const markNotified = async (entry) => {
    const { error } = await supabase.from('waitlist').update({ notified: true }).eq('id', entry.id)
    if (error) { toast.error('Error'); return }
    setWaitlist(prev => prev.map(w => w.id === entry.id ? { ...w, notified: true } : w))
    toast.success('Marcado como notificado')
  }

  const activeCount = zones.filter(z => z.active).length
  const pendingCount = waitlist.filter(w => !w.notified).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Zonas de cobertura</h1>
        <p className="text-text-secondary mt-1">Gestioná los barrios de CABA disponibles y la lista de espera</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border">
        {[
          { key: 'zones',    label: `Zonas (${activeCount} activas / ${zones.length})` },
          { key: 'waitlist', label: `Lista de espera${pendingCount > 0 ? ` · ${pendingCount} pendientes` : ''}` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'zones' ? (
        <div className="space-y-4">
          {/* Add zone */}
          <form onSubmit={addZone} className="card flex gap-3 items-center">
            <MapPin className="h-4 w-4 text-text-tertiary shrink-0" />
            <input
              type="text"
              value={newZoneName}
              onChange={e => setNewZoneName(e.target.value)}
              placeholder="Nueva zona (ej. Villa Crespo)"
              className="form-input flex-1"
            />
            <button type="submit" disabled={adding || !newZoneName.trim()} className="btn-primary flex items-center gap-1.5 shrink-0">
              <Plus className="h-4 w-4" />
              Agregar
            </button>
          </form>

          {/* Zone list */}
          <div className="card divide-y divide-border">
            {zones.length > 0 && (
              <div className="flex items-center gap-3 pb-2">
                <input type="checkbox" checked={zonesSelection.isAllSelected} onChange={zonesSelection.toggleAll} className="rounded border-border-default" />
                <span className="text-xs text-text-tertiary">Seleccionar todas</span>
              </div>
            )}
            {zones.map(zone => (
              <div key={zone.id} className="py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={zonesSelection.isSelected(zone.id)} onChange={() => zonesSelection.toggle(zone.id)} className="rounded border-border-default shrink-0" />
                  <MapPin className="h-4 w-4 text-text-tertiary shrink-0" />
                  <span className="flex-1 text-sm font-medium text-text-primary">{zone.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    zone.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {zone.active ? 'Activa' : 'Inactiva'}
                  </span>
                  {/* Toggle */}
                  <button
                    onClick={() => toggleZone(zone)}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${zone.active ? 'bg-brand' : 'bg-gray-300'}`}
                    title={zone.active ? 'Desactivar' : 'Activar'}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform shadow-sm ${zone.active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <button
                    onClick={() => { zonesSelection.toggle(zone.id); setConfirmZonesOpen(true) }}
                    className="p-1 text-text-tertiary hover:text-danger transition-colors"
                    title="Eliminar zona"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>

                {/* Precio sugerido — se muestra en el onboarding profesional al elegir esta zona */}
                <div className="flex items-center gap-2 pl-7 text-xs text-text-tertiary">
                  <span className="w-20 shrink-0">Precio sugerido</span>
                  <span className="text-text-tertiary">$</span>
                  <input
                    type="number"
                    min="0"
                    value={zone.suggested_price_min ?? ''}
                    onChange={e => editZonePricingField(zone.id, 'suggested_price_min', e.target.value)}
                    placeholder="Mín"
                    className="form-input py-1 px-2 text-xs w-20"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min="0"
                    value={zone.suggested_price_max ?? ''}
                    onChange={e => editZonePricingField(zone.id, 'suggested_price_max', e.target.value)}
                    placeholder="Máx"
                    className="form-input py-1 px-2 text-xs w-20"
                  />
                  <span className="ml-2">Recomendado</span>
                  <input
                    type="number"
                    min="0"
                    value={zone.suggested_price_recommended ?? ''}
                    onChange={e => editZonePricingField(zone.id, 'suggested_price_recommended', e.target.value)}
                    placeholder="Recomendado"
                    className="form-input py-1 px-2 text-xs w-24"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {waitlist.length === 0 ? (
            <div className="card text-center py-16">
              <Users className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
              <p className="font-medium text-text-primary">No hay usuarios en lista de espera</p>
              <p className="text-sm text-text-secondary mt-1">Cuando alguien de otra provincia se anote, aparecerá acá</p>
            </div>
          ) : (
            <div className="card divide-y divide-border">
              {waitlist.length > 0 && (
                <div className="flex items-center gap-3 pb-2">
                  <input type="checkbox" checked={waitlistSelection.isAllSelected} onChange={waitlistSelection.toggleAll} className="rounded border-border-default" />
                  <span className="text-xs text-text-tertiary">Seleccionar todos</span>
                </div>
              )}
              {waitlist.map(entry => (
                <div key={entry.id} className="flex items-start justify-between gap-4 py-3">
                  <input type="checkbox" checked={waitlistSelection.isSelected(entry.id)} onChange={() => waitlistSelection.toggle(entry.id)} className="rounded border-border-default shrink-0 mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{entry.nombre} {entry.apellido}</p>
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{entry.email}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {entry.provincia}{entry.ciudad ? ` · ${entry.ciudad}` : ''} · {new Date(entry.created_at).toLocaleDateString('es-AR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      entry.notified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {entry.notified ? 'Notificado' : 'Pendiente'}
                    </span>
                    {!entry.notified && (
                      <button onClick={() => markNotified(entry)} className="text-xs text-brand hover:underline">
                        Marcar avisado
                      </button>
                    )}
                    <button onClick={() => { waitlistSelection.toggle(entry.id); setConfirmWaitlistOpen(true) }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <BulkActionBar
        count={tab === 'zones' ? zonesSelection.count : waitlistSelection.count}
        onDelete={() => tab === 'zones' ? setConfirmZonesOpen(true) : setConfirmWaitlistOpen(true)}
        onClear={() => tab === 'zones' ? zonesSelection.clear() : waitlistSelection.clear()}
      />
      <ConfirmDeleteDialog
        open={confirmZonesOpen}
        title={`Eliminar ${zonesSelection.count} zona${zonesSelection.count === 1 ? '' : 's'}`}
        message="Esta acción no se puede deshacer."
        loading={deletingZones}
        onConfirm={() => deleteSelectedZones(zonesSelection.selectedIds)}
        onCancel={() => setConfirmZonesOpen(false)}
      />
      <ConfirmDeleteDialog
        open={confirmWaitlistOpen}
        title={`Eliminar ${waitlistSelection.count} entrada${waitlistSelection.count === 1 ? '' : 's'} de la lista de espera`}
        message="Esta acción no se puede deshacer."
        loading={deletingWaitlist}
        onConfirm={() => deleteSelectedWaitlist(waitlistSelection.selectedIds)}
        onCancel={() => setConfirmWaitlistOpen(false)}
      />
    </div>
  )
}
