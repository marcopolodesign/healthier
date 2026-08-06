import { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useNavigate, useLocation, useParams } from 'react-router-dom'
import { ToastContainer, toast } from './components/Toast'
import AppLayout from './layouts/AppLayout'
import AuthLayout from './layouts/AuthLayout'
import PatientMobileLayout from './layouts/PatientMobileLayout'
import { authService } from './services/authService'
import { supabase } from './lib/supabase'
import { professionalService } from './services/professionalService'
import { setAnalyticsUser, clearAnalyticsUser } from './utils/analytics'
import {
  cioIdentify,
  cioIdentifyProfessional,
  cioReset,
  cioPage,
  installClickAutocapture,
  installPathMasking,
} from './utils/customerio'

// Enmascarado de URLs: se instala al cargar el módulo, antes de que React monte
// y antes del primer `page()`, para que ningún evento salga con la ruta cruda.
installPathMasking()

// Pages
import Landing from './pages/Landing'
import LandingPediatria from './pages/landing/Pediatria'
import LandingSinCoberturaMedica from './pages/landing/SinCoberturaMedica'
import LandingMedicoOnline from './pages/landing/MedicoOnline'
import LandingProfesionales from './pages/landing/Profesionales'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import RegisterProfessional from './pages/auth/RegisterProfessional'
import CompleteProfile from './pages/auth/CompleteProfile'
import TerminosYCondiciones from './pages/TerminosYCondiciones'

import PatientDashboard from './pages/patient/Dashboard'
import PatientOnboarding from './pages/patient/Onboarding'
import PatientSearch from './pages/patient/Search'
import ProfessionalProfile from './pages/patient/ProfessionalProfile'
import PatientConsultations from './pages/patient/Consultations'
import PatientDocuments from './pages/patient/Documents'
import PatientProfile from './pages/patient/Profile'
import OnDemand from './pages/patient/OnDemand'
import Emergency from './pages/patient/Emergency'

import ProfessionalDashboard from './pages/professional/Dashboard'
import ProfessionalOnboarding from './pages/professional/Onboarding'
import ProfessionalAgenda from './pages/professional/Agenda'
import ConsultationDetail from './pages/professional/ConsultationDetail'
import ProfessionalProfileEdit from './pages/professional/Profile'
import ProfessionalVideoCall from './pages/professional/VideoCall'
import NutriPlan from './pages/professional/NutriPlan'
import ProfessionalEmergencias from './pages/professional/Emergencias'
import HistoriaClinica from './pages/professional/HistoriaClinica'
import ProfessionalHistorial from './pages/professional/Historial'
import ProfessionalPatientProfile from './pages/professional/PatientProfile'
import ProfessionalPacientes from './pages/professional/Pacientes'
import ProfessionalGanancias from './pages/professional/Ganancias'
import ProfessionalConfiguracion from './pages/professional/Configuracion'
import ProfessionalAyuda from './pages/professional/Ayuda'
import PatientBiovisor from './pages/patient/Biovisor'
import PatientNutriPlan from './pages/patient/NutriPlan'
import PatientPharmacy from './pages/patient/Pharmacy'
import PatientComprobantes from './pages/patient/Comprobantes'
import PatientVideoCall from './pages/patient/VideoCall'
import HistoriaClinicaPaciente from './pages/paciente/HistoriaClinicaPaciente'
import WaitingRoom from './pages/patient/WaitingRoom'
import ConsultationReview from './pages/patient/ConsultationReview'
import ReservarConsulta from './pages/patient/ReservarConsulta'
import PaymentPage from './pages/patient/PaymentPage'
import PatientAIChat from './pages/patient/PatientAIChat'
import WalkInQueue from './pages/patient/WalkInQueue'
import HealthSnapshot from './pages/patient/HealthSnapshot'
import BookingConfirmed from './pages/patient/BookingConfirmed'

import AdminProfessionals from './pages/admin/Professionals'
import AdminUsers from './pages/admin/Users'
import AdminConsultations from './pages/admin/Consultations'

import SuperAdminDashboard from './pages/super-admin/Dashboard'
import SuperAdminAdmins from './pages/super-admin/Admins'
import SuperAdminPayments from './pages/super-admin/Payments'
import SuperAdminConsultas from './pages/super-admin/Consultas'
import SuperAdminSettings from './pages/super-admin/Settings'
import SuperAdminZones from './pages/super-admin/Zones'
import SuperAdminVerticales from './pages/super-admin/Verticales'
import SuperAdminAuditoria from './pages/super-admin/Auditoria'
import SuperAdminUsuarios from './pages/super-admin/Usuarios'
import SuperAdminUsuariosProspects from './pages/super-admin/UsuariosProspects'
import SuperAdminProfesionales from './pages/super-admin/Profesionales'
import SuperAdminEmergencias from './pages/super-admin/Emergencias'

// ── Role guards ──────────────────────────────────────────
const ROLE_REDIRECTS = {
  patient: '/paciente/dashboard',
  professional: '/profesional/dashboard',
  admin: '/admin/profesionales',
  super_admin: '/super-admin/dashboard',
}

// Ver el comentario de la ruta `/paciente/agendar/:id`.
function RedirectToProfesional() {
  const { id } = useParams()
  return <Navigate to={`/paciente/profesional/${id}`} replace />
}

function RequireRole({ profile, allowed, children }) {
  if (!profile) return <Navigate to="/login" replace />
  if (!allowed.includes(profile.role)) {
    return <Navigate to={ROLE_REDIRECTS[profile.role] || '/'} replace />
  }
  return children
}

// ── Post-auth redirect: new Google users → complete profile;
//    already-logged-in users landing on /login or /registro → their dashboard ──
const AUTH_PATHS = ['/login', '/registro', '/registro-profesional', '/completar-registro']

function AuthRedirectHandler({ profile, authUser }) {
  const navigate = useNavigate()
  const location = useLocation()
  const needsCompletion = !!authUser && !profile

  useEffect(() => {
    // A Google user without a `profiles` row must finish role selection no
    // matter where they land — not just on the 4 known auth paths. The OAuth
    // full-page redirect can land on "/" (e.g. Site URL fallback when the
    // exact redirectTo isn't in Supabase's allow list), and without this the
    // user gets stranded on the public landing page looking logged out while
    // actually holding a live session with no profile (reported 2026-08-03,
    // repro'd locally: authUser set, profile null, stuck on "/").
    if (needsCompletion) {
      if (location.pathname !== '/completar-registro') {
        navigate('/completar-registro', { replace: true })
      }
      return
    }

    if (!AUTH_PATHS.includes(location.pathname)) return
    if (profile && location.pathname !== '/completar-registro') {
      navigate(ROLE_REDIRECTS[profile.role] || '/', { replace: true })
    }
  }, [profile, needsCompletion, location.pathname])

  return null
}

// ── Customer.io: pageview por cada cambio de ruta ────────
// El snippet de index.html sólo dispara la primera. En una SPA el resto de la
// navegación es invisible para Customer.io sin esto.
function CioPageTracker() {
  const location = useLocation()
  useEffect(() => {
    cioPage(location.pathname)
  }, [location.pathname])
  return null
}

// ── Protected layout wrapper ─────────────────────────────
function ProtectedLayout({ profile, allowed }) {
  return (
    <RequireRole profile={profile} allowed={allowed}>
      <AppLayout profile={profile}>
        <Outlet />
      </AppLayout>
    </RequireRole>
  )
}

// ── Main App ─────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [profSpecialty, setProfSpecialty] = useState(null)
  const [loading, setLoading] = useState(true)

  // `loadProfSpecialty` corre dentro del callback de onAuthStateChange, donde
  // el `profile` del closure puede estar viejo. El ref siempre tiene el último.
  const profileRef = useRef(null)
  profileRef.current = profile

  const loadProfSpecialty = async (userId) => {
    try {
      const pp = await professionalService.getByUserId(userId)
      setProfSpecialty(pp?.specialty ?? null)
      // Customer.io: la especialidad y el precio son atributos del PROFESIONAL
      // (dato profesional, no de salud), así que acá sí van. Es además lo que
      // deja segmentar campañas por especialidad sin tocar datos del paciente.
      if (pp) cioIdentifyProfessional({ ...profileRef.current, id: userId }, pp)
    } catch {
      // non-critical — sidebar just won't show specialty-gated items
    }
  }

  useEffect(() => {
    // Initial session check
    const init = async () => {
      try {
        const user = await authService.getCurrentUser()
        if (user) {
          const p = await authService.getCurrentUserProfile(user.id)
          if (p) {
            setProfile(p)
            if (p.role === 'professional') loadProfSpecialty(user.id)
          } else {
            setAuthUser(user)
          }
        }
      } catch (err) {
        // Sesión inicial: un fallo acá (red, Supabase caído) antes se
        // tragaba en silencio y la app quedaba viendo el login sin
        // explicación. Mostrar el motivo real (regla de Mateo).
        toast.error(`No pudimos verificar tu sesión: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }
    init()

    // Auth state listener
    const { data: { subscription } } = authService.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        try {
          const p = await authService.getCurrentUserProfile(session.user.id)
          if (p) {
            setProfile(p)
            setAuthUser(null)
            if (p.role === 'professional') loadProfSpecialty(session.user.id)
          } else {
            setAuthUser(session.user)
          }
        } catch (err) {
          // Sin try/catch acá el rechazo quedaba sin manejar: no pasaba
          // nada visible, ni error ni pantalla de completar perfil.
          toast.error(`No pudimos cargar tu perfil: ${err.message}`)
        }
      } else if (event === 'SIGNED_OUT') {
        setProfile(null)
        setAuthUser(null)
        setProfSpecialty(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Analytics user identity — hashed user_id + user_type. Depend on id/role
  // only (not the whole profile object) so editing profile fields elsewhere
  // doesn't trigger a redundant re-hash of the same id.
  useEffect(() => {
    if (profile) setAnalyticsUser(profile)
    else clearAnalyticsUser()
  }, [profile?.id, profile?.role])

  // Customer.io identify — ÚNICO punto de identidad para toda la app.
  //
  // No hace falta instrumentar cada login por separado (email+password, Google,
  // registro paciente, registro profesional, completar-perfil, restore de
  // sesión): todos terminan en `setProfile(...)`, así que todos pasan por acá.
  //
  // Depende también de email/phone/name — a diferencia del efecto de GTM de
  // arriba — para que editar el teléfono en Perfil actualice el atributo en
  // Customer.io. Sin el teléfono al día no sale el WhatsApp.
  useEffect(() => {
    if (profile) cioIdentify(profile)
    else cioReset()
  }, [profile?.id, profile?.role, profile?.email, profile?.phone, profile?.fullName])

  // Auto-capture de clicks sitewide. Se instala una sola vez.
  useEffect(() => installClickAutocapture(), [])

  const handleLogin = (p) => setProfile(p)
  const handleProfileComplete = (p) => {
    setProfile(p)
    setAuthUser(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-text-secondary text-sm">Cargando...</span>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <ToastContainer />
      <AuthRedirectHandler profile={profile} authUser={authUser} />
      <CioPageTracker />
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />
        <Route path="/landing/pediatria"       element={<LandingPediatria />} />
        <Route path="/landing/sin-cobertura-medica" element={<LandingSinCoberturaMedica />} />
        <Route path="/landing/medico-online"   element={<LandingMedicoOnline />} />
        <Route path="/landing/profesionales"   element={<LandingProfesionales />} />
        <Route path="/terminos" element={<TerminosYCondiciones />} />

        {/* Auth */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/registro" element={<Register onLogin={handleLogin} />} />
          <Route path="/registro-profesional" element={<RegisterProfessional onLogin={handleLogin} />} />
          <Route path="/completar-registro" element={<CompleteProfile authUser={authUser} onProfileComplete={handleProfileComplete} />} />
        </Route>

        {/* Patient — mobile shell */}
        <Route element={
          <RequireRole profile={profile} allowed={['patient']}>
            <PatientMobileLayout profile={profile} />
          </RequireRole>
        }>
          <Route path="/paciente/dashboard"       element={<PatientDashboard    profile={profile} />} />
          <Route path="/paciente/consultas"        element={<PatientConsultations profile={profile} />} />
          <Route path="/paciente/documentos"       element={<PatientDocuments    profile={profile} />} />
          <Route path="/paciente/perfil"           element={<PatientProfile      profile={profile} onProfileUpdate={setProfile} />} />
          <Route path="/paciente/ondemand/:vertical" element={<OnDemand          profile={profile} />} />
          <Route path="/paciente/sos"              element={<Emergency           profile={profile} />} />
          {/* Legacy routes kept for backward compatibility */}
          <Route path="/paciente/buscar"           element={<PatientSearch       profile={profile} />} />
          <Route path="/paciente/profesional/:id"  element={<ProfessionalProfile profile={profile} />} />
          {/* `/paciente/agendar/:id` era una segunda pantalla de reserva, con
              fecha y hora libres y sin validar contra `professional_schedules`.
              Se unificó en el wizard de `/paciente/reservar`. El `:id` es el de
              `professional_profiles`, que el wizard no sabe resolver, así que se
              manda al perfil — que sí lo resuelve y linkea al wizard bien. */}
          <Route path="/paciente/agendar/:id"      element={<RedirectToProfesional />} />
          <Route path="/paciente/biovisor"         element={<PatientBiovisor     profile={profile} />} />
          <Route path="/paciente/nutriplan"        element={<PatientNutriPlan    profile={profile} />} />
          <Route path="/paciente/farmacia"         element={<PatientPharmacy     profile={profile} />} />
          <Route path="/paciente/comprobantes"     element={<PatientComprobantes profile={profile} />} />
          <Route path="/paciente/videollamada/:id" element={<PatientVideoCall    profile={profile} />} />
          <Route path="/paciente/reservar"            element={<ReservarConsulta   profile={profile} />} />
          {/* `/paciente/buscar-profesional` se retiró del ruteo el 2026-07-31 al
              consolidar la búsqueda en `/paciente/buscar`. Había DOS pantallas de
              búsqueda ruteadas y sólo una alcanzable: el sidebar y el link de
              "volver" del perfil apuntan a `/paciente/buscar`, y a la otra no
              llegaba nadie. El archivo (`pages/patient/BuscarProfesional.jsx`) y
              su `ProfessionalModal` quedan en el repo: tienen el único flujo que
              pre-carga el asistente de reserva con un profesional elegido
              (`/paciente/consultas?vertical=&pro=&modality=`), que la pantalla
              consolidada todavía no replica — va al perfil del profesional. Si se
              retoma ese flujo, sale de ahí. */}
          <Route path="/paciente/sala-espera/:consultationId" element={<WaitingRoom profile={profile} />} />
          <Route path="/paciente/pago" element={<PaymentPage profile={profile} />} />
          <Route path="/paciente/consulta/review/:consultationId" element={<ConsultationReview profile={profile} />} />
          <Route path="/paciente/historia-clinica" element={<HistoriaClinicaPaciente profile={profile} />} />
          <Route path="/paciente/ia"              element={<PatientAIChat           profile={profile} />} />
          <Route path="/paciente/fastpass"        element={<WalkInQueue             profile={profile} />} />
          <Route path="/paciente/salud"           element={<HealthSnapshot          profile={profile} />} />
          <Route path="/paciente/turno-confirmado/:consultationId" element={<BookingConfirmed profile={profile} />} />
        </Route>

        {/* Patient onboarding — full-screen, no mobile nav */}
        <Route path="/paciente/onboarding" element={
          <RequireRole profile={profile} allowed={['patient']}>
            <PatientOnboarding profile={profile} onProfileUpdate={setProfile} />
          </RequireRole>
        } />

        {/* Professional — full-screen standalone routes (no sidebar) */}
        <Route path="/profesional/emergencias" element={
          <RequireRole profile={profile} allowed={['professional']}>
            <ProfessionalEmergencias profile={profile} />
          </RequireRole>
        } />
        <Route path="/profesional/videollamada/:id" element={
          <RequireRole profile={profile} allowed={['professional']}>
            <ProfessionalVideoCall profile={profile} />
          </RequireRole>
        } />
        <Route path="/profesional/onboarding" element={
          <RequireRole profile={profile} allowed={['professional']}>
            <ProfessionalOnboarding profile={profile} />
          </RequireRole>
        } />

        {/* Professional */}
        <Route element={
          <RequireRole profile={profile} allowed={['professional']}>
            <AppLayout profile={profile} profSpecialty={profSpecialty} />
          </RequireRole>
        }>
          <Route path="/profesional/dashboard" element={<ProfessionalDashboard profile={profile} />} />
          <Route path="/profesional/agenda" element={<ProfessionalAgenda profile={profile} />} />
          <Route path="/profesional/consulta/:id" element={<ConsultationDetail profile={profile} />} />
          <Route path="/profesional/perfil" element={<ProfessionalProfileEdit profile={profile} onProfileUpdate={setProfile} />} />
          <Route path="/profesional/nutriplan" element={<NutriPlan profile={profile} />} />
          <Route path="/profesional/historia-clinica/:patientId" element={<HistoriaClinica profile={profile} />} />
          <Route path="/profesional/historial" element={<ProfessionalHistorial profile={profile} />} />
          <Route path="/profesional/paciente/:patientId" element={<ProfessionalPatientProfile profile={profile} />} />
          <Route path="/profesional/pacientes" element={<ProfessionalPacientes profile={profile} />} />
          <Route path="/profesional/ganancias" element={<ProfessionalGanancias profile={profile} />} />
          <Route path="/profesional/configuracion" element={<ProfessionalConfiguracion profile={profile} />} />
          <Route path="/profesional/ayuda" element={<ProfessionalAyuda profile={profile} />} />
        </Route>

        {/* Admin */}
        <Route element={
          <RequireRole profile={profile} allowed={['admin', 'super_admin']}>
            <AppLayout profile={profile} />
          </RequireRole>
        }>
          <Route path="/admin/profesionales" element={<AdminProfessionals />} />
          <Route path="/admin/usuarios" element={<AdminUsers />} />
          <Route path="/admin/consultas" element={<AdminConsultations />} />
        </Route>

        {/* Super Admin */}
        <Route element={
          <RequireRole profile={profile} allowed={['super_admin']}>
            <AppLayout profile={profile} />
          </RequireRole>
        }>
          <Route path="/super-admin/dashboard" element={<SuperAdminDashboard />} />
          <Route path="/super-admin/pagos" element={<SuperAdminPayments />} />
          <Route path="/super-admin/consultas" element={<SuperAdminConsultas />} />
          <Route path="/super-admin/admins" element={<SuperAdminAdmins />} />
          <Route path="/super-admin/zonas" element={<SuperAdminZones />} />
          <Route path="/super-admin/verticales" element={<SuperAdminVerticales />} />
          <Route path="/super-admin/auditoria" element={<SuperAdminAuditoria />} />
          <Route path="/super-admin/settings" element={<SuperAdminSettings />} />
          <Route path="/super-admin/usuarios" element={<SuperAdminUsuarios />} />
          <Route path="/super-admin/usuarios/prospects" element={<SuperAdminUsuariosProspects />} />
          <Route path="/super-admin/profesionales" element={<SuperAdminProfesionales />} />
          <Route path="/super-admin/emergencias" element={<SuperAdminEmergencias />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
