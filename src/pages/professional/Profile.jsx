import { useState, useEffect, useMemo } from 'react'
import { Warning } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import FileUpload from '../../components/FileUpload'
import Modal from '../../components/Modal'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { conCoordenadas } from '../../lib/geo'
import { toast } from '../../components/Toast'
import { isLikelyTooSmallForFace } from '../../lib/imageCompression'
import { camposSensiblesQueCambian, enumerarCampos, requiereReverificacion } from '../../lib/reverificacion'
import { inicialesDe } from '../../lib/format'
import NombreApellidoInputs from '../../components/common/NombreApellidoInputs'
import { nombreApellidoDe, validarNombreApellido, nombreNormalizado, armarNombreCompleto } from '../../lib/nombreApellido'

export default function ProfessionalProfile({ profile, onProfileUpdate }) {
  const { especialidades, activas, porSlug, subEspecialidadesDe } = useEspecialidades()
  const [profData, setProfData] = useState(null)
  const [form, setForm] = useState({
    specialty: '', subSpecialty: '', bio: '',
    address: '', latitude: null, longitude: null,
  })

  // El profesional puede tener guardado un slug que el super admin desactivó o
  // que quedó huérfano (ver migración 101) — sin esto el <select> lo mostraría
  // en blanco aunque el dato siga ahí y se guarde igual al tocar "Guardar".
  const specialtyOptions = useMemo(() => {
    const opts = [...activas]
    if (form.specialty && !opts.some(o => o.slug === form.specialty)) {
      opts.push({ id: form.specialty, slug: form.specialty, label: porSlug[form.specialty] ?? form.specialty })
    }
    return opts
  }, [activas, form.specialty, porSlug])

  const parentEspecialidad = especialidades.find(e => e.slug === form.specialty)
  const subOptions = (parentEspecialidad && subEspecialidadesDe[parentEspecialidad.id]) || []
  const isKnownSub = !form.subSpecialty || subOptions.some(o => o.slug === form.subSpecialty)
  const [subCustom, setSubCustom] = useState(false)
  const showCustomSub = subCustom || (!!form.subSpecialty && !isKnownSub)
  // Nombre y apellido (migración 183). Viven en `profiles`, no en el legajo.
  const [nombres, setNombres] = useState(() => nombreApellidoDe(profile))
  useEffect(() => { setNombres(nombreApellidoDe(profile)) }, [profile?.id, profile?.firstName, profile?.lastName])
  const nombreArmado = armarNombreCompleto(nombres.nombre, nombres.apellido)
  const cambiaNombre = nombres.nombre.trim() !== (profile?.firstName ?? '').trim()
    || nombres.apellido.trim() !== (profile?.lastName ?? '').trim()
  // Mismo criterio que la base (183): reordenar o cambiar mayúsculas no es
  // cambiar la identidad; agregar, sacar o cambiar una palabra sí.
  const cambiaIdentidad = nombreNormalizado(nombreArmado) !== nombreNormalizado(profile?.fullName)
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(p => {
      setProfData(p)
      if (p) setForm({
        specialty:    p.specialty    || '',
        subSpecialty: p.subSpecialty || '',
        bio:          p.bio          || '',
        address:      p.address      || '',
        latitude:     p.latitude     || null,
        longitude:    p.longitude    || null,
      })
    }).finally(() => setLoading(false))
  }, [profile?.id])

  const handleAvatarFile = async file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    // Aviso blando, no bloqueante: no detectamos caras, sólo avisamos si la
    // imagen es chica. El profesional decide si la cambia.
    if (await isLikelyTooSmallForFace(file)) {
      toast.warning('Esa foto es chica y puede que no se te vea bien la cara. Podés seguir igual o subir otra.')
    }
  }

  // Cambiar la especialidad de un profesional ya verificado lo devuelve a la
  // cola de revisión (migración 132). El guardado no cambia — lo que cambia es
  // que primero se le dice, en vez de que se entere cuando su perfil ya dejó de
  // recibir consultas.
  const cambiosSensibles = requiereReverificacion(profData)
    ? [...camposSensiblesQueCambian(profData, form), ...(cambiaIdentidad ? ['Nombre completo'] : [])]
    : []
  const [confirmandoReverificacion, setConfirmandoReverificacion] = useState(false)

  const guardar = async () => {
    const errorNombre = validarNombreApellido(nombres.nombre, nombres.apellido)
    if (errorNombre) {
      toast.error(errorNombre)
      setConfirmandoReverificacion(false)
      return
    }
    setSaving(true)
    try {
      if (avatarFile) {
        await profilesService.uploadAvatar(profile.id, avatarFile)
        setAvatarFile(null)
      }
      // Las coordenadas van SIEMPRE con la dirección que se guarda: antes, si
      // no se podía geocodificar, se borraban del payload y quedaban las de la
      // dirección anterior — el pin del mapa seguía en la vieja.
      const payload = { ...profData, ...form, ...(await conCoordenadas(form)) }
      const guardado = await professionalService.upsert(profile.id, payload)
      // Quedarse con lo que devolvió el servidor y no con el payload:
      // `is_verified` y `reverification_pending` los decide el trigger, así que
      // lo que se mandó no es lo que quedó. Sin esto el aviso volvería a
      // aparecer en el siguiente guardado, comparando contra datos viejos.
      // `profiles` es un join de sólo lectura que el upsert no devuelve — se
      // conserva el que ya estaba o el avatar del encabezado desaparece.
      let estado = guardado
      // El nombre va DESPUÉS del legajo: el upsert de arriba reenvía
      // `is_verified` tal como estaba, y si el cambio de nombre ya lo hubiera
      // bajado, ese reenvío chocaría con "nadie se verifica a sí mismo" (132).
      if (cambiaNombre) {
        const perfil = await profilesService.update(profile.id, {
          first_name: nombres.nombre.trim(),
          last_name: nombres.apellido.trim(),
        })
        if (onProfileUpdate) onProfileUpdate(perfil)
        // El trigger de identidad puede haber abierto la revisión: se relee.
        estado = await professionalService.getByUserId(profile.id)
      }
      setProfData(prev => ({ ...estado, profiles: prev?.profiles }))
      if (estado?.reverificationPending) {
        toast.info('Guardamos el cambio. Tu perfil quedó pendiente de verificación.')
      } else {
        toast.success('Perfil actualizado')
      }
    } catch (err) {
      toast.error(`Error al guardar: ${err.message}`)
    } finally {
      setSaving(false)
      setConfirmandoReverificacion(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    if (cambiosSensibles.length > 0) return setConfirmandoReverificacion(true)
    guardar()
  }

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  const currentAvatar = avatarPreview || profData?.profiles?.avatarUrl

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi perfil profesional</h1>
        <p className="text-text-secondary mt-1">Esta información es visible para los pacientes</p>
      </div>

      <form onSubmit={save} className="space-y-6">

        {/* ── Personal info card ── */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary">Datos personales</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-brand-muted flex items-center justify-center shrink-0">
              {currentAvatar
                ? <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                : <span className="text-brand font-bold text-2xl">{inicialesDe(profile?.fullName)}</span>
              }
            </div>
            <div className="flex-1">
              <label className="form-label">Foto de perfil</label>
              <FileUpload
                onFile={handleAvatarFile}
                accept="image/*"
                label={avatarFile ? avatarFile.name : 'Cambiar foto'}
                hint="Que se te vea la cara con claridad, de frente y con buena luz."
              />
            </div>
          </div>

          <NombreApellidoInputs nombre={nombres.nombre} apellido={nombres.apellido} onChange={setNombres} />

          <div>
            <label className="form-label">Especialidad</label>
            <select
              value={form.specialty}
              onChange={e => { setSubCustom(false); setForm(p => ({ ...p, specialty: e.target.value, subSpecialty: '' })) }}
              className="form-select"
            >
              <option value="">Seleccioná una especialidad</option>
              {specialtyOptions.map(s => <option key={s.slug} value={s.slug}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Sub-especialidad <span className="text-text-tertiary text-xs">(opcional)</span></label>
            <select
              value={showCustomSub ? '__otra__' : (form.subSpecialty || '')}
              onChange={e => {
                if (e.target.value === '__otra__') { setSubCustom(true); setForm(p => ({ ...p, subSpecialty: '' })) }
                else { setSubCustom(false); setForm(p => ({ ...p, subSpecialty: e.target.value })) }
              }}
              className="form-select"
            >
              <option value="">Ninguna</option>
              {subOptions.map(s => <option key={s.id} value={s.slug}>{s.label}</option>)}
              <option value="__otra__">Otra (especificar)</option>
            </select>
            {showCustomSub && (
              <input
                type="text"
                value={form.subSpecialty}
                onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))}
                placeholder="Ej: Cardiología Clínica"
                className="form-input mt-2"
              />
            )}
          </div>

          <div>
            <label className="form-label">Bio / Presentación</label>
            <textarea
              value={form.bio}
              onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
              rows={4}
              className="form-textarea"
            />
          </div>

          <AddressAutocomplete
            label="Dirección del consultorio"
            value={{ address: form.address, latitude: form.latitude, longitude: form.longitude }}
            onChange={({ address, latitude, longitude }) =>
              setForm(p => ({ ...p, address, latitude, longitude }))
            }
          />

        </div>

        {cambiosSensibles.length > 0 && (
          <div className="card border-warning/30 bg-yellow-50 flex items-start gap-3">
            <Warning className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary">
              Estás cambiando {enumerarCampos(cambiosSensibles)}. Al guardar, tu perfil vuelve a
              revisión.
            </p>
          </div>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>

      <Modal
        open={confirmandoReverificacion}
        onClose={() => setConfirmandoReverificacion(false)}
        title="Tu perfil vuelve a revisión"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Estás por cambiar {enumerarCampos(cambiosSensibles)}. Es parte de lo que el equipo de
            Healthier revisó para verificarte, así que lo tenemos que volver a mirar.
          </p>
          <ul className="text-sm text-text-secondary space-y-2 bg-white rounded-xl p-4 border border-border-default">
            <li>· Tu perfil pasa a <strong className="text-text-primary">pendiente de verificación</strong>.</li>
            <li>· Mientras tanto <strong className="text-text-primary">no vas a recibir consultas nuevas</strong>: no aparecés en la búsqueda ni en las consultas inmediatas.</li>
            <li>· Los turnos que ya tenés agendados <strong className="text-text-primary">los seguís atendiendo normalmente</strong>.</li>
          </ul>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmandoReverificacion(false)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Guardando...' : 'Guardar igual'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
