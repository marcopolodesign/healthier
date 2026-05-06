import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import mermaid from 'mermaid'

const ALL_SECTIONS = [
  {
    label: 'Público', color: 'bg-gray-100 text-gray-700',
    pages: [
      { label: 'Landing', route: '/', desc: 'Página de inicio' },
      { label: 'Login', route: '/login', desc: 'Iniciar sesión' },
      { label: 'Registro', route: '/registro', desc: 'Crear cuenta' },
    ],
  },
  {
    label: 'Paciente', color: 'bg-teal-100 text-teal-700',
    pages: [
      { label: 'Dashboard', route: '/paciente/dashboard', desc: 'Inicio paciente' },
      { label: 'Buscar profesionales', route: '/paciente/buscar', desc: 'Búsqueda y filtros' },
      { label: 'Perfil del profesional', route: '/paciente/profesional/:id', desc: 'Vista pública del profesional' },
      { label: 'Agendar consulta', route: '/paciente/agendar/:id', desc: 'Reserva con Calendly' },
      { label: 'Mis consultas', route: '/paciente/consultas', desc: 'Historial' },
      { label: 'Mis documentos', route: '/paciente/documentos', desc: 'Archivos clínicos' },
      { label: 'Mi perfil', route: '/paciente/perfil', desc: 'Editar perfil' },
    ],
  },
  {
    label: 'Profesional', color: 'bg-blue-100 text-blue-700',
    pages: [
      { label: 'Onboarding', route: '/profesional/onboarding', desc: 'Registro inicial' },
      { label: 'Dashboard', route: '/profesional/dashboard', desc: 'Inicio profesional' },
      { label: 'Mi agenda', route: '/profesional/agenda', desc: 'Gestión de agenda' },
      { label: 'Detalle consulta', route: '/profesional/consulta/:id', desc: 'Detalle de consulta' },
      { label: 'Mi perfil', route: '/profesional/perfil', desc: 'Editar perfil' },
    ],
  },
  {
    label: 'Admin', color: 'bg-purple-100 text-purple-700',
    pages: [
      { label: 'Verificación', route: '/admin/profesionales', desc: 'Aprobar profesionales' },
      { label: 'Usuarios', route: '/admin/usuarios', desc: 'Gestión de usuarios' },
      { label: 'Consultas', route: '/admin/consultas', desc: 'Todas las consultas' },
    ],
  },
  {
    label: 'Super Admin', color: 'bg-orange-100 text-orange-700',
    pages: [
      { label: 'Dashboard', route: '/super-admin/dashboard', desc: 'Métricas globales' },
      { label: 'Admins', route: '/super-admin/admins', desc: 'Gestión de admins' },
      { label: 'Configuración', route: '/super-admin/settings', desc: 'Ajustes del sistema' },
    ],
  },
]

const DIAGRAM_DEF = `flowchart TD
  LAND["🏠 Landing\\n/"] --> LOGIN["🔐 Login\\n/login"]
  LAND --> REG["📝 Registro\\n/registro"]

  LOGIN -->|paciente| PAT_DASH
  LOGIN -->|profesional| PRO_DASH
  LOGIN -->|admin| ADM_PROF
  LOGIN -->|super_admin| SA_DASH
  REG -->|paciente| PAT_DASH
  REG -->|profesional| PRO_ONB

  subgraph PAT["👤 Paciente"]
    PAT_DASH["Dashboard"] --> PAT_SRC["Buscar"]
    PAT_SRC --> PAT_PROF["Perfil profesional"]
    PAT_PROF --> PAT_BOOK["Agendar"]
    PAT_DASH --> PAT_CON["Consultas"]
    PAT_DASH --> PAT_DOC["Documentos"]
    PAT_DASH --> PAT_PRF["Mi perfil"]
  end

  subgraph PRO["🩺 Profesional"]
    PRO_ONB["Onboarding"] --> PRO_DASH["Dashboard"]
    PRO_DASH --> PRO_AGE["Agenda"]
    PRO_AGE --> PRO_DET["Detalle consulta"]
    PRO_DASH --> PRO_PRF["Mi perfil"]
  end

  subgraph ADM["🛡️ Admin"]
    ADM_PROF["Profesionales"]
    ADM_USR["Usuarios"]
    ADM_CON["Consultas"]
  end

  subgraph SA["⚡ Super Admin"]
    SA_DASH["Dashboard"] --> ADM_PROF
    SA_DASH --> ADM_USR
    SA_DASH --> SA_ADM["Admins"]
    SA_DASH --> SA_SET["Configuración"]
  end

  click LAND call _healthierNav "/"
  click LOGIN call _healthierNav "/login"
  click REG call _healthierNav "/registro"
  click PAT_DASH call _healthierNav "/paciente/dashboard"
  click PAT_SRC call _healthierNav "/paciente/buscar"
  click PAT_CON call _healthierNav "/paciente/consultas"
  click PAT_DOC call _healthierNav "/paciente/documentos"
  click PAT_PRF call _healthierNav "/paciente/perfil"
  click PRO_ONB call _healthierNav "/profesional/onboarding"
  click PRO_DASH call _healthierNav "/profesional/dashboard"
  click PRO_AGE call _healthierNav "/profesional/agenda"
  click PRO_PRF call _healthierNav "/profesional/perfil"
  click ADM_PROF call _healthierNav "/admin/profesionales"
  click ADM_USR call _healthierNav "/admin/usuarios"
  click ADM_CON call _healthierNav "/admin/consultas"
  click SA_DASH call _healthierNav "/super-admin/dashboard"
  click SA_ADM call _healthierNav "/super-admin/admins"
  click SA_SET call _healthierNav "/super-admin/settings"
`

export default function IndexSidecart({ isOpen, onClose }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('list')
  const flowRef = useRef(null)

  useEffect(() => {
    if (activeTab !== 'flow' || !isOpen) return

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: {
        primaryColor: '#f5eee1',
        primaryTextColor: '#b05a36',
        primaryBorderColor: '#b05a36',
        lineColor: '#8e4529',
        secondaryColor: '#fef9ef',
        tertiaryColor: '#d1c9bf',
      },
      flowchart: { curve: 'basis', padding: 20 },
    })

    window._healthierNav = (path) => {
      navigate(path)
      onClose()
    }

    const id = 'healthier-flow-' + Date.now()
    mermaid.render(id, DIAGRAM_DEF).then(({ svg }) => {
      if (flowRef.current) {
        flowRef.current.innerHTML = svg
        // Make SVG responsive
        const svgEl = flowRef.current.querySelector('svg')
        if (svgEl) {
          svgEl.style.width = '100%'
          svgEl.style.height = 'auto'
        }
      }
    }).catch(console.error)
  }, [activeTab, isOpen])

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div className={`
        fixed top-0 left-0 h-full w-[480px] bg-white z-50 flex flex-col shadow-2xl
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
          <h2 className="font-bold text-base text-text-primary">
            Índice de pantallas
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-muted hover:bg-bg-surface hover:text-text-primary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border-default shrink-0">
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'list'
                ? 'text-brand border-b-2 border-brand'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Lista
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'flow'
                ? 'text-brand border-b-2 border-brand'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Flujo
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'list' ? (
            <ListView navigate={navigate} onClose={onClose} />
          ) : (
            <div ref={flowRef} className="p-4 overflow-auto min-h-full" />
          )}
        </div>
      </div>
    </>
  )
}

function ListView({ navigate, onClose }) {
  return (
    <div className="p-4 space-y-5">
      {ALL_SECTIONS.map(section => (
        <div key={section.label}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${section.color}`}>
              {section.label}
            </span>
          </div>
          <div className="space-y-1">
            {section.pages.map(page => {
              const hasParam = page.route.includes(':')
              return (
                <div
                  key={page.route}
                  onClick={hasParam ? undefined : () => { navigate(page.route); onClose() }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    hasParam
                      ? 'opacity-60 cursor-default'
                      : 'cursor-pointer hover:bg-bg-surface'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">{page.label}</div>
                    <div className="text-xs text-text-muted truncate">{page.desc}</div>
                  </div>
                  <code className="text-xs text-text-muted bg-bg-surface px-1.5 py-0.5 rounded shrink-0 max-w-[160px] truncate">
                    {page.route}
                  </code>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
