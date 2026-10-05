import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CompanyLogo } from '../components/common/CompanyLogo'
import './guia.css'
import MARCAS from './marcas.json'
import { GLOSARIO, GUIAS, VIAJE_CONSULTA } from './contenido'
import { GUIA_DE_ROL, GUIAS_PUBLICAS } from './roles'
import { ROLE_REDIRECTS } from '../lib/roleRedirects'

/**
 * La guía de uso por rol: /guia (todas) y /guia/<rol>.
 *
 * Las de paciente, profesional, farmacia y emergencias se abren sin sesión
 * (Mateo, 2026-10-05): se reenvían por WhatsApp antes del primer ingreso. La
 * del super admin pide una sesión de super_admin.
 *
 * Copia de la guía de Picnic. Las capturas son de la plataforma de verdad
 * (scripts/guia/) y los números se ubican con lo que midió ese script sobre la
 * pantalla —el DOM en la web, el árbol de accesibilidad en la app—, no a ojo.
 *
 * Sin `style={{}}`: las posiciones medidas entran como variables CSS por ref.
 */

const ORDEN = ['paciente', 'profesional', 'farmacia', 'emergencias', 'super-admin']

/** Pone variables CSS sobre un nodo sin usar `style={{}}` (regla del repo). */
const conVars = (vars) => (el) => {
  if (!el) return
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
}

export default function PaginaGuia({ profile }) {
  const { rol } = useParams()
  const propia = profile ? GUIA_DE_ROL[profile.role] : undefined
  const esSuperAdmin = profile?.role === 'super_admin'
  const roles = ORDEN.filter((r) => GUIAS_PUBLICAS.includes(r) || (r === 'super-admin' && esSuperAdmin))
  const guia = rol && GUIAS[rol] ? GUIAS[rol] : null

  useEffect(() => {
    document.title = guia ? `Guía de uso · ${guia.nombre} · Healthier` : 'Guía de uso · Healthier'
    // Si llega con un #sección (un link reenviado), va ahí; si no, arriba de todo.
    const destino = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null
    if (destino) requestAnimationFrame(() => destino.scrollIntoView())
    else window.scrollTo(0, 0)
    return () => { document.title = 'Healthier' }
  }, [guia])

  useEntradas(guia?.slug ?? 'inicio')

  // La del super admin, sólo con su sesión. Sin sesión, al login.
  if (rol === 'super-admin' && !esSuperAdmin) {
    return <Navigate to={profile ? '/guia' : '/login'} replace />
  }
  if (rol && !guia) return <Navigate to="/guia" replace />

  return (
    <div className="guia">
      <header className="g-barra">
        <Link className="g-marca" to="/guia">
          <CompanyLogo size="sm" inverted />
          <small>Guía de uso</small>
        </Link>
        <nav className="g-roles" aria-label="Guías">
          {roles.map((r) => (
            <Link key={r} to={`/guia/${r}`} className={r === guia?.slug ? 'on' : undefined}>
              {GUIAS[r].nombre}{r === propia && <i className="g-vos">vos</i>}
            </Link>
          ))}
        </nav>
        <Link className="g-volver" to={profile ? (ROLE_REDIRECTS[profile.role] || '/') : '/login'}>
          {profile ? '← Volver a Healthier' : 'Entrar'}
        </Link>
      </header>
      {guia ? <GuiaDeRol guia={guia} roles={roles} /> : <Inicio propia={propia} roles={roles} />}
    </div>
  )
}

// ── /guia ────────────────────────────────────────────────────────────────────
function Inicio({ propia, roles }) {
  return (
    <main className="g-cuerpo">
      <section className="g-heroe g-heroe-inicio">
        <p className="g-ceja">Guía de uso</p>
        <h1>Todo lo que hace Healthier, <span>contado para cada uno.</span></h1>
        <p className="g-bajada">
          Elegí tu guía. Cada una tiene lo que resolvés con la plataforma, tu día en pocos pasos, las
          pantallas que usás con sus partes señaladas y las dudas de siempre.
        </p>
      </section>
      <div className="g-tarjetas-roles">
        {roles.map((r) => {
          const g = GUIAS[r]
          return (
            <Link key={r} to={`/guia/${r}`} className={`g-tarjeta-rol${r === propia ? ' propia' : ''}`}>
              <IconoRol rol={r} />
              <span className="g-para">{g.para}{r === propia && <i className="g-vos">tu guía</i>}</span>
              <b>{g.mision}</b>
              <span className="g-ficha-mini">{g.ficha[0][1]} · {g.ficha[1][1]}</span>
              <span className="g-abrir">Abrir la guía →</span>
            </Link>
          )
        })}
      </div>
      <Viaje viaje={VIAJE_CONSULTA} />
      <Pie roles={roles} />
    </main>
  )
}

// ── /guia/<rol> ──────────────────────────────────────────────────────────────
function GuiaDeRol({ guia, roles }) {
  const indice = useMemo(() => [
    { id: 'tu-dia', t: 'Tu día' },
    { id: 'podes', t: 'Lo que podés hacer' },
    ...guia.secciones.map((s) => ({ id: s.id, t: s.titulo, grupo: s.grupo })),
    { id: 'dudas', t: '¿Qué pasa si…?' },
    { id: 'palabras', t: 'Palabras de la plataforma' },
  ], [guia])
  const activa = useScrollspy(indice.map((i) => i.id))

  return (
    <main className="g-cuerpo g-con-indice">
      <aside className="g-indice" aria-label="En esta guía">
        <p className="g-ceja">En esta guía</p>
        {indice.map((i, k) => (
          <span key={i.id} className="g-indice-item">
            {i.grupo && i.grupo !== indice[k - 1]?.grupo && <span className="g-indice-grupo">{i.grupo}</span>}
            <a href={`#${i.id}`} className={activa === i.id ? 'on' : undefined}>{i.t}</a>
          </span>
        ))}
        <button type="button" className="g-imprimir" onClick={() => window.print()}>Guardar como PDF</button>
      </aside>

      <div className="g-contenido">
        <section className="g-heroe">
          <div>
            <p className="g-ceja"><IconoRol rol={guia.slug} chico /> Guía para {guia.para.toLowerCase()}</p>
            <h1>{guia.mision}</h1>
            <p className="g-bajada">{guia.bajada}</p>
          </div>
          <dl className="g-ficha">
            {guia.ficha.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>

        <section id="tu-dia" className="g-bloque">
          <h2>Tu día, en {guia.dia.length} pasos</h2>
          <ol className="g-dia">
            {guia.dia.map((d, i) => (
              <li key={d.titulo}><span className="g-num">{i + 1}</span><b>{d.titulo}</b><span>{d.texto}</span></li>
            ))}
          </ol>
          {guia.viajes.map((v) => <Viaje key={v.titulo} viaje={v} rol={guia.slug} />)}
        </section>

        <section id="podes" className="g-bloque">
          <h2>Lo que podés hacer</h2>
          <div className="g-puede">
            {guia.puede.map((p) => (
              <a key={p.titulo} href={`#${p.ir}`}><b>{p.titulo}</b><span>{p.texto}</span><i>Ver cómo →</i></a>
            ))}
          </div>
        </section>

        {guia.secciones.map((s, i) => <Parte key={s.id} s={s} n={i + 1} />)}

        <section id="dudas" className="g-bloque">
          <h2>¿Qué pasa si…?</h2>
          <div className="g-faq">
            {guia.faq.map((f) => (
              <details key={f.p}><summary>{f.p}</summary><p>{f.r}</p></details>
            ))}
          </div>
        </section>

        <section id="palabras" className="g-bloque">
          <h2>Palabras de la plataforma</h2>
          <dl className="g-glosario">
            {guia.glosario.map((k) => <div key={k}><dt>{k}</dt><dd>{GLOSARIO[k]}</dd></div>)}
          </dl>
        </section>

        <div className="g-ayuda">
          <b>{guia.ayuda}</b>
          <span>Esta guía se actualiza con la plataforma: las capturas son de la versión que estás usando.</span>
        </div>
        <Pie actual={guia.slug} roles={roles} />
      </div>
    </main>
  )
}

function Parte({ s, n }) {
  const medida = s.captura ? MARCAS[s.captura] : undefined
  const movil = !!medida?.movil
  const [activa, setActiva] = useState(null)
  const numeros = medida?.marcas.filter((m) => s.marcas?.[m.n]) ?? []

  const leyenda = (
    <div className="g-leyenda">
      {numeros.length > 0 && (
        <ol>
          {numeros.map((m) => (
            <li key={m.n} className={activa === m.n ? 'on' : undefined}
                onMouseEnter={() => setActiva(m.n)} onMouseLeave={() => setActiva(null)}>
              <span className="g-pin">{m.n}</span><span>{s.marcas[m.n]}</span>
            </li>
          ))}
        </ol>
      )}
      {s.pasos && (
        <div className="g-como">
          <p className="g-ceja">Paso a paso</p>
          <ol>{s.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
        </div>
      )}
      {s.tips?.map((t) => (
        <p key={t.texto} className={`g-tip g-${t.tipo}`}><b>{t.tipo === 'tip' ? 'Tip' : 'Ojo'}</b>{t.texto}</p>
      ))}
    </div>
  )

  return (
    <section id={s.id} className={`g-bloque g-parte${movil ? ' g-parte-movil' : ''}`}>
      <p className="g-n">{String(n).padStart(2, '0')}{s.grupo && <span> · {s.grupo}</span>}</p>
      <h2>{s.titulo}</h2>
      <p className="g-bajada">{s.bajada}</p>
      {medida ? (
        <div className="g-parte-cuerpo">
          <Captura id={s.captura} medida={medida} marcas={numeros} activa={activa} setActiva={setActiva} titulo={s.titulo} />
          {leyenda}
        </div>
      ) : leyenda}
    </section>
  )
}

function Captura({ id, medida, marcas, activa, setActiva, titulo }) {
  const [grande, setGrande] = useState(false)
  const movil = medida.movil
  useEffect(() => {
    if (!grande) return
    const esc = (e) => e.key === 'Escape' && setGrande(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [grande])

  const pantalla = (conMarcas) => (
    <div className="g-pantalla" ref={conVars({ '--ar': `${medida.ancho} / ${medida.alto}` })}>
      <img src={`/guia-img/${id}.jpg`} alt={titulo} loading="lazy" width={medida.ancho} height={medida.alto} />
      {conMarcas && marcas.map((m) => (
        <span key={m.n}
              ref={conVars({ '--x': `${m.x}%`, '--y': `${m.y}%`, '--w': `${m.w}%`, '--h': `${m.h}%` })}
              className={`g-zona${activa === m.n ? ' on' : ''}${m.x < 3 || m.y < 3 ? ' borde' : ''}`}
              onMouseEnter={() => setActiva(m.n)} onMouseLeave={() => setActiva(null)}>
          <span className="g-pin">{m.n}</span>
        </span>
      ))}
    </div>
  )

  return (
    <>
      <figure className={movil ? 'g-telefono' : 'g-navegador'}>
        {!movil && <div className="g-nav-barra"><i /><i /><i /><span>gethealthier.vercel.app</span></div>}
        <button type="button" className="g-agrandar" onClick={() => setGrande(true)} title="Ver en grande">{pantalla(true)}</button>
        <figcaption className="g-donde">{medida.app ? 'En la app' : movil ? 'En la web, desde el teléfono' : 'En la web'}</figcaption>
      </figure>
      {grande && (
        <div className="g-lupa" onClick={() => setGrande(false)} role="dialog" aria-label={titulo}>
          <div className={movil ? 'g-lupa-movil' : undefined}>{pantalla(false)}</div>
          <span className="g-lupa-cerrar">Cerrar ✕</span>
        </div>
      )}
    </>
  )
}

/** Cómo viaja algo por la plataforma, con "vos" donde está cada uno. */
function Viaje({ viaje, rol }) {
  return (
    <div className="g-viaje">
      <p className="g-ceja">{viaje.titulo}</p>
      <ol>
        {viaje.pasos.map((v, i) => {
          const vos = rol && v.rol === rol
          return (
            <li key={i} className={vos ? 'vos' : undefined}>
              <IconoRol rol={v.rol} chico />
              <b>{v.titulo}</b>
              <span>{v.texto}</span>
              {vos && <i className="g-vos">vos</i>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Pie({ actual, roles }) {
  return (
    <footer className="g-pie">
      <span>Las otras guías:</span>
      {roles.filter((r) => r !== actual).map((r) => <Link key={r} to={`/guia/${r}`}>{GUIAS[r].nombre}</Link>)}
      <span className="g-pie-firma">Healthier · United Health S.A.</span>
    </footer>
  )
}

function IconoRol({ rol, chico }) {
  const t = chico ? 15 : 26
  const p = { width: t, height: t, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', className: 'g-icono' }
  // Paciente: un corazón con pulso
  if (rol === 'paciente') return <svg {...p}><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z" /><path d="M7 12h2.5l1.5-2.5 2 5 1.5-2.5H17" /></svg>
  // Profesional: estetoscopio
  if (rol === 'profesional') return <svg {...p}><path d="M5 3v6a5 5 0 0 0 10 0V3" /><path d="M10 14v2a5 5 0 0 0 10 0v-3" /><circle cx="20" cy="11" r="2" /></svg>
  // Farmacia: cruz en una bolsa
  if (rol === 'farmacia') return <svg {...p}><rect x="4" y="6" width="16" height="15" rx="2.5" /><path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" /><path d="M12 10.5v6M9 13.5h6" /></svg>
  // Emergencias: sirena
  if (rol === 'emergencias') return <svg {...p}><path d="M6 18v-5a6 6 0 0 1 12 0v5" /><path d="M4 21h16v-3H4Z" /><path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4" /></svg>
  // Super admin: tablero
  return <svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
}

/** Qué sección se está leyendo, para marcarla en el índice. */
function useScrollspy(ids) {
  const [activa, setActiva] = useState(ids[0])
  useEffect(() => {
    const obs = new IntersectionObserver((entradas) => {
      const visible = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setActiva(visible.target.id)
    }, { rootMargin: '-15% 0px -70% 0px' })
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [ids])
  return activa
}

/**
 * Las entradas suaves: cada grupo aparece en cascada cuando llega a la
 * pantalla, una sola vez. Con "reducir movimiento" no se anima nada (CSS).
 */
const GRUPOS = [
  '.g-heroe > *, .g-heroe .g-ficha > div',
  '.g-tarjetas-roles > *',
  '.g-dia > li',
  '.g-viaje li',
  '.g-puede > a',
  '.g-parte > .g-n, .g-parte > h2, .g-parte > .g-bajada, .g-parte .g-navegador, .g-parte .g-telefono',
  '.g-leyenda li, .g-como, .g-tip',
  '.g-zona',
  '.g-faq details',
  '.g-glosario > div',
  '.g-ayuda, .g-pie',
]
function useEntradas(clave) {
  useEffect(() => {
    const raiz = document.querySelector('.guia')
    if (!raiz || !('IntersectionObserver' in window)) return
    const obs = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add('visto'); obs.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    for (const sel of GRUPOS) {
      // El orden de la cascada se cuenta por contenedor: cada bloque arranca de cero.
      const porPadre = new Map()
      raiz.querySelectorAll(sel).forEach((el) => {
        const padre = el.closest('.g-parte, .g-bloque, .g-heroe, section, footer') ?? raiz
        const i = porPadre.get(padre) ?? 0
        porPadre.set(padre, i + 1)
        el.style.setProperty('--i', String(Math.min(i, 10)))
        el.classList.add('g-entra')
        obs.observe(el)
      })
    }
    return () => obs.disconnect()
  }, [clave])
}
