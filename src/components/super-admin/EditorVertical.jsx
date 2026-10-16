import { useEffect, useRef, useState } from 'react'
import { CircleNotch, Check, Warning, UploadSimple, Trash } from '@phosphor-icons/react'
import {
  COLORES_PRESET, ICONOS_VERTICAL, iconoDe, colorSugerido, iconoSugerido,
  contrasteConBlanco, oscurecerHasta,
} from '../../lib/verticals'
import { verticalsService } from '../../services/verticalsService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { toast } from '../Toast'

/**
 * Panel para crear o editar la identidad de una vertical (migración 199):
 * nombre, foto, color de fondo e ícono, con la vista previa del carrusel del
 * paciente al lado — encendida y apagada, a escala 1:1.
 *
 * Diseño revisado por Felipe (2026-10-16): swatches de 32 px; el elegido con
 * anillo; el sugerido sólo con la etiqueta "Sugerido" abajo; "Otro" acepta un
 * hex y avisa (no bloquea) si da menos de 3:1 contra el texto blanco.
 *
 * `vertical` null = alta. En el alta también se pide el precio de la consulta
 * inmediata (opcional: sin precio queda apagada para el paciente).
 */

const MIN_W = 870
const MIN_H = 1020

const slugDe = nombre => nombre
  .trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const formatARS = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(n))

function medirImagen(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    img.src = url
  })
}

/** Una tarjeta del carrusel tal como la ve el paciente (OnDemandCarousel.jsx). */
function TarjetaPreview({ nombre, color, iconKey, img, precio, apagada }) {
  const fondoRef = useRef(null)
  useEffect(() => { fondoRef.current?.style.setProperty('--card-color', color) }, [color])
  const Icono = iconoDe(iconKey)
  return (
    <div className={`od-card ${apagada ? 'od-card-offline' : ''} relative w-[290px] h-[340px] shrink-0 rounded-[28px] overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.18)]`}>
      {img ? (
        <img src={img} alt="" className={`absolute inset-0 w-full h-full object-cover ${apagada ? 'od-media-offline' : ''}`} />
      ) : (
        <span ref={fondoRef} className={`absolute inset-0 od-card-color ${apagada ? 'od-media-offline' : ''}`}>
          <Icono weight="light" className="absolute -right-6 -bottom-6 h-40 w-40 text-white/[0.18]" aria-hidden="true" />
        </span>
      )}
      <span className="absolute inset-0 bg-gradient-to-b from-transparent via-black/25 to-black/75" />
      {precio ? (
        <span className="absolute top-3.5 right-3.5 px-2.5 py-1.5 rounded-full bg-black/45 text-white text-[13px] font-medium">
          ${formatARS(precio)}
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 p-[18px] flex flex-col items-start gap-2.5">
        <span className="text-[22px] font-medium text-white">{nombre || 'Nombre'}</span>
        {apagada && <span className="-mt-1.5 text-[14px] text-white/85">Sin profesionales en línea ahora</span>}
        {apagada ? (
          <span className="px-[18px] py-2 rounded-full border-[1.5px] border-white text-white text-[14px] font-medium">Sacá un turno</span>
        ) : (
          <span className="px-[18px] py-2 rounded-full bg-white text-text-primary text-[14px] font-medium">Empezar</span>
        )}
      </span>
    </div>
  )
}

function Swatch({ hex, nombre, elegido, sugerido, onClick }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.style.setProperty('--card-color', hex) }, [hex])
  return (
    <div className="flex flex-col items-center gap-1 w-14">
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title={`${nombre} ${hex}`}
        aria-label={`${nombre}${elegido ? ' (elegido)' : ''}`}
        aria-pressed={elegido}
        className={`od-card-color w-8 h-8 rounded-full transition-shadow ${elegido ? 'ring-2 ring-[#2D2A26] ring-offset-2 ring-offset-white' : ''}`}
      />
      <span className="text-[11px] leading-tight text-text-tertiary text-center">{nombre}</span>
      {sugerido && <span className="text-[12px] leading-none text-[#6B6560]">Sugerido</span>}
    </div>
  )
}

/** Switch de una herramienta: nombre + ayuda, el switch centrado con el nombre (Felipe). */
function FilaHerramienta({ nombre, ayuda, activa, onCambiar, children }) {
  return (
    <div className="py-3 first:pt-0 border-b border-[#E8E6E0] last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[15px] font-medium text-[#2D2A26]">{nombre}</span>
        <button
          type="button"
          onClick={() => onCambiar(!activa)}
          aria-pressed={activa}
          aria-label={`${activa ? 'Apagar' : 'Prender'} ${nombre}`}
          className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${activa ? 'bg-brand' : 'bg-gray-300'}`}
        >
          <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${activa ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <p className="text-[14px] leading-[1.4] text-[#6B6560] max-w-[60ch] mt-0.5">{ayuda}</p>
      {children}
    </div>
  )
}

export default function EditorVertical({ vertical, existentes = [], onGuardado, onCancelar, onVerEspecialidades }) {
  const esAlta = !vertical
  const [nombre, setNombre] = useState(vertical?.nombre ?? '')
  const [color, setColor] = useState(vertical?.fondo ?? '')
  const [colorTocado, setColorTocado] = useState(!esAlta)
  const [iconKey, setIconKey] = useState(vertical?.iconKey ?? (esAlta ? 'stethoscope' : 'stethoscope'))
  const [iconoTocado, setIconoTocado] = useState(!esAlta)
  const [imagen, setImagen] = useState(vertical?.imageUrl ?? null)   // URL ya subida
  const [archivo, setArchivo] = useState(null)                        // File nuevo, sin subir
  const [previewArchivo, setPreviewArchivo] = useState(null)
  const [precio, setPrecio] = useState('')
  const [otroHex, setOtroHex] = useState('')
  // Herramientas del profesional (migración 200). En el alta arrancan
  // prendidas (default de Felipe, avisado a Mateo).
  const [conHistoria, setConHistoria] = useState(vertical?.herramientas?.historiaClinica ?? true)
  const [conReceta, setConReceta] = useState(vertical?.herramientas?.receta ?? true)
  const { especialidades } = useEspecialidades()
  const espDeLaVertical = vertical
    ? especialidades.filter(e => e.verticalId === vertical.id && !e.parentId && e.active)
    : []
  const espConReceta = espDeLaVertical.filter(e => e.puedeRecetar).length
  const [guardando, setGuardando] = useState(false)
  const inputFileRef = useRef(null)

  const enUso = existentes.filter(v => v.id !== vertical?.id).map(v => v.fondo)
  const sugerido = colorSugerido(nombre, enUso)

  // En el alta, color e ícono siguen al nombre hasta que el admin los toque.
  useEffect(() => {
    if (!colorTocado) setColor(sugerido)
    if (!iconoTocado) setIconKey(iconoSugerido(nombre))
  }, [nombre, sugerido, colorTocado, iconoTocado])

  useEffect(() => () => { if (previewArchivo) URL.revokeObjectURL(previewArchivo) }, [previewArchivo])

  const colorFinal = color || sugerido
  const contraste = contrasteConBlanco(colorFinal)
  const pocoContraste = contraste != null && contraste < 3
  const esPreset = COLORES_PRESET.some(p => p.hex.toUpperCase() === (colorFinal || '').toUpperCase())

  const elegirArchivo = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const medida = await medirImagen(file)
    if (medida && (medida.w < MIN_W || medida.h < MIN_H)) {
      toast.warning(`La foto mide ${medida.w}×${medida.h}. Para que se vea nítida en el teléfono conviene al menos ${MIN_W}×${MIN_H}.`)
    }
    setArchivo(file)
    setPreviewArchivo(URL.createObjectURL(file))
  }

  const quitarImagen = () => { setArchivo(null); setPreviewArchivo(null); setImagen(null) }

  const aplicarOtro = () => {
    const hex = otroHex.trim().startsWith('#') ? otroHex.trim() : `#${otroHex.trim()}`
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { toast.warning('Escribí el color como #RRGGBB'); return }
    setColor(hex.toUpperCase()); setColorTocado(true)
  }

  const id = esAlta ? slugDe(nombre) : vertical.id
  const idRepetido = esAlta && id && existentes.some(v => v.id === id)

  const guardar = async () => {
    if (!nombre.trim()) { toast.warning('Poné un nombre'); return }
    if (esAlta && !id) { toast.warning('El nombre tiene que tener letras o números'); return }
    if (idRepetido) { toast.warning(`Ya existe una vertical "${nombre.trim()}"`); return }
    const precioNum = precio === '' ? null : Number(precio)
    if (precioNum !== null && (Number.isNaN(precioNum) || precioNum <= 0)) { toast.warning('El precio tiene que ser mayor a 0'); return }
    setGuardando(true)
    try {
      let imageUrl = imagen
      if (archivo) imageUrl = await verticalsService.uploadImage(id, archivo)
      const datos = { nombre: nombre.trim(), color: colorFinal, icon: iconKey, imageUrl, herramientaHistoriaClinica: conHistoria, herramientaReceta: conReceta }
      const guardada = esAlta
        ? await verticalsService.create({
          id, ...datos, ondemandPrice: precioNum,
          sortOrder: Math.max(0, ...existentes.map(v => v.sortOrder ?? 0)) + 1,
        })
        : await verticalsService.update(vertical.id, datos)
      toast.success(esAlta ? `${guardada.nombre} creada` : `${guardada.nombre} actualizada`)
      onGuardado(guardada)
    } catch (err) {
      toast.error(err?.message || 'No pudimos guardar la vertical')
    } finally {
      setGuardando(false)
    }
  }

  const imgPreview = previewArchivo || imagen

  return (
    <div className="card bg-bg-surface flex flex-col xl:flex-row gap-6">
      <div className="flex-1 min-w-0 space-y-5">
        <div>
          <label className="form-label">Nombre</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Odontología"
            className="form-input"
            autoFocus={esAlta}
          />
          {esAlta && id && (
            <p className={`text-xs mt-1 ${idRepetido ? 'text-danger' : 'text-text-tertiary'}`}>
              {idRepetido ? 'Ya existe una vertical con ese nombre.' : <>Se crea también la especialidad <span className="font-medium">{nombre.trim()}</span> para el onboarding.</>}
            </p>
          )}
        </div>

        {esAlta && (
          <div>
            <label className="form-label">Precio de la consulta inmediata <span className="text-text-tertiary text-xs">(opcional)</span></label>
            <div className="relative w-44">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm">$</span>
              <input type="number" min="1" step="1" value={precio} onChange={e => setPrecio(e.target.value)} placeholder="—" className="form-input pl-7" />
            </div>
            <p className="text-xs text-text-tertiary mt-1">Sin precio se crea apagada: no la ven los pacientes hasta que la prendas.</p>
          </div>
        )}

        <div>
          <label className="form-label">Foto de la tarjeta</label>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => inputFileRef.current?.click()} className="btn-secondary text-sm py-2 px-3 flex items-center gap-1.5">
              <UploadSimple className="h-4 w-4" /> {imgPreview ? 'Reemplazar' : 'Subir foto'}
            </button>
            {imgPreview && (
              <button type="button" onClick={quitarImagen} className="btn-secondary text-sm py-2 px-3 flex items-center gap-1.5">
                <Trash className="h-4 w-4" /> Quitar
              </button>
            )}
            <input ref={inputFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={elegirArchivo} />
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            Vertical, proporción 290:340, con lo importante arriba (abajo va el texto). Mínimo {MIN_W}×{MIN_H}. Sin foto, la tarjeta es del color.
          </p>
        </div>

        <div>
          <label className="form-label">Color de fondo en la app</label>
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {COLORES_PRESET.map(p => (
              <Swatch
                key={p.hex}
                hex={p.hex}
                nombre={p.nombre}
                elegido={p.hex.toUpperCase() === (colorFinal || '').toUpperCase()}
                sugerido={p.hex === sugerido}
                onClick={() => { setColor(p.hex); setColorTocado(true) }}
              />
            ))}
          </div>
          <div className="flex items-end gap-2 mt-3">
            <div>
              <label className="form-label text-xs">Otro</label>
              <input
                type="text"
                value={otroHex}
                onChange={e => setOtroHex(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aplicarOtro() } }}
                placeholder={esPreset ? '#RRGGBB' : colorFinal}
                className="form-input w-32 text-sm font-mono"
              />
            </div>
            <button type="button" onClick={aplicarOtro} className="btn-secondary text-sm py-2 px-3">Usar</button>
          </div>
          {pocoContraste && (
            <div className="flex items-start gap-2 mt-2 text-xs text-amber-800">
              <Warning className="h-4 w-4 shrink-0 text-amber-700" weight="fill" />
              <span>
                Poco contraste con texto blanco ({contraste.toFixed(1)}:1).{' '}
                <button type="button" className="underline font-medium" onClick={() => { setColor(oscurecerHasta(colorFinal, 3)); setColorTocado(true) }}>
                  Usar {oscurecerHasta(colorFinal, 3)}
                </button>, el mismo tono más oscuro.
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="form-label">Ícono</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ICONOS_VERTICAL).filter(([k]) => k !== 'siren').map(([clave, { icon: Icono, label }]) => (
              <button
                key={clave}
                type="button"
                onClick={() => { setIconKey(clave); setIconoTocado(true) }}
                title={label}
                aria-label={label}
                aria-pressed={iconKey === clave}
                className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-colors ${iconKey === clave ? 'border-[#2D2A26] bg-white text-text-primary' : 'border-border-default bg-white text-text-tertiary hover:text-text-primary'}`}
              >
                <Icono className="h-5 w-5" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="form-label">Herramientas del profesional</label>
          <div>
            <FilaHerramienta
              nombre="Historia clínica"
              ayuda="Ve y carga la historia clínica del paciente durante la consulta."
              activa={conHistoria}
              onCambiar={setConHistoria}
            />
            <FilaHerramienta
              nombre="Receta electrónica"
              ayuda="Puede emitir recetas de medicamentos y órdenes de estudios."
              activa={conReceta}
              onCambiar={setConReceta}
            >
              {conReceta && vertical && espDeLaVertical.length > 0 && (
                <p className={`text-[14px] mt-1 ${espConReceta === 0 ? 'text-[#B2633F]' : 'text-[#6B6560]'}`}>
                  {espConReceta === 0
                    ? 'Ninguna especialidad la tiene habilitada'
                    : `Habilitada en ${espConReceta} de ${espDeLaVertical.length} especialidad${espDeLaVertical.length === 1 ? '' : 'es'}`}
                  {onVerEspecialidades && (
                    <> · <button type="button" onClick={onVerEspecialidades} className="underline">Ver especialidades</button></>
                  )}
                </p>
              )}
            </FilaHerramienta>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={guardar} disabled={guardando || !nombre.trim() || idRepetido} className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5 disabled:opacity-40">
            {guardando ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</> : <><Check className="h-4 w-4" /> {esAlta ? 'Crear vertical' : 'Guardar'}</>}
          </button>
          <button type="button" onClick={onCancelar} className="btn-secondary text-sm py-2 px-4">Cancelar</button>
        </div>
      </div>

      <PreviewCarrusel color={colorFinal}>
        <TarjetaPreview nombre={nombre} color={colorFinal} iconKey={iconKey} img={imgPreview} precio={esAlta ? precio : vertical?.onDemandPrice} />
        <TarjetaPreview nombre={nombre} color={colorFinal} iconKey={iconKey} img={imgPreview} precio={esAlta ? precio : vertical?.onDemandPrice} apagada />
      </PreviewCarrusel>
    </div>
  )
}

/** El fondo de la sección "Atención inmediata", con el degradé del color. */
function PreviewCarrusel({ color, children }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.style.setProperty('--gradient-color', color) }, [color])
  return (
    <div className="shrink-0">
      <p className="form-label">Vista previa — encendida y sin nadie en línea</p>
      <div className="relative rounded-2xl overflow-hidden">
        <div ref={ref} className="absolute inset-0 od-gradient-bg" />
        <div className="relative flex gap-3 p-5 overflow-x-auto">{children}</div>
      </div>
    </div>
  )
}
